//! Candidate-local selection guard, not an additional hard labor rule.
use std::collections::BTreeMap;
use crate::domain::Plan;
use super::coverage::{Cost,Member,group_cost,validate_complete};
use super::patterns::worked;
use super::presence::Presence;

struct SectorQuality {
    cost:Cost,
    present:u64,
    gaps:Vec<i64>,
}
fn sector_quality(plan:&Plan)->BTreeMap<usize,SectorQuality> {
    let mut members=BTreeMap::<usize,Vec<Member>>::new();
    for person in &plan.employees {
        members.entry(person.sector).or_default().push(person.member());
    }
    members.into_iter().map(|(sector,rows)|{
        let facts=&rows[0].facts;
        let mut attendance=[Presence::EMPTY;42];
        let mut present=0u64;
        for row in &rows {
            if let Some(mask)=row.mask {
                for (day, current) in attendance.iter_mut().enumerate().take(facts.days) {
                    if worked(mask,day) {*current|=Presence::one(row.id);present|=1u64<<day;}
                }
            }
        }
        let gaps=facts.bands.iter().flat_map(|band|band.gap_components(attendance[band.day])).collect();
        (sector,SectorQuality{cost:group_cost(rows.iter()),present,gaps})
    }).collect()
}

// Product groups omit role/clock, unlike the engine's fairness cohorts.
// Preserve each person's correctable excess and group pair count, even if
// an internal sum or a different cohort would hide the regression.
#[derive(PartialEq,Eq)]
struct RestProtection {
    excess:BTreeMap<usize,i64>,
    groups:BTreeMap<usize,i64>,
    concentration:i64,
    total_excess:i64,
    total_pairs:i64,
    sunday_spread:BTreeMap<usize,i64>,
}
impl RestProtection {
    fn capture(plan:&Plan)->Self{
        let mut result=Self{excess:BTreeMap::new(),groups:BTreeMap::new(),concentration:0,
            total_excess:0,total_pairs:0,sunday_spread:BTreeMap::new()};
        let mut rates=BTreeMap::<usize,(i64,i64)>::new();
        for p in &plan.employees{
            let mask=p.mask().expect("complete guard");
            let q=p.rules.rest_quality(mask,p.locked_off,p.facts.days);
            result.excess.insert(p.id,q[0]);
            *result.groups.entry(p.rest_group).or_default()+=q[1];
            result.total_excess+=q[0];result.total_pairs+=q[1];result.concentration+=q[2];
            let mut available=0i64;let mut work=0i64;
            for day in (0..p.facts.days).step_by(7){
                if worked(p.locked_off,day){continue;}
                available+=1;work+=i64::from(worked(mask,day));
            }
            if available>0{
                let rate=work*10_000/available;
                let entry=rates.entry(p.rest_group).or_insert((rate,rate));
                entry.0=entry.0.min(rate);entry.1=entry.1.max(rate);
            }
        }
        result.sunday_spread=rates.into_iter().map(|(group,(lo,hi))|(group,hi-lo)).collect();
        result
    }
    fn preserves(&self,after:&Self)->bool{
        after.excess.len()==self.excess.len()
            &&after.excess.iter().all(|(id,n)|*n<=*self.excess.get(id).unwrap_or(&0))
            &&after.groups.iter().all(|(id,n)|*n<=*self.groups.get(id).unwrap_or(&0))
            &&((after.total_excess,after.total_pairs)!=(self.total_excess,self.total_pairs)
                ||after.concentration<=self.concentration)
            &&after.sunday_spread.iter().all(|(id,n)|*n<=*self.sunday_spread.get(id).unwrap_or(&0))
    }
}

pub struct SeedGuard {
    patterns:BTreeMap<usize,Option<usize>>,
    sectors:BTreeMap<usize,SectorQuality>,
    rest:RestProtection,
}
impl SeedGuard {
    pub fn capture(plan:&Plan)->Option<Self> {
        if !validate_complete(plan) {return None;}
        Some(Self{patterns:plan.employees.iter().map(|p|(p.id,p.pattern)).collect(),
            sectors:sector_quality(plan),rest:RestProtection::capture(plan)})
    }
    pub fn preserves(&self,plan:&Plan)->bool {
        if !validate_complete(plan) || plan.employees.len()!=self.patterns.len()
            || plan.employees.iter().any(|p|!self.patterns.contains_key(&p.id)){return false;}
        let after=sector_quality(plan);
        self.rest.preserves(&RestProtection::capture(plan)) && after.len()==self.sectors.len() && self.sectors.iter().all(|(key,before)|{
            let Some(next)=after.get(key) else {return false;};
            let operational=(0..5).all(|i|next.cost[i]<=before.cost[i])
                && before.present & !next.present == 0
                && next.gaps.len()==before.gaps.len()
                && next.gaps.iter().zip(&before.gaps).all(|(a,b)|a<=b);
            let tied=next.cost[..5]==before.cost[..5] && next.gaps==before.gaps && next.present==before.present;
            operational && (!tied || (5..13).all(|i|next.cost[i]<=before.cost[i]))
        })
    }
    pub fn restore(&self,plan:&mut Plan) {
        for p in &mut plan.employees {p.pattern=self.patterns[&p.id];}
        // The restored constructor is not the native solver's returned score.
        plan.score=None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{wire,model};
    use serde_json::{Value,json};
    use std::time::{Duration,Instant};
    #[test]
    fn rejects_new_deficit_and_restores_the_original_legal_seed() {
        let corpus:Value=serde_json::from_str(include_str!("../e2-wire-contract.json")).unwrap();
        let mut value=corpus["base"].clone();
        value["input"]["assignments"]=json!([]);
        value["input"]["demands"][0]["estimated"]=json!(true);
        let mut plan=wire::read(&value,Instant::now()+Duration::from_secs(5)).unwrap();
        let person=&mut plan.employees[0];
        let a=*person.allowed.iter().find(|&&i|worked(person.catalog[i],0)).unwrap();
        let b=*person.allowed.iter().find(|&&i|!worked(person.catalog[i],0)).unwrap();
        person.pattern=Some(a);
        let initial=model::evaluate(&plan);
        let guard=SeedGuard::capture(&plan).unwrap();
        assert!(guard.preserves(&plan));
        plan.employees[0].pattern=Some(b);
        assert!(model::validate_complete(&plan));
        assert!(!guard.preserves(&plan));
        guard.restore(&mut plan);
        assert_eq!(plan.employees[0].pattern,Some(a));
        assert_eq!(model::evaluate(&plan),initial);
        assert!(guard.preserves(&plan));
    }
}
