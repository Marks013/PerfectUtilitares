//! Legal full-horizon paths assembled from weekly domains. A bounded sample
//! is never a proof of infeasibility or of complete search over six weeks.
use std::collections::{BTreeMap,BTreeSet};
use std::time::Instant;
use crate::model::PersonalRules;
use super::{ABS,Clock,HOL,MAX_DAYS,OFF,Pattern,Record,Result,check,clock,work};

const MAX_WEEK:usize=30_000;
pub(super) const PATH_LIMIT:usize=384;
const PATH_ATTEMPTS:usize=2048;
const WEEK_TRIES:usize=64;

#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord)]
pub(super) struct Rules{
    pub days:usize,pub personal:PersonalRules,pub fixed:u8,pub cap:i32,pub target:i32,
    pub weekly_limit:i32,pub inter:i32,pub weekly_rest:i32,pub mixed:bool,pub untimed:bool,
    pub hours_only:bool,pub closed:[bool;MAX_DAYS],pub holiday:[bool;MAX_DAYS],
    pub old:[Option<Record>;MAX_DAYS],pub context:BTreeMap<i32,u8>,pub rest_weight:i64,
}
impl Rules{
    fn week_legal(&self,states:&[u8],clocks:&[Clock])->bool{
        let count=states.iter().filter(|&&s|work(s)).count() as i32;
        let off=states.iter().filter(|&&s|s==OFF).count() as i32;
        let absent=states.contains(&ABS);
        let weekdays=states[1..].iter().filter(|&&s|s==HOL).count() as i32;
        let sunday=i32::from(states[0]==HOL);
        let minutes:i32=states.iter().filter_map(|&s|clock(clocks,s)).map(|c|c.paid).sum();
        if count>5||!self.untimed&&minutes>self.target.min(self.weekly_limit){return false;}
        if !absent&&(count!=(5-weekdays).max(0)||off!=(2-sunday).max(0)
            ||!self.untimed&&weekdays==0&&minutes!=self.target){return false;}
        if self.mixed&&states.iter().filter_map(|&s|clock(clocks,s)).filter(|c|c.paid==540).count()>2{return false;}
        true
    }
    fn mutable(&self,d:usize)->bool{
        !self.closed[d]&&self.fixed&(1<<(d%7))==0&&self.old[d].is_none_or(|r|r.locked!=Some(true)&&r.state!=ABS&&r.state!=HOL)
    }
    pub fn legal_prefix(&self,states:&[u8],clocks:&[Clock])->bool{
        let len=states.len() as i32;let horizon=self.days as i32;
        if len==0||len>horizon||!states.len().is_multiple_of(7)||!states.as_chunks::<7>().0.iter().all(|w|self.week_legal(w,clocks)){return false;}
        let full=len==horizon;
        let state=|d:i32|if (0..len).contains(&d){Some(states[d as usize])}
            else if d<0||full&&d>=horizon{self.context.get(&d).copied()}else{None};
        let max=i32::from(self.personal.max_run);
        for start in -max..len{
            if (start..=start+max).all(|d|state(d).is_some_and(work)){return false;}
        }
        for start in -self.cap..len/7{
            if (start..=start+self.cap).all(|w|state(w*7).is_some_and(work)){return false;}
        }
        if self.personal.variable{
            for start in -2..len{
                let mutable=(start..start+3).any(|d|(0..len).contains(&d)&&self.mutable(d as usize));
                if mutable&&(start..start+3).all(|d|state(d)==Some(OFF)){return false;}
            }
        }
        if self.personal.consecutive{
            let rest=|d:i32|state(d)==Some(OFF)||d.rem_euclid(7)==0&&state(d)==Some(HOL);
            for d in 0..len{
                if d==len-1&&!full{continue;}
                let fixed_next=full&&d==len-1&&self.fixed&1!=0&&state(len).is_none();
                if rest(d)&&!rest(d-1)&&!rest(d+1)&&!fixed_next{return false;}
            }
            if full&&state(len)==Some(OFF)&&state(len+1).is_some_and(|s|work(s)||s==ABS)&&state(len-1)!=Some(OFF){return false;}
        }
        for a in -5..len{
            let Some(ca)=state(a).and_then(|s|clock(clocks,s)) else{continue;};
            for b in a+1..=a+5{
                if b<0{continue;}
                let Some(cb)=state(b).and_then(|s|clock(clocks,s)) else{continue;};
                let gap=(b-a)*1440+cb.start()-ca.end();
                if gap<self.inter{return false;}
                if (a+1..b).any(|d|matches!(state(d),Some(OFF|HOL)))&&gap<self.weekly_rest{return false;}
            }
        }
        if full&&!self.hours_only&&!self.personal.consecutive&&self.fixed.count_ones()<2{
            let mut groups=BTreeMap::<u8,(usize,u8)>::new();
            for (week,part) in states.as_chunks::<7>().0.iter().enumerate(){
                let a=week*7;let b=a+7;
                if self.holiday[a..b].iter().any(|&x|x)||self.old[a..b].iter().flatten().any(|r|r.locked==Some(true)||matches!(r.state,ABS|HOL)){continue;}
                let imposed=self.closed[a..b].iter().enumerate().fold(self.fixed,|m,(d,c)|if *c{m|1<<d}else{m});
                if imposed.count_ones()>=2{continue;}
                let off=part.iter().enumerate().fold(0u8,|m,(d,s)|if *s==OFF{m|1<<d}else{m});
                let entry=groups.entry(imposed).or_insert((0,127));entry.0+=1;entry.1&=off;
            }
            if groups.values().any(|&(n,off)|n>=2&&off.count_ones()>=2){return false;}
        }
        true
    }
    fn pattern(&self,states:[u8;MAX_DAYS])->Pattern{
        let active=&states[..self.days];let mut cost=[0;17];
        let changes=active.iter().enumerate().filter(|(d,s)|self.old[*d].is_some_and(|r|r.state!=ABS&&r.state!=**s)).count() as i64;
        cost[13]=i64::from(changes>0);cost[14]=changes;
        cost[15]=active.iter().enumerate().filter(|(d,s)|work(**s)&&self.personal.preferred&(1<<(*d%7))!=0).count() as i64;
        if self.personal.prefer_consecutive{cost[15]+=(self.days-1) as i64-active.windows(2).filter(|w|*w==[OFF,OFF]).count() as i64;}
        if self.personal.adjustable(){
            let mut pairs=0i64;let mut imposed=0i64;
            for (d,&current) in active.iter().enumerate(){
                let prev=if d==0{self.context.get(&-1).copied()}else{Some(active[d-1])};
                if prev==Some(OFF)&&current==OFF{
                    if self.mutable(d)||d>0&&self.mutable(d-1){pairs+=1;}else{imposed+=1;}
                }
            }
            cost[8]=pairs+self.rest_weight*((pairs+imposed-2).max(0)-(imposed-2).max(0));
        }
        let mut rates=[None;2];let mut sunday_opportunities=0u64;
        for weekday in 0..7{
            let prior:Vec<_>=self.context.iter().filter(|(d,s)|(-21..0).contains(*d)&&d.rem_euclid(7)==weekday as i32&&(work(**s)||**s==OFF)).map(|(_,s)|*s).collect();
            let actual=(weekday..self.days).step_by(7);
            let opportunities=prior.len() as i64+actual.clone().filter(|&d|active[d]!=ABS).count() as i64;
            let rests=prior.iter().filter(|&&s|s==OFF).count() as i64+actual.clone().filter(|&d|active[d]==OFF).count() as i64;
            let deviation=(7*rests-2*opportunities).abs();
            cost[12]+=deviation;
            if self.untimed{cost[6]+=deviation*deviation;}
            if weekday==0||weekday==6{
                let eligible:Vec<_>=actual.filter(|&d|!self.closed[d]&&active[d]!=ABS&&self.fixed&(1<<weekday)==0
                    &&!self.old[d].is_some_and(|r|r.locked==Some(true)&&r.state==OFF)).collect();
                if !eligible.is_empty(){
                    let used=prior.iter().filter(|&&s|work(s)).count()+eligible.iter().filter(|&&d|work(active[d])).count();
                    rates[usize::from(weekday==6)]=Some(used as i64*10_000/(prior.len()+eligible.len()) as i64);
                    if weekday==0{for d in eligible{sunday_opportunities|=1u64<<d;}}
                }
            }
        }
        Pattern{states,personal:cost,rates,sunday_opportunities}
    }
}

