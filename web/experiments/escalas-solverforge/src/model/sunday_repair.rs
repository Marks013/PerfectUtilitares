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
/// Aggregate, payload-free counters; not a count of native SolverForge moves.
#[derive(Default, Debug)]
pub struct RepairStats {
    pub sectors:usize,
    pub projections:usize,
    pub reconstructed:usize,
    pub accepted:usize,
    pub deadline_reached:bool,
    pub projection_limit_hits:usize,
}

const BEAM_WIDTH:usize=16;
const RECONSTRUCTIONS:usize=6;
const MAX_PROJECTED_EVALUATIONS:usize=300_000;

#[derive(Clone)]
struct Projection {
    sunday:[u64;4],
    signatures:Vec<u8>,
    rank:[i64;4],
}
fn sunday_attendance(facts:&Sector,att:&[u64;4])->[u64;28] {
    let mut result=[0;28];
    for week in 0..facts.days/7 {result[week*7]=att[week];}
    result
}
fn projected_rank(facts:&Sector,att:&[u64;4])->[i64;4] {
    let mut rank=[0;4];
    for b in facts.bands.iter().filter(|b|b.day%7==0) {
        let gap=b.gap(att[b.day/7]);
        rank[usize::from(b.estimated)]+=gap*b.minutes;
        if b.estimated {rank[2]=rank[2].max(gap);}
    }
    // Prefer balanced headcounts only AFTER actual demand gaps and peak.
    let mut low=i64::MAX;let mut high=0;
    for day in &att[..facts.days/7]{let n=day.count_ones() as i64;low=low.min(n);high=high.max(n);}
    rank[3]=high-low;
    rank
}
fn insert_projection(beam:&mut Vec<Projection>,item:Projection) {
    let at=beam.partition_point(|p|p.rank<=item.rank);
    if at<BEAM_WIDTH {
        beam.insert(at,item);
        if beam.len()>BEAM_WIDTH {beam.pop();}
    }
}

// Search across cohorts, not only within one role. A leader's Sunday choice
// can make the remaining cohort's headcount infeasible even when each
// cohort has enough total Sunday work. Intermediate ties are retained.
fn joint_projections(plan:&Plan,members:&[usize],facts:&Sector,att:&[u64;28],
                     deadline:Instant,stats:&mut RepairStats)->Option<Vec<Projection>> {
    let mut cohorts=BTreeMap::<usize,Vec<usize>>::new();
    for (slot,&i) in members.iter().enumerate(){
        cohorts.entry(plan.employees[i].cohort).or_default().push(slot);
    }
    let mut groups:Vec<_>=cohorts.into_values().collect();
    // Small/restricted groups first. Leave the largest interchangeable
    // group to fill the final residual demand.
    groups.sort_by_key(|g|g.len());
    let mut initial=[0;4];
    for w in 0..facts.days/7{initial[w]=att[w*7];}
    let signatures=members.iter().map(|&i|signature(plan.employees[i].mask().unwrap(),facts.days)).collect();
    let mut beam=vec![Projection{sunday:initial,signatures,rank:projected_rank(facts,&initial)}];
    let mut evaluated=0usize;
    for group in groups{
        if Instant::now()>=deadline{return None;}
        let mut domains=Vec::new();let mut bits=Vec::new();
        for &slot in &group{
            let p=&plan.employees[members[slot]];
            bits.push(1u64<<p.id);
            let mut sigs=BTreeSet::new();
            for (n,&j) in p.allowed.iter().enumerate(){
                if n%128==0&&Instant::now()>=deadline{return None;}
                sigs.insert(signature(p.catalog[j],facts.days));
            }
            domains.push(sigs.into_iter().collect::<Vec<_>>());
        }
        let group_bits=bits.iter().fold(0u64,|a,b|a|b);
        if facts.bands.iter().any(|b|{
            let eligible=b.eligible&group_bits;
            (eligible!=0&&eligible!=group_bits)||b.role_floors.iter().any(|(m,_)|{
                let part=m&group_bits;part!=0&&part!=group_bits
            })
        }){continue;}
        let Some(states)=projections(&domains,deadline) else{
            stats.projection_limit_hits+=1;return None;
        };
        let mut next=Vec::new();
        for state in &beam{
            let old_count=group.iter().map(|&slot|state.signatures[slot].count_ones()).sum::<u32>();
            for (counts,choices) in &states{
                evaluated+=1;stats.projections+=1;
                if evaluated>MAX_PROJECTED_EVALUATIONS {stats.projection_limit_hits+=1;return None;}
                if evaluated%128==0&&Instant::now()>=deadline{return None;}
                if counts.iter().map(|&n|n as u32).sum::<u32>()<old_count{continue;}
                let mut sunday=state.sunday;
                for w in 0..facts.days/7{
                    sunday[w]&=!group_bits;
                    for bit in bits.iter().take(counts[w] as usize){sunday[w]|=*bit;}
                }
                let rank=projected_rank(facts,&sunday);
                if next.len()==BEAM_WIDTH && next.last().is_some_and(|p:&Projection|p.rank<rank){continue;}
                let mut sigs=state.signatures.clone();
                for (&slot,&sig) in group.iter().zip(choices){sigs[slot]=sig;}
                insert_projection(&mut next,Projection{sunday,signatures:sigs,rank});
            }
            // The previous distribution is always a legal witness, including
            // cases where the DP's first witness for a count is different.
            insert_projection(&mut next,state.clone());
        }
        beam=next;
    }
    Some(beam)
}

