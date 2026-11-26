//! Rest and weekend safeguards in the original product's group granularity.
//! In addition to the role/clock solver cohorts, preserve product groups
//! that intentionally omit role/clock. Keep padding separate from the month.
use std::collections::{BTreeMap,BTreeSet};
use crate::temporal_domain::TemporalPlan;

#[derive(Default)]
pub(super) struct Snapshot{
    person:BTreeMap<usize,[i64;3]>,
    cohorts:BTreeMap<usize,(i64,i64)>,
    groups:BTreeMap<usize,(i64,i64)>,
    weekend:BTreeMap<(usize,usize),(i64,i64)>,
    sector_sunday:BTreeSet<(usize,usize)>,
    sunday_totals:BTreeMap<usize,i64>,
    sum:[i64;3],
}
impl Snapshot{
    pub fn capture(plan:&TemporalPlan)->Self{
        let mut out=Self::default();
        for p in &plan.employees{
            let Some(i)=p.pattern else{continue;};
            let pat=&p.catalog[i];
            let [excess,pairs,horizon,left,right]=pat.rest;
            out.person.insert(p.id,[excess,left,right]);
            for group in [out.cohorts.entry(p.cohort).or_default(),out.groups.entry(p.rest_group).or_default()]{
                group.0+=pairs;group.1+=horizon;
            }
            out.sum[0]+=excess;out.sum[1]+=pairs;out.sum[2]+=pairs*(pairs-1)/2;
            for (weekday,rate) in pat.rates.iter().enumerate(){
                if let Some(rate)=rate{
                    let bounds=out.weekend.entry((p.rest_group,weekday)).or_insert((*rate,*rate));
                    bounds.0=bounds.0.min(*rate);bounds.1=bounds.1.max(*rate);
                }
            }
            let mut sunday_total=0;
            for d in 0..p.facts.days{
                if p.facts.weekday(d)==0&&pat.civil_work&(1u64<<d)!=0{out.sector_sunday.insert((p.sector,d));
                    if pat.sunday_opportunities&(1u64<<d)!=0{sunday_total+=1;}}
            }
            *out.sunday_totals.entry(p.cohort).or_default()+=sunday_total;
        }
        out
    }
    pub fn preserves(&self,plan:&TemporalPlan)->bool{
        let next=Self::capture(plan);
        next.person.len()==self.person.len()
            &&next.person.iter().all(|(id,a)|self.person.get(id).is_some_and(|b|a.iter().zip(b).all(|(a,b)|a<=b)))
            &&next.cohorts.iter().all(|(id,a)|self.cohorts.get(id).is_some_and(|b|a.0<=b.0&&a.1<=b.1))
            &&next.groups.iter().all(|(id,a)|self.groups.get(id).is_some_and(|b|a.0<=b.0&&a.1<=b.1))
            &&next.weekend.iter().all(|(id,a)|self.weekend.get(id).is_some_and(|b|a.1-a.0<=b.1-b.0))
            &&(next.sum[..2]!=self.sum[..2]||next.sum[2]<=self.sum[2])
            &&self.sector_sunday.is_subset(&next.sector_sunday)
            &&self.sunday_totals.iter().all(|(id,n)|next.sunday_totals.get(id).is_some_and(|m|m>=n))
    }
}