fn weekly(options:&[Vec<u8>],rules:&Rules,clocks:&[Clock],deadline:Instant)->Result<Vec<[u8;7]>>{
    fn visit(day:usize,states:&mut [u8;7],options:&[Vec<u8>],rules:&Rules,clocks:&[Clock],deadline:Instant,out:&mut Vec<[u8;7]>)->Result<()>{
        check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
        if day==7{
            if rules.week_legal(states,clocks){
                check(out.len()<MAX_WEEK,"TEMPORAL_DOMAIN_LIMIT")?;out.push(*states);
            }
        }else{
            for &state in &options[day]{states[day]=state;visit(day+1,states,options,rules,clocks,deadline,out)?;}
        }
        Ok(())
    }
    let mut out=Vec::new();visit(0,&mut [OFF;7],options,rules,clocks,deadline,&mut out)?;
    Ok(out)
}
fn mix(mut n:u64)->u64{
    n=(n^(n>>30)).wrapping_mul(0xbf58476d1ce4e5b9);
    n=(n^(n>>27)).wrapping_mul(0x94d049bb133111eb);n^(n>>31)
}
pub(super) fn enumerate(options:&[Vec<u8>],rules:&Rules,clocks:&[Clock],deadline:Instant)->Result<Vec<Pattern>>{
    let mut cache=BTreeMap::<Vec<Vec<u8>>,Vec<[u8;7]>>::new();
    let mut weeks=Vec::new();
    for part in options.as_chunks::<7>().0{
        let values=if let Some(v)=cache.get(part.as_slice()){v.clone()}else{
            let v=weekly(part,rules,clocks,deadline)?;cache.insert(part.to_vec(),v.clone());v
        };
        check(!values.is_empty(),"NO_PERSONAL_PATTERN")?;weeks.push(values);
    }
    let mut paths=BTreeSet::new();
    if rules.days==7{
        for week in &weeks[0]{
            check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
            if rules.legal_prefix(week,clocks){
                let mut path=[OFF;MAX_DAYS];path[..7].copy_from_slice(week);paths.insert(path);
            }
        }
    }else{
        // Bounded deterministic independent paths; no external engine seed.
        // Never enumerate the Cartesian product of temporal weekly patterns.
        for attempt in 0..PATH_ATTEMPTS{
            check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
            let mut path=[OFF;MAX_DAYS];let mut complete=true;
            for (week,values) in weeks.iter().enumerate(){
                let len=values.len();let a=week*7;let b=a+7;
                let start=(mix((attempt as u64+1)*67+week as u64)%(len as u64)) as usize;
                let mut found=false;
                for offset in 0..len.min(WEEK_TRIES){
                    path[a..b].copy_from_slice(&values[(start+offset)%len]);
                    if rules.legal_prefix(&path[..b],clocks){found=true;break;}
                }
                if !found{complete=false;break;}
            }
            if complete{paths.insert(path);if paths.len()>=PATH_LIMIT{break;}}
        }
    }
    check(!paths.is_empty(),"NO_PERSONAL_PATTERN")?;
    Ok(paths.into_iter().map(|p|rules.pattern(p)).collect())
}
