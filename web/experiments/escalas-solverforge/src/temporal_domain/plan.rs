use solverforge::prelude::*;
use solverforge::stream::collector::Collector;
use super::TemporalEmployee;
use crate::temporal::{Cost,Member,TemporalAccumulator};
use crate::temporal_score::TemporalScore;

#[planning_solution(constraints = "define_temporal_constraints")]
pub struct TemporalPlan {
    #[planning_entity_collection]
    pub employees: Vec<TemporalEmployee>,
    #[planning_score]
    pub score: Option<TemporalScore>,
}

#[derive(Clone, Copy)]
struct Members;
impl Collector<&TemporalEmployee> for Members {
    type Value=Member;
    type Result=Cost;
    type Accumulator=TemporalAccumulator;
    fn extract(&self,input:&TemporalEmployee)->Member {input.member()}
    fn create_accumulator(&self)->TemporalAccumulator {TemporalAccumulator::default()}
}

#[solverforge_constraints]
fn define_temporal_constraints() -> impl ConstraintSet<TemporalPlan, TemporalScore> {
    let g=ConstraintFactory::<TemporalPlan,TemporalScore>::new();
    (
        g.clone().for_each(TemporalPlan::employees())
            .filter(|p:&TemporalEmployee|p.pattern.is_none())
            .penalize(fixed_weight(TemporalScore::of([1],[0;16])))
            .named("Missing legal temporal pattern"),
        g.for_each(TemporalPlan::employees())
            .group_by(|p:&TemporalEmployee|p.sector,Members)
            .penalize(|_sector:&usize,cost:&Cost|TemporalScore::of([cost[0]],std::array::from_fn(|i|cost[i+1])))
            .named("Temporal sector score"),
    )
}
