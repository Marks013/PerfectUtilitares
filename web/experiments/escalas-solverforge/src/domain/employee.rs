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
    /// Product rest/weekday group: sector + effective hours + Sunday cap.
    pub rest_group: usize,
    pub sunday_cap: usize,
    pub rules: PersonalRules,
    pub locked_work: u64,
    pub locked_off: u64,
    pub saved_known: u64,
    pub saved_work: u64,
    pub lock_flags: Vec<Option<bool>>,
    pub comparable_weeks: u32,
    pub facts: Arc<Sector>,
    pub catalog: Arc<Vec<u64>>,
    /// Exact legal count before bounded 42-day search-domain selection.
    pub full_domain_count: usize,
    pub allowed: Arc<[usize]>,
    #[planning_pin]
    pub pinned: bool,
    #[planning_variable(value_range_provider = "allowed")]
    pub pattern: Option<usize>,
}

impl Employee {
    pub fn mask(&self) -> Option<u64> {
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
