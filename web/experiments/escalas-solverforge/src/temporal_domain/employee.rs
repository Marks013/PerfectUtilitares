use solverforge::prelude::*;
use std::sync::Arc;
use crate::temporal::{TemporalFacts, Pattern, Member, MAX_DAYS, Cost};

#[planning_entity]
pub struct TemporalEmployee {
    #[planning_id]
    pub id: usize,
    pub name_id: String,
    pub sector: usize,
    pub role: usize,
    pub cohort: usize,
    pub leader_targets: Arc<Vec<usize>>,
    pub leader_label: bool,
    pub rest_role: usize,
    pub untimed: bool,
    pub carry_in: Option<u8>,
    pub preferred_clock: [bool;16],
    pub rest_group: usize,
    pub rest_weight: i64,
    pub tie_costs: Arc<[u16]>,
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
        cost[8]=self.rest_weight*p.rest[0]+p.rest[1];
        cost[16]=i64::from(self.tie_costs[index]);
        cost
    }
    pub fn member(&self)->Member {
        Member{id:self.id,sector:self.sector,role:self.role,rest_role:self.rest_role,cohort:self.cohort,leader_targets:Arc::clone(&self.leader_targets),leader_label:self.leader_label,untimed:self.untimed,carry_in:self.carry_in,facts:Arc::clone(&self.facts),
            pattern:self.pattern.and_then(|i|self.catalog.get(i).copied().map(|mut p|{p.personal=self.pattern_cost(i);p}))}
    }
}