fn reconstruct(plan:&Plan,members:&[usize],projection:&Projection,old:&[u64;28],
               reverse:bool,deadline:Instant)->Option<(Vec<usize>,[u64;28])>{
    let mut att=*old;
    let mut selected:Vec<usize>=members.iter().map(|&i|plan.employees[i].pattern.unwrap()).collect();
    let mut order:Vec<usize>=(0..members.len()).collect();
    if reverse{order.reverse();}
    // Preserve incumbents with the same signature initially, then repair
    // changed patterns against the complete residual attendance.
    for &slot in &order{
        let p=&plan.employees[members[slot]];
        let current=p.catalog[selected[slot]];
        if signature(current,p.facts.days)!=projection.signatures[slot] {
            apply(&mut att,p,current,false);
        }
    }
    for &slot in &order{
        let p=&plan.employees[members[slot]];
        let current=p.catalog[selected[slot]];
        if signature(current,p.facts.days)==projection.signatures[slot]{continue;}
        let next=choose(p,&att,projection.signatures[slot],deadline)?;
        selected[slot]=next;apply(&mut att,p,p.catalog[next],true);
    }
    // Coordinate descent within each legal Sunday signature. Try both
    // traversal orders across reconstructions, preserving hard constraints.
    for _ in 0..2{
        for &slot in &order{
            let p=&plan.employees[members[slot]];
            let current=p.catalog[selected[slot]];
            apply(&mut att,p,current,false);
            let next=choose(p,&att,projection.signatures[slot],deadline)?;
            selected[slot]=next;apply(&mut att,p,p.catalog[next],true);
        }
        order.reverse();
    }
    Some((selected,att))
}

