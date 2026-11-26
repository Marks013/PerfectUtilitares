//! Candidate-local selection guard, not an additional hard labor rule.
use std::collections::BTreeMap;
use crate::domain::Plan;
use super::coverage::{Cost,Member,group_cost,validate_complete};
use super::patterns::worked;
use super::presence::Presence;

struct SectorQuality {
    cost:Cost,
    present:u32,
    gaps:Vec<i64>,
}
fn sector_quality(plan:&Plan)->BTreeMap<usize,SectorQuality> {
    let mut members=BTreeMap::<usize,Vec<Member>>::new();
    for person in &plan.employees {
        members.entry(person.sector).or_default().push(person.member());
    }
    members.into_iter().map(|(sector,rows)|{
        let facts=&rows[0].facts;
        let mut attendance=[Presence::EMPTY;28];
        let mut present=0u32;
        for row in &rows {
            if let Some(mask)=row.mask {
                for day in 0..facts.days {
                    if worked(mask,day) {attendance[day]|=Presence::one(row.id);present|=1u32<<day;}
                }
            }
        }
        let gaps=facts.bands.iter().flat_map(|band|band.gap_components(attendance[band.day])).collect();
        (sector,SectorQuality{cost:group_cost(rows.iter()),present,gaps})
    }).collect()
}

pub struct SeedGuard {
    patterns:BTreeMap<usize,Option<usize>>,
    sectors:BTreeMap<usize,SectorQuality>,
}
impl SeedGuard {
    pub fn capture(plan:&Plan)->Option<Self> {
        if !validate_complete(plan) {return None;}
        Some(Self{patterns:plan.employees.iter().map(|p|(p.id,p.pattern)).collect(),
            sectors:sector_quality(plan)})
    }
    pub fn preserves(&self,plan:&Plan)->bool {
        if !validate_complete(plan) || plan.employees.len()!=self.patterns.len()
            || plan.employees.iter().any(|p|!self.patterns.contains_key(&p.id)){return false;}
        let after=sector_quality(plan);
        after.len()==self.sectors.len() && self.sectors.iter().all(|(key,before)|{
            let Some(next)=after.get(key) else {return false;};
            let operational=(0..5).all(|i|next.cost[i]<=before.cost[i])
                && before.present & !next.present == 0
                && next.gaps.len()==before.gaps.len()
                && next.gaps.iter().zip(&before.gaps).all(|(a,b)|a<=b);
            let tied=next.cost[..5]==before.cost[..5] && next.gaps==before.gaps && next.present==before.present;
            operational && (!tied || (5..11).all(|i|next.cost[i]<=before.cost[i]))
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
