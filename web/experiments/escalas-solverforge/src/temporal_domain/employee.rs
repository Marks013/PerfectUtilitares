use solverforge::prelude::*;
use std::sync::Arc;
use crate::temporal::{TemporalFacts, Pattern, Member, MAX_DAYS, OFF, Cost};

#[planning_entity]
pub struct TemporalEmployee {
    #[planning_id]
    pub id: usize,
    pub name_id: String,
    pub sector: usize,
    pub role: usize,
    pub cohort: usize,
    pub leader: bool,
    pub untimed: bool,
    pub preferred_clock: [bool;16],
    pub tie_ranks: [i64;MAX_DAYS],
    pub facts: Arc<TemporalFacts>,
    pub catalog: Arc<Vec<Pattern>>,
    pub allowed: Arc<[usize]>,
    #[planning_pin]
    pub pinned: bool,
    pub lock_flags: [Option<bool>;MAX_DAYS],
    pub manual_absences: [bool;MAX_DAYS],
    #[planning_variable(value_range_provider = "allowed")]
    pub pattern: Option<usize>,
}

impl TemporalEmployee {
    pub fn pattern_cost(&self,index:usize)->Cost{
        let p=&self.catalog[index];let mut cost=p.personal;
        cost[16]=p.states.iter().zip(self.tie_ranks).filter(|(state,_)|**state==OFF).map(|(_,rank)|rank).sum();
        cost
    }
    pub fn member(&self)->Member {
        Member{id:self.id,role:self.role,cohort:self.cohort,leader:self.leader,untimed:self.untimed,facts:Arc::clone(&self.facts),
            pattern:self.pattern.and_then(|i|self.catalog.get(i).copied().map(|mut p|{p.personal=self.pattern_cost(i);p}))}
    }
}
