use solverforge::prelude::*;
use std::sync::Arc;
use crate::model::{Member, Sector, PersonalRules};

#[planning_entity]
pub struct Employee {
    #[planning_id]
    pub id: usize,
    pub name_id: String,
    pub shift: String,
    pub sector: usize,
    pub cohort: usize,
    pub sunday_cap: usize,
    pub rules: PersonalRules,
    pub locked_work: u32,
    pub locked_off: u32,
    pub saved_known: u32,
    pub saved_work: u32,
    pub lock_flags: Vec<Option<bool>>,
    pub comparable_weeks: u32,
    pub facts: Arc<Sector>,
    pub catalog: Arc<Vec<u32>>,
    pub allowed: Arc<[usize]>,
    #[planning_pin]
    pub pinned: bool,
    #[planning_variable(value_range_provider = "allowed")]
    pub pattern: Option<usize>,
}

impl Employee {
    pub fn mask(&self) -> Option<u32> {
        self.pattern.and_then(|index| self.catalog.get(index).copied())
    }

    pub fn member(&self) -> Member {
        Member {
            id: self.id,
            cohort: self.cohort,
            rules: self.rules,
            mask: self.mask(),
            locked_off: self.locked_off,
            saved_known: self.saved_known,
            saved_work: self.saved_work,
            facts: Arc::clone(&self.facts),
        }
    }
}
