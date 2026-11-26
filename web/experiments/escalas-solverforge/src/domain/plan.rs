use solverforge::prelude::*;
use solverforge::stream::collector::Collector;
use super::Employee;
use crate::model::{Cost, Member, SectorAccumulator};
use crate::score::EscalasScore;

#[planning_solution(constraints = "define_constraints")]
pub struct Plan {
    #[planning_entity_collection]
    pub employees: Vec<Employee>,
    #[planning_score]
    pub score: Option<EscalasScore>,
}

// The collector maintains attendance and day-local coverage deltas.
#[derive(Clone, Copy)]
struct Members;

impl Collector<&Employee> for Members {
    type Value=Member;
    type Result=Cost;
    type Accumulator=SectorAccumulator;
    fn extract(&self,input:&Employee)->Member {input.member()}
    fn create_accumulator(&self)->SectorAccumulator {SectorAccumulator::default()}
}

#[solverforge_constraints]
fn define_constraints() -> impl ConstraintSet<Plan, EscalasScore> {
    let g = ConstraintFactory::<Plan, EscalasScore>::new();
    (
        g.clone().for_each(Plan::employees())
            .filter(|person: &Employee| person.pattern.is_none())
            .penalize(fixed_weight(EscalasScore::of([1], [0; 8])))
            .named("Required personal pattern"),
        g.for_each(Plan::employees())
            .group_by(|person: &Employee| person.sector, Members)
            .penalize(|_sector: &usize, cost: &Cost| {
                EscalasScore::of([cost[0]], std::array::from_fn(|i| cost[i + 1]))
            })
            .named("Sector coverage, presence and rest quality"),
    )
}