pub fn repair(plan:&mut Plan,deadline:Instant)->RepairStats {
    let mut stats=RepairStats::default();
    if plan.employees.iter().any(|p|p.pattern.is_none()){return stats;}
    let mut sectors=BTreeMap::<usize,Vec<usize>>::new();
    for (i,p) in plan.employees.iter().enumerate(){sectors.entry(p.sector).or_default().push(i);}
    for members in sectors.values(){
        if Instant::now()>=deadline{break;}
        let facts=plan.employees[members[0]].facts.clone();
        let mut att=[0u64;28];
        for &i in members{let p=&plan.employees[i];apply(&mut att,p,p.mask().unwrap(),true);}
        let old_sunday=sunday_cost(&facts,&att);
        if old_sunday==[0,0]{continue;}
        stats.sectors+=1;
        let old_rows:Vec<Member>=members.iter().map(|&i|plan.employees[i].member()).collect();
        let before=group_cost(old_rows.iter());
        let Some(projections)=joint_projections(plan,members,&facts,&att,deadline,&mut stats) else{continue;};
        let mut best=None;
        for projection in projections.iter().filter(|p|p.rank[0]<=old_sunday[0]&&p.rank[1]<old_sunday[1]).take(RECONSTRUCTIONS){
            // Explicitly reject a projected hard/Sunday gap regression,
            // including each represented role floor, before rebuilding.
            let projected=sunday_attendance(&facts,&projection.sunday);
            if facts.bands.iter().filter(|b|b.day%7==0).any(|b|{
                b.gap_components(projected[b.day]).iter().zip(b.gap_components(att[b.day]))
                    .any(|(a,b)|*a>b)
            }){continue;}
            for reverse in [false,true]{
                if Instant::now()>=deadline{break;}
                stats.reconstructed+=1;
                let Some((selected,trial))=reconstruct(plan,members,projection,&att,reverse,deadline) else{break;};
                let rows:Vec<Member>=members.iter().zip(&selected).map(|(&i,&index)|{
                    let p=&plan.employees[i];let mut m=p.member();m.mask=Some(p.catalog[index]);m
                }).collect();
                let after=group_cost(rows.iter());
                if after[0]<=before[0]&&after[1]<before[1]&&after[2]<=before[2]&&after[3]<=before[3]&&after[4]<=before[4]
                    &&(0..facts.days).all(|d|att[d]==0||trial[d]!=0)
                    &&role_totals_preserved(&facts,&att,&trial)
                    &&best.as_ref().is_none_or(|(prior,_)|after<*prior){
                    best=Some((after,selected));
                }
            }
        }
        if let Some((_,selected))=best{
            for (&i,index) in members.iter().zip(selected){plan.employees[i].pattern=Some(index);}
            stats.accepted+=1;
        }
    }
    stats.deadline_reached=Instant::now()>=deadline;
    stats
}

// Do not purchase a Sunday gain by increasing the total represented
// shortage for an individual role. Aggregate each immutable role mask.
fn role_totals_preserved(facts:&Sector,before:&[u64;28],after:&[u64;28])->bool{
    let mut deltas=BTreeMap::<(bool,u64),i64>::new();
    for band in &facts.bands{
        let a=band.gap_components(before[band.day]);
        let b=band.gap_components(after[band.day]);
        for (i,(role,_)) in band.role_floors.iter().enumerate(){
            *deltas.entry((band.estimated,*role)).or_default()+=(b[i+1]-a[i+1])*band.minutes;
        }
    }
    deltas.values().all(|&delta|delta<=0)
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

    #[test]
    fn joint_repair_covers_all_four_sundays_without_losing_weekly_legality(){
        use serde_json::{Value,json};
        use crate::{wire,model};
        let corpus:Value=serde_json::from_str(include_str!("../e2-wire-contract.json")).unwrap();
        let mut value=corpus["base"].clone();
        value["input"]["endDate"]=json!("2026-11-28");
        value["input"]["assignments"]=json!([]);
        let mut peer=value["input"]["employees"][0].clone();
        peer["id"]=json!("person-1");peer["name"]=json!("Synthetic person 1");
        // Different roles force cross-cohort exploration. Both start on
        // the same two Sundays; a joint legal assignment covers all four.
        peer["role"]=json!("Repositor");
        value["input"]["employees"].as_array_mut().unwrap().push(peer);
        value["input"]["demands"]=Value::Array((0..4).map(|w|json!({
            "id":format!("sunday-{w}"),"date":wire::date(w*7),"sector":"S",
            "start":480,"end":540,"minimum":1,"estimated":true
        })).collect());
        let mut plan=wire::read(&value,Instant::now()+Duration::from_secs(5)).unwrap();
        for p in &mut plan.employees{
            p.pattern=Some(*p.allowed.iter().find(|&&i|signature(p.catalog[i],28)==0b0101).unwrap());
        }
        let before=model::evaluate(&plan);
        assert!(before[1]>0);
        let stats=repair(&mut plan,Instant::now()+Duration::from_secs(5));
        assert_eq!(stats.accepted,1);
        assert!(model::validate_complete(&plan));
        assert_eq!(model::evaluate(&plan)[1],0);
    }
}
