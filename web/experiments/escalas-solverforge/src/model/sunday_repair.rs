//! Bounded coordinated Sunday repair for homogeneous fixed-clock E2 cohorts.
//! Reuses only legal personal domains; no input from another engine.
use std::collections::{BTreeMap,BTreeSet};
use std::time::Instant;
use crate::domain::{Employee,Plan};
use super::coverage::{group_cost,Member,Sector};
use super::patterns::{worked,rest_pairs};

const MAX_STATES:usize=20_000;
const MAX_TRANSITIONS:usize=250_000;
fn signature(mask:u32,days:usize)->u8 {
    (0..days/7).fold(0,|v,w|v | (u8::from(worked(mask,w*7))<<w))
}
fn apply(att:&mut [u64;28],p:&Employee,mask:u32,insert:bool) {
    let bit=1u64<<p.id;
    for day in 0..p.facts.days {
        if worked(mask,day) {
            if insert {att[day]|=bit;} else {att[day]&=!bit;}
        }
    }
}
// State is four Sunday headcounts, not a product of entire monthly masks.
fn projections(domains:&[Vec<u8>],deadline:Instant)->Option<BTreeMap<[u8;4],Vec<u8>>> {
    if Instant::now()>=deadline{return None;}
    let mut states=BTreeMap::from([([0u8;4],Vec::new())]);
    let mut transitions=0;
    for domain in domains {
        let mut next=BTreeMap::new();
        for (counts, choices) in states {
            for &sig in domain {
                transitions+=1;
                if transitions>MAX_TRANSITIONS || transitions%128==0 && Instant::now()>=deadline {return None;}
                let mut key=counts;
                for w in 0..4 {key[w]+= (sig>>w)&1;}
                next.entry(key).or_insert_with(||{
                    let mut result=choices.clone();result.push(sig);result
                });
                if next.len()>MAX_STATES {return None;}
            }
        }
        states=next;
    }
    Some(states)
}
fn sunday_cost(facts:&Sector,att:&[u64;28])->[i64;2] {
    let mut result=[0;2];
    for b in facts.bands.iter().filter(|b|b.day%7==0) {
        result[usize::from(b.estimated)]+=b.gap(att[b.day])*b.minutes;
    }
    result
}
fn choose(p:&Employee,att:&[u64;28],target:u8,deadline:Instant)->Option<usize>{
    let mut hard=[0i64;28];let mut estimated=[0i64;28];
    let bit=1u64<<p.id;
    for b in &p.facts.bands {
        let n=att[b.day];let gain=(b.gap(n)-b.gap(n|bit))*b.minutes;
        if b.estimated {estimated[b.day]+=gain;}else{hard[b.day]+=gain;}
    }
    let mut best=None;
    for (n,&i) in p.allowed.iter().enumerate(){
        if n%128==0&&Instant::now()>=deadline{return None;}
        let mask=p.catalog[i];
        if signature(mask,p.facts.days)!=target {continue;}
        let mut rank=[0i64;7];
        for day in 0..p.facts.days{
            if !worked(mask,day){continue;}
            rank[0]+=hard[day];
            if day%7==0{rank[1]+=estimated[day];}
            rank[2]+=i64::from(att[day]==0);
            rank[3]+=estimated[day];
            rank[5]-=att[day].count_ones() as i64;
        }
        rank[4]=-rest_pairs(mask,p.locked_off,p.facts.days);
        rank[6]=-(((p.saved_work^mask)&p.saved_known).count_ones() as i64);
        if best.is_none_or(|(prior,_)|rank>prior){best=Some((rank,i));}
    }
    best.map(|(_,i)|i)
}
pub fn repair(plan:&mut Plan,deadline:Instant) {
    if plan.employees.iter().any(|p|p.pattern.is_none()) {return;}
    let mut sectors=BTreeMap::<usize,Vec<usize>>::new();
    for (i,p) in plan.employees.iter().enumerate(){sectors.entry(p.sector).or_default().push(i);}
    for members in sectors.values(){
        if Instant::now()>=deadline{return;}
        let mut cohorts=BTreeMap::<usize,Vec<usize>>::new();
        for &i in members {cohorts.entry(plan.employees[i].cohort).or_default().push(i);}
        let facts=plan.employees[members[0]].facts.clone();
        let mut att=[0u64;28];
        for &i in members{let p=&plan.employees[i];apply(&mut att,p,p.mask().unwrap(),true);}
        for group in cohorts.values(){
            if Instant::now()>=deadline{return;}
            let old_sunday=sunday_cost(&facts,&att);
            if old_sunday==[0,0]{break;}
            let old_rows:Vec<Member>=members.iter().map(|&i|plan.employees[i].member()).collect();
            let before=group_cost(old_rows.iter());
            let old_att=att;
            let mut outside=att;
            let mut domains=Vec::new();
            let mut old_count=0u32;
            let mut bits=Vec::new();
            for &i in group{
                let p=&plan.employees[i];
                let mask=p.mask().unwrap();
                old_count+=signature(mask,facts.days).count_ones();
                apply(&mut outside,p,mask,false);
                bits.push(1u64<<p.id);
                let sigs:BTreeSet<_>=p.allowed.iter().map(|&j|signature(p.catalog[j],facts.days)).collect();
                domains.push(sigs.into_iter().collect::<Vec<_>>());
            }
            // Count projection is exact only for identical eligibility.
            let group_bits=bits.iter().fold(0u64,|a,b|a|b);
            if facts.bands.iter().any(|b| {
                let mask=b.eligible&group_bits;
                (mask!=0&&mask!=group_bits)||b.role_floors.iter().any(|(m,_)| {
                    let part=m&group_bits;part!=0&&part!=group_bits
                })
            }){continue;}
            let Some(states)=projections(&domains,deadline) else {continue;};
            let mut best=None;
            for (n,(counts,choices)) in states.into_iter().enumerate(){
                if n%128==0&&Instant::now()>=deadline{return;}
                if counts.iter().map(|&n|n as u32).sum::<u32>()<old_count{continue;}
                let mut projected=outside;
                for w in 0..facts.days/7{
                    for bit in bits.iter().take(counts[w] as usize){projected[w*7]|=*bit;}
                }
                let quality=sunday_cost(&facts,&projected);
                if quality[0]>old_sunday[0]||quality[1]>=old_sunday[1]{continue;}
                if best.as_ref().is_none_or(|(cost,_)|quality<*cost){best=Some((quality,choices));}
            }
            let Some((_,choices))=best else{continue;};
            let mut trial=outside;
            let mut selected=Vec::new();
            for (&i,&sig) in group.iter().zip(&choices){
                let p=&plan.employees[i];
                let Some(index)=choose(p,&trial,sig,deadline) else{return;};
                apply(&mut trial,p,p.catalog[index],true);
                selected.push((i,index));
            }
            for _ in 0..2 {
                for (i,index) in &mut selected {
                    let p=&plan.employees[*i];let mask=p.catalog[*index];
                    apply(&mut trial,p,mask,false);
                    let Some(next)=choose(p,&trial,signature(mask,facts.days),deadline) else{return;};
                    *index=next;apply(&mut trial,p,p.catalog[next],true);
                }
            }
            let rows:Vec<Member>=members.iter().map(|&i|{
                let p=&plan.employees[i];let mut m=p.member();
                if let Some((_,index))=selected.iter().find(|(j,_)|*j==i){m.mask=Some(p.catalog[*index]);}
                m
            }).collect();
            let after=group_cost(rows.iter());
            if after[0]<=before[0]&&after[1]<before[1]&&after[2]<=before[2]&&after[3]<=before[3]&&after[4]<=before[4]
                &&(0..facts.days).all(|d|old_att[d]==0||trial[d]!=0) {
                for (i,index) in selected {plan.employees[i].pattern=Some(index);}
                att=trial;
            }
        }
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    use std::time::Duration;
    #[test]
    fn coordinated_projection_finds_joint_alternative(){
        let domains=vec![vec![0b0101,0b1001,0b1010],vec![0b0101,0b1001,0b1010]];
        let states=projections(&domains,Instant::now()+Duration::from_secs(1)).unwrap();
        let sigs=&states[&[1,1,1,1]];
        assert_eq!(sigs.len(),2);
        for w in 0..4{assert_eq!(sigs.iter().filter(|&&s|s&(1<<w)!=0).count(),1);}
        assert!(projections(&domains,Instant::now()).is_none());
    }
}
