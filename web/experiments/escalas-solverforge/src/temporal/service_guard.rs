//! Incumbent-only operational guards for same-civil-day temporal paths.
//! Preserve real timed role/clock service even outside demand, as well as
//! each represented deficit and peak. No external solver roster is imported.
use std::collections::{BTreeMap,BTreeSet};
use crate::temporal_domain::{TemporalEmployee,TemporalPlan};
use super::{Member,clock};

type ServiceKey=(usize,usize,u8,i32,i32);
type GapKey=(usize,bool,Option<usize>,u8,i32,i32);
#[derive(Default)]
pub(super) struct Snapshot{
    days:BTreeSet<(usize,usize)>,
    service:BTreeMap<ServiceKey,i64>,
    gaps:BTreeMap<GapKey,(i64,i64)>,
}
impl Snapshot{
    pub fn capture(plan:&TemporalPlan)->Self{
        let members:Vec<_>=plan.employees.iter().map(TemporalEmployee::member).collect();
        Self::capture_members(members.iter())
    }
    // Construction replacements already have resolved Member values. Reuse
    // the native guard, not a weaker day-count or aggregate-cost surrogate.
    pub fn capture_members<'a>(members:impl IntoIterator<Item=&'a Member>)->Self{
        let mut result=Self::default();
        let mut groups=BTreeMap::<usize,Vec<&Member>>::new();
        for person in members{groups.entry(person.sector).or_default().push(person);}
        for (sector,people) in groups{
            let facts=&people[0].facts;
            let mut edges=BTreeSet::from([facts.closing-60,facts.closing]);
            for c in facts.clocks.iter(){for (_,a,b) in c.civil_parts(){edges.insert(a);edges.insert(b);}}
            for b in &facts.bands{edges.insert(b.start);edges.insert(b.end);}
            let edges:Vec<_>=edges.into_iter().collect();
            let mut counts=BTreeMap::<(usize,usize,usize),i64>::new();
            for p in &people{
                let Some(pattern)=p.pattern else{continue;};
                for (day,&state) in pattern.states.iter().enumerate().take(facts.days){
                    let Some(c)=clock(&facts.clocks,state) else{continue;};
                    for (offset,a,b) in c.civil_parts(){
                        let civil=day+offset;
                        if civil>=facts.days{continue;}
                        result.days.insert((sector,civil));
                        for (part,bounds) in edges.windows(2).enumerate(){
                            if a<=bounds[0]&&b>=bounds[1]{
                                *counts.entry((civil,p.role,part)).or_default()+=1;
                                for scope in 0..4u8{
                                    if scope&1!=0&&!facts.visible[civil]||scope&2!=0&&facts.weekday(civil)!=0{continue;}
                                    *result.service.entry((sector,p.role,scope,bounds[0],bounds[1])).or_default()+=1;
                                }
                            }
                        }
                    }
                }
            }
            let roles:Vec<_>=people.iter().map(|p|p.role).collect::<BTreeSet<_>>().into_iter().collect();
            for b in &facts.bands{
                for (part,bounds) in edges.windows(2).enumerate(){
                    if bounds[0]<b.start||bounds[1]>b.end{continue;}
                    let present:i64=roles.iter().map(|&role|counts.get(&(b.day,role,part)).copied().unwrap_or(0)).sum();
                    let role_gaps:Vec<_>=b.roles.iter().map(|&(role,floor)|{
                        (Some(role),(floor-counts.get(&(b.day,role,part)).copied().unwrap_or(0)).max(0))
                    }).collect();
                    let gap=(b.general-present).max(0).max(role_gaps.iter().map(|x|x.1).sum());
                    for (role,n) in std::iter::once((None,gap)).chain(role_gaps){
                        for scope in 0..4u8{
                            if scope&1!=0&&!facts.visible[b.day]||scope&2!=0&&facts.weekday(b.day)!=0{continue;}
                            let entry=result.gaps.entry((sector,b.estimated,role,scope,bounds[0],bounds[1])).or_default();
                            entry.0+=n*i64::from(bounds[1]-bounds[0]);entry.1=entry.1.max(n);
                        }
                    }
                }
            }
        }
        result
    }
    pub fn preserves(&self,plan:&TemporalPlan)->bool{
        let members:Vec<_>=plan.employees.iter().map(TemporalEmployee::member).collect();
        self.preserves_members(members.iter())
    }
    pub fn preserves_members<'a>(&self,members:impl IntoIterator<Item=&'a Member>)->bool{
        let after=Self::capture_members(members);
        self.days.is_subset(&after.days)
            &&self.service.iter().all(|(key,count)|after.service.get(key).is_some_and(|next|next>=count))
            &&after.gaps.iter().all(|(key,next)|{
                let prior=self.gaps.get(key).copied().unwrap_or_default();
                next.0<=prior.0&&next.1<=prior.1
            })
    }
}
