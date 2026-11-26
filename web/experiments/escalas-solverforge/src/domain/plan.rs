use solverforge::prelude::*;
use solverforge::stream::collector::{Accumulator, Collector};
use std::collections::BTreeMap;
use super::Employee;
use crate::model::{Member, group_cost};

#[planning_solution(constraints = "define_constraints")]
pub struct Plan {
    #[planning_entity_collection]
    pub employees: Vec<Employee>,
    #[planning_score]
    pub score: Option<BendableScore<1, 8>>,
}

// One retained row per employee, no growing tombstone vector. SolverForge
// calls retract/insert on each move; no mutable state outside the accumulator.
#[derive(Clone, Copy)]
struct Members;

#[derive(Default)]
struct MemberAccumulator(BTreeMap<usize, Member>);

impl Collector<&Employee> for Members {
    type Value = Member;
    type Result = BTreeMap<usize, Member>;
    type Accumulator = MemberAccumulator;
    fn extract(&self, input: &Employee) -> Member { input.member() }
    fn create_accumulator(&self) -> MemberAccumulator { MemberAccumulator::default() }
}

impl Accumulator<Member, BTreeMap<usize, Member>> for MemberAccumulator {
    type Retraction = usize;
    fn accumulate(&mut self, value: Member) -> usize {
        let id = value.id;
        assert!(self.0.insert(id, value).is_none(), "duplicate score row");
        id
    }
    fn retract(&mut self, id: usize) {
        assert!(self.0.remove(&id).is_some(), "missing score row");
    }
    fn with_result<T>(&self, f: impl FnOnce(&BTreeMap<usize, Member>) -> T) -> T { f(&self.0) }
    fn reset(&mut self) { self.0.clear(); }
}

#[solverforge_constraints]
fn define_constraints() -> impl ConstraintSet<Plan, BendableScore<1, 8>> {
    let g = ConstraintFactory::<Plan, BendableScore<1, 8>>::new();
    (
        g.for_each(Plan::employees())
            .filter(|person: &Employee| person.pattern.is_none())
            .penalize(BendableScore::<1, 8>::one_hard(0))
            .named("Required personal pattern"),
        g.for_each(Plan::employees())
            .group_by(|person: &Employee| person.sector, Members)
            .penalize(|_sector: &usize, members: &BTreeMap<usize, Member>| {
                let cost = group_cost(members.values());
                BendableScore::<1, 8>::of([cost[0]], std::array::from_fn(|i| cost[i + 1]))
            })
            .named("Sector coverage, presence and rest quality"),
    )
}
