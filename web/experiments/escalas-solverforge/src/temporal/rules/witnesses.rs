//! Additional independently legal witnesses inside the existing domain cap.
use std::collections::{BTreeMap,BTreeSet};
use std::time::Instant;
use super::{Rules,PATH_LIMIT};
use super::super::{Clock,MAX_DAYS,OFF,clock,work};

type Path=[u8;MAX_DAYS];
const MAX_TRIALS:usize=8192;
const MAX_EXTRA:usize=PATH_LIMIT*2;
fn admitted(path:&Path,options:&[Vec<u8>],rules:&Rules,clocks:&[Clock])->bool{
    options.len()==rules.days&&options.iter().zip(path).all(|(allowed,state)|allowed.contains(state))
        &&rules.legal_prefix(&path[..rules.days],clocks)
}
fn priority(path:&Path,rules:&Rules,clocks:&[Clock])->(i64,i64,i64,i64,i64){
    let p=rules.pattern(*path,clocks);
    (p.personal[6],p.rest[0],p.rest[1],-(path[..rules.days].iter().filter(|&&s|work(s)).count() as i64),p.personal[15])
}

pub(super) fn enrich(original:BTreeSet<Path>,options:&[Vec<u8>],rules:&Rules,
                     clocks:&[Clock],deadline:Instant)->BTreeSet<Path>{
    if rules.days==7||original.is_empty()||Instant::now()>=deadline{return original;}
    let mut sources:Vec<_>=original.iter().copied().collect();
    sources.sort_by_key(|p|(priority(p,rules,clocks),*p));
    let mut extra=BTreeSet::new();let mut trials=0usize;
    let mut consider=|path:Path|{
        if trials>=MAX_TRIALS||extra.len()>=MAX_EXTRA||Instant::now()>=deadline{return false;}
        trials+=1;
        if !original.contains(&path)&&admitted(&path,options,rules,clocks){extra.insert(path);}
        true
    };
    'sources: for &source in &sources{
        // Untimed rotation is an operational objective. Whole-week phases
        // expose equally legal alternatives without changing weekday totals.
        // Validate against original options, locks, history and future context.
        if rules.untimed&&rules.weeks.iter().all(|&(a,b)|b-a==7){
            for offset in 1..rules.weeks.len(){
                let mut path=source;
                for (week,&(a,b)) in rules.weeks.iter().enumerate(){
                    let (from,to)=rules.weeks[(week+offset)%rules.weeks.len()];
                    path[a..b].copy_from_slice(&source[from..to]);
                }
                if !consider(path){break 'sources;}
            }
        }
        // Equal credited duration, different actual service intervals. Both
        // extremes are alternatives, never a new lock or invented demand.
        for latest in [false,true]{
            let mut path=source;
            for day in 0..rules.days{
                let Some(old)=clock(clocks,source[day]) else{continue;};
                let choices=options[day].iter().copied().filter(|&s|clock(clocks,s).is_some_and(|c|c.paid==old.paid));
                let key=|s:&u8|{
                    let c=clock(clocks,*s).expect("timed option");
                    (if latest{-c.end()}else{c.start()},c.id.as_str())
                };
                if let Some(next)=choices.min_by_key(key){path[day]=next;}
            }
            if !consider(path){break 'sources;}
        }
        // Additional work only where the original daily and full-horizon
        // rules admit it, including partial-employment and absence weeks.
        for day in 0..rules.days{
            if source[day]!=OFF{continue;}
            for &state in options[day].iter().filter(|&&s|work(s)){
                let mut path=source;path[day]=state;
                if !consider(path){break 'sources;}
            }
        }
        // Same-week weekday exchanges preserve workload and Sunday choices.
        for &(a,b) in &rules.weeks{
            for from in a..b{
                if !work(source[from])||matches!(rules.weekday(from as i32),0|6){continue;}
                for to in a..b{
                    if source[to]!=OFF||matches!(rules.weekday(to as i32),0|6){continue;}
                    let mut path=source;path.swap(from,to);
                    if !consider(path){break 'sources;}
                }
            }
        }
    }
    if original.len()+extra.len()<=PATH_LIMIT{return original.into_iter().chain(extra).collect();}
    let old:Vec<_>=original.iter().copied().collect();let keep=old.len().min(PATH_LIMIT/2);
    let mut result=BTreeSet::new();
    for i in 0..keep{
        let index=if keep<=1{0}else{i*(old.len()-1)/(keep-1)};result.insert(old[index]);
    }
    type Key=(u64,[u8;16]);
    let mut groups=BTreeMap::<Key,Vec<Path>>::new();
    for path in extra{
        let mut sundays=0u64;let mut clocks_used=[0u8;16];
        for (day,&state) in path.iter().enumerate().take(rules.days){
            if work(state){
                clocks_used[usize::from(state)]+=1;
                if rules.weekday(day as i32)==0{sundays|=1u64<<day;}
            }
        }
        groups.entry((sundays,clocks_used)).or_default().push(path);
    }
    for group in groups.values_mut(){group.sort_by_key(|p|(priority(p,rules,clocks),*p));}
    let mut groups:Vec<_>=groups.into_values().collect();
    groups.sort_by_key(|g|(priority(&g[0],rules,clocks),g[0]));
    for position in 0..MAX_EXTRA{
        let mut any=false;
        for group in &groups{
            if let Some(path)=group.get(position){
                result.insert(*path);any=true;if result.len()==PATH_LIMIT{return result;}
            }
        }
        if !any{break;}
    }
    for path in old{if result.len()==PATH_LIMIT{break;}result.insert(path);}
    result
}

#[cfg(test)]
mod tests{
    use super::*;
    use std::time::Duration;
    use crate::model::PersonalRules;
    fn profile()->(Rules,Vec<Clock>,Vec<Vec<u8>>,Path){
        let clocks=vec![
            Clock{id:"early".into(),segments:vec![(420,660),(720,960)],paid:480,start:420,end:960},
            Clock{id:"late".into(),segments:vec![(480,720),(780,1020)],paid:480,start:480,end:1020},
        ];
        let rules=Rules{days:14,rest_version:3,service:false,terminal_fixed_rest_allowed:true,personal:PersonalRules::default(),fixed:0,cap:1,
            weeks:vec![(0,7),(7,14)],targets:[2400;6],mixed:[false;6],offset:0,cutover:false,
            weekly_limit:2400,inter:660,weekly_rest:2100,untimed:false,
            active_start:i32::MIN,active_end:i32::MAX,hours_only:false,
            closed:[false;MAX_DAYS],holiday:[false;MAX_DAYS],old:[None;MAX_DAYS],
            context:BTreeMap::new(),visible:std::array::from_fn(|d|d<14)};
        let options=(0..14).map(|d|if d%7==6{vec![3,4]}else{vec![OFF,3,4]}).collect();
        let mut path=[OFF;MAX_DAYS];path[..14].copy_from_slice(&[3,0,0,3,3,3,3,0,3,0,3,3,3,3]);
        (rules,clocks,options,path)
    }
    #[test]
    fn legal_neighbors_expose_clock_and_rest_repairs(){
        let (rules,clocks,options,path)=profile();assert!(admitted(&path,&options,&rules,&clocks));
        let before=rules.pattern(path,&clocks).rest[1];
        let paths=enrich(BTreeSet::from([path]),&options,&rules,&clocks,Instant::now()+Duration::from_secs(2));
        assert!(paths.len()<=PATH_LIMIT&&paths.contains(&path));
        assert!(paths.iter().all(|p|admitted(p,&options,&rules,&clocks)));
        assert!(paths.iter().any(|p|p[..14].iter().all(|&s|s==OFF||s==4)));
        assert!(paths.iter().any(|p|rules.pattern(*p,&clocks).rest[1]<before));
    }
    #[test]
    fn daily_options_remain_authoritative(){
        let (rules,clocks,mut options,path)=profile();options[3]=vec![3];
        let paths=enrich(BTreeSet::from([path]),&options,&rules,&clocks,Instant::now()+Duration::from_secs(2));
        assert!(paths.iter().all(|p|p[3]==3));
    }
    #[test]
    fn expiry_keeps_original_domain(){
        let (rules,clocks,options,path)=profile();let original=BTreeSet::from([path]);
        assert_eq!(enrich(original.clone(),&options,&rules,&clocks,Instant::now()),original);
    }
    #[test]
    fn enrichment_keeps_the_selected_domain_bound(){
        let (rules,clocks,options,path)=profile();
        let days:Vec<_>=(0..14).filter(|&d|work(path[d])).collect();
        let original:BTreeSet<_>=(0usize..PATH_LIMIT).map(|bits|{
            let mut p=path;for (i,&d) in days.iter().enumerate(){if bits&(1<<i)!=0{p[d]=4;}}p
        }).collect();
        assert_eq!(original.len(),PATH_LIMIT);let first=*original.first().unwrap();let last=*original.last().unwrap();
        let paths=enrich(original,&options,&rules,&clocks,Instant::now()+Duration::from_secs(2));
        assert_eq!(paths.len(),PATH_LIMIT);assert!(paths.contains(&first)&&paths.contains(&last));
        assert!(paths.iter().all(|p|admitted(p,&options,&rules,&clocks)));
    }
}
