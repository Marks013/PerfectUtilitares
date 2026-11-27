//! Public telemetry from the actual native solve, not simulated CP-SAT phases.
use super::{BTreeMap,Cost,OBJECTIVES,TemporalPlan,V,critical_leadership,json};

pub(super) fn metadata(plan:&TemporalPlan,initial:Cost,final_cost:Cost,times:[f64;3],attempted:bool,accepted:bool)->V{
    let facts:BTreeMap<_,_>=plan.employees.iter().map(|p|(p.sector,&p.facts)).collect();
    let timed=plan.employees.iter().any(|p|!p.untimed);
    let untimed=plan.employees.iter().any(|p|p.untimed);
    let estimated=facts.values().any(|f|f.bands.iter().any(|b|b.estimated));
    let closing=facts.values().any(|f|f.bands.iter().any(|b|b.estimated&&b.start<f.closing&&b.end>f.closing-60));
    let sunday=facts.values().any(|f|f.bands.iter().any(|b|b.estimated&&f.weekday(b.day)==0));
    let movement=facts.values().any(|f|f.priority.iter().enumerate().take(f.days).any(|(d,w)|!f.closed[d]&&w.is_some()));
    let phases:Vec<_>=OBJECTIVES.iter().enumerate().filter_map(|(i,(name,scope))|{
        let active=match *name{
            "COVERAGE"=>estimated&&timed,"CLOSING_COVERAGE"=>closing&&timed,
            "SUNDAY_COVERAGE"=>sunday&&timed,
            "SUNDAY_PEAK"=>sunday&&timed&&plan.employees[0].facts.days>7,
            "MOVEMENT_COVERAGE"=>movement&&estimated&&timed,
            "LEADERSHIP"=>movement,"UNTIMED_ROTATION"=>untimed,_=>true,
        };
        active.then(||json!({"objective":name,"scope":scope,"execution":"LEXICOGRAPHIC_SCORE_LEVEL",
            "status":"FEASIBLE","proven":false,"initialValue":initial[i+1],"incumbentValue":final_cost[i+1]}))
    }).collect();
    let mut out=json!({"engine":"SolverForge","version":1,"method":"BOUNDED_LEXICOGRAPHIC_SEARCH",
        "globalOptimalityProven":false,"partialModel":true,"phases":phases,
        "constructionSeconds":times[0],"feasibilitySeconds":times[1],"refinementSeconds":times[2],
        "stopReason":"BOUNDED_REFINEMENT","nativeSearchAttempted":attempted,"nativeCandidateAccepted":accepted});
    if movement{
        let present=critical_leadership(plan);
        let missing:usize=facts.iter().map(|(&sector,f)|(0..f.days)
            .filter(|&d|!f.closed[d]&&f.priority[d]==Some(3)&&!present.contains(&(sector,d))).count()).sum();
        out["leadership"]=json!({"criticalSectorDaysWithoutLeader":missing,"timedCoverageIncluded":false});
    }
    out
}
