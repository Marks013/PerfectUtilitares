mod domain;
mod model;
mod score;
mod wire;
mod temporal;
mod temporal_domain;
mod temporal_score;

use serde_json::{json, Value};
use solverforge::{MoveThreadCount, SolverConfig};
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};

const MAX_BYTES: usize = 8 * 1024 * 1024;
const BUDGET: Duration = Duration::from_secs(12);
fn seconds(start: Instant) -> f64 { start.elapsed().as_secs_f64() }

fn cgroup() -> Option<Value> {
    let read = |name: &str| std::fs::read_to_string(Path::new("/sys/fs/cgroup").join(name)).ok();
    let stat = read("cpu.stat")?;
    let cpu = stat.lines().find_map(|line| line.strip_prefix("usage_usec "))?.parse::<u64>().ok()?;
    let cpu_max = read("cpu.max")?;
    let mut quota = cpu_max.split_whitespace();
    let q=quota.next()?.parse::<u64>().ok()?;let p=quota.next()?.parse::<u64>().ok()?;
    let peak=read("memory.peak")?.trim().parse::<u64>().ok()?;
    let memory=read("memory.max")?.trim().parse::<u64>().ok()?;
    let pids=read("pids.max")?.trim().parse::<u64>().ok()?;
    if q!=p || p==0 || peak==0 || memory!=1536*1024*1024 || pids!=64 {return None;}
    Some(json!({"version":2,"scope":"container-before-response","cpuUsageUsec":cpu,
        "memoryPeakBytes":peak,"memoryLimitBytes":memory,"cpuQuotaUsec":q,"cpuPeriodUsec":p,"pidsLimit":pids}))
}

fn failure(http: u16, code: &str, stage: &str, detail: &str) -> Value {
    json!({"httpStatus":http,"body":{"error":code,"failureStage":stage,"failureType":detail},"maxRssKiB":null})
}
fn solve(bytes:&[u8], start:Instant, seed_only:bool, budget:Duration, adaptive:bool) -> Value {
    let root:Value=match serde_json::from_slice(bytes) {Ok(v)=>v,Err(_)=>return failure(400,"SPIKE_UNSUPPORTED_INPUT","MAPPING","JSON")};
    let mut plan=match wire::read(&root,start+budget-Duration::from_secs(1)) {
        Ok(v)=>v,Err("MAPPING_TIMEOUT")=>return failure(504,"SOLVER_TIMED_OUT","MAPPING","MAPPING_TIMEOUT"),
        Err("NO_PERSONAL_PATTERN")=>return json!({"httpStatus":200,"body":{"status":"UNKNOWN","message":"No admissible personal pattern","assignments":[],"wallTimeSeconds":seconds(start)},"maxRssKiB":null}),
        Err(code)=>return failure(400,"SPIKE_UNSUPPORTED_INPUT","MAPPING",code)
    };
    let map_seconds=seconds(start);
    let seed_start=Instant::now();
    let (seed_complete,repair)=model::seed(&mut plan,(seed_start+Duration::from_millis(1250)).min(start+Duration::from_secs(2)).min(start+budget-Duration::from_secs(1)));
    let seed_seconds=seconds(seed_start);
    let initialized=plan.employees.iter().filter(|p|p.pattern.is_some()).count();
    let initial_cost=model::evaluate(&plan);
    let people=plan.employees.len();
    let positions:usize=plan.employees.iter().map(|p|p.facts.days).sum();
    let patterns:usize=plan.employees.iter().map(|p|p.allowed.len()).sum();
    let full_domain:usize=plan.employees.iter().map(|p|p.full_domain_count).sum();
    let domain_mode=if plan.employees[0].facts.days==42{
        debug_assert!(plan.employees.iter().all(|p|p.allowed.len()<=model::SCALE_DOMAIN_LIMIT+1));
        "BOUNDED_42"
    }else{"EXACT"};
    let incumbent=adaptive&&model::validate_complete(&plan);
    let search_start=Instant::now();
    let mut attempted=false;
    let mut retained=false;
    let mut native_cost=None;
    let mut last_native_cost=None;
    let mut best_native=None;
    let mut rounds=Vec::new();
    let mut allocated=0u64;
    let mut stop_reason="CONSTRUCTOR_ONLY";
    if !seed_only {
        if incumbent&&plan.employees.iter().all(|p|p.pinned){
            retained=true;stop_reason="PINNED";
        }else{
            loop{
                let remaining=(start+budget-Duration::from_millis(500)).saturating_duration_since(Instant::now()).as_secs()
                    .min(budget.as_secs().saturating_sub(allocated));
                if remaining==0{
                    if incumbent{retained=best_native.is_none();stop_reason="BUDGET_EXHAUSTED";break;}
                    return failure(504,"SOLVER_TIMED_OUT","SEARCH","BUDGET");
                }
                // v0.31.2 does not poll its unimproved-time limit during
                // a long local-search phase. Use a real solver-wide time
                // cap per round; only a guarded strict gain earns more time.
                // Incomplete seeds keep the full original rescue budget.
                let round_budget=if incumbent{remaining.min(2)}else{remaining};
                allocated+=round_budget;
                let before=model::evaluate(&plan);
                let guard=if incumbent{model::SeedGuard::capture(&plan)}else{None};
                if incumbent&&guard.is_none(){return failure(500,"SPIKE_FAILED","SEARCH","INCUMBENT_INVALID");}
                let mut config=match SolverConfig::from_toml_str(include_str!("../solver.toml")){
                    Ok(v)=>v,Err(_)=>return failure(500,"SPIKE_FAILED","FACTORY","CONFIG")
                };
                config=config.with_termination_seconds(round_budget).with_random_seed(37);
                config.move_thread_count=MoveThreadCount::None;
                attempted=true;
                let round_start=Instant::now();
                plan=match plan.solve_with_config(config){Ok(v)=>v,Err(_)=>return failure(500,"SPIKE_FAILED","SEARCH","NATIVE_SOLVE")};
                let computed=model::evaluate(&plan);
                let expected=score::EscalasScore::of([-computed[0]],std::array::from_fn(|i|-computed[i+1]));
                if plan.score!=Some(expected){return failure(500,"SPIKE_FAILED","RESULT","SCORE_DRIFT");}
                last_native_cost=Some(computed);
                let preserves=guard.as_ref().is_none_or(|g|g.preserves(&plan));
                let accepted=guard.is_none()||preserves&&computed<before;
                rounds.push(json!({"budgetSeconds":round_budget,"seconds":seconds(round_start),
                    "beforeCost":before,"candidateCost":computed,"guardPreserved":preserves,"accepted":accepted}));
                if accepted{
                    best_native=Some(computed);
                    if !incumbent{stop_reason="FULL_SEARCH";break;}
                }else{
                    guard.as_ref().expect("guarded round").restore(&mut plan);
                    retained=best_native.is_none();
                    stop_reason=if preserves{"NO_IMPROVEMENT"}else{"GUARD_REJECTED"};
                    break;
                }
            }
        }
        // Attribute the actual returned native candidate (if any), not a
        // discarded later round. lastNativeCost identifies the final attempt.
        native_cost=best_native.or(last_native_cost);
    }
    let search_seconds=if attempted {seconds(search_start)} else {0.0};
    let cost=model::evaluate(&plan);
    if retained && cost!=initial_cost {return failure(500,"SPIKE_FAILED","RESULT","SEED_DRIFT");}
    let valid=model::validate_complete(&plan) && start.elapsed()<=budget;
    let mut rows=Vec::new();
    if valid {
        for person in &plan.employees {
            let mask=person.mask().unwrap();
            for day in 0..person.facts.days {
                let work=model::worked(mask,day);
                let mut row=json!({"employeeId":person.name_id,"date":wire::date(day),"kind":if work {"WORK"} else {"OFF"}});
                if work {row["shiftId"]=json!(person.shift);}
                if let Some(locked)=person.lock_flags[day] {row["locked"]=json!(locked);}
                rows.push(row);
            }
        }
    }
    json!({"httpStatus":200,"body":{"status":if valid {"FEASIBLE"} else {"UNKNOWN"},
        "message":if valid {"Synthetic SolverForge candidate"} else {"No valid complete candidate"},
        "assignments":rows,"wallTimeSeconds":seconds(start)},"maxRssKiB":null,
        "solverforge":{"version":"0.31.2","mode":if seed_only {"SEED_ONLY"} else if adaptive {"ADAPTIVE"} else {"NATIVE"},
            "mapSeconds":map_seconds,"seedSeconds":seed_seconds,"searchSeconds":search_seconds,
            "seedComplete":seed_complete,"nativeSearch":attempted,"entities":people,"positions":positions,
            "stagnationApplied":false,"nativeCost":native_cost,"lastNativeCost":last_native_cost,
            "searchPolicy":if seed_only {"CONSTRUCTOR_ONLY"} else if incumbent {"BOUNDED_ROUNDS"} else {"FULL_BUDGET"},
            "searchStopReason":stop_reason,"searchRounds":rounds,
            "repair":{"sectors":repair.sectors,"projections":repair.projections,"reconstructed":repair.reconstructed,
                "accepted":repair.accepted,"deadlineReached":repair.deadline_reached,"projectionLimitHits":repair.projection_limit_hits,
                "peak":{"attempted":repair.peak.attempted,"accepted":repair.peak.accepted,
                    "beforePeakSum":repair.peak.before_peak_sum,"afterPeakSum":repair.peak.after_peak_sum,
                    "beforePairs":repair.peak.before_pairs,"afterPairs":repair.peak.after_pairs,
                    "deadlineReached":repair.peak.deadline_reached,"limitReached":repair.peak.limit_reached},
                "rest":{"attempted":repair.rest.attempted,"acceptedSingle":repair.rest.accepted_single,
                    "acceptedPair":repair.rest.accepted_pair,"beforePairs":repair.rest.before_pairs,
                    "afterPairs":repair.rest.after_pairs,"deadlineReached":repair.rest.deadline_reached,
                    "limitReached":repair.rest.limit_reached}},
            "resultSource":if seed_only {"CONSTRUCTOR_ONLY"} else if retained {"SEED_RETAINED"} else {"NATIVE"},
            "initialized":initialized,"allowedPatterns":patterns,"fullDomainPatterns":full_domain,"domainMode":domain_mode,"initialCost":initial_cost,"finalCost":cost,
            "partialModel":true,"budgetSeconds":budget.as_secs()}})
}

fn main() {
    let start=Instant::now();
    std::panic::set_hook(Box::new(|_|{}));
    // External process deadline; 12s request acceptance stays separate.
    std::thread::spawn(|| {std::thread::sleep(Duration::from_secs(18));std::process::exit(124);});
    let args:Vec<String>=std::env::args().skip(1).collect();
    let temporal=args.len()==1&&args[0]=="--temporal";
    let service=args.len()==1&&args[0]=="--service";
    let civil_night=args.len()==1&&args[0]=="--temporal-civil-night";
    let seed_only=args.len()==1&&args[0]=="--seed-only";
    let adaptive=args.len()==1&&args[0]=="--adaptive";
    let budget=match args.as_slice() {
        [] => Some(BUDGET),
        [flag] if flag=="--seed-only" || flag=="--adaptive" || flag=="--temporal" || flag=="--temporal-civil-night" || flag=="--service" => Some(BUDGET),
        [flag] => flag.strip_prefix("--budget-seconds=").and_then(|v|v.parse::<u64>().ok())
            .filter(|v|matches!(v,2|4|8|12)).map(Duration::from_secs),
        _=>None,
    };
    let mut bytes=Vec::new();
    let mut reply=if budget.is_none() {failure(400,"SPIKE_UNSUPPORTED_INPUT","MAPPING","ARGUMENT")}
        else if std::io::stdin().take((MAX_BYTES+1) as u64).read_to_end(&mut bytes).is_err() {failure(400,"SPIKE_UNSUPPORTED_INPUT","MAPPING","INPUT")}
        else if bytes.len()>MAX_BYTES {failure(413,"SPIKE_INPUT_LIMIT","MAPPING","SIZE")}
        else {std::panic::catch_unwind(||if service{temporal::solve_service(&bytes,start,budget.unwrap())}else if civil_night{temporal::solve_civil_night(&bytes,start,budget.unwrap())}else if temporal {temporal::solve(&bytes,start,budget.unwrap())} else {solve(&bytes,start,seed_only,budget.unwrap(),adaptive)}).unwrap_or_else(|_|failure(500,"SPIKE_FAILED","RESULT","PANIC"))};
    reply["cgroup"]=cgroup().unwrap_or(Value::Null);
    let mut output=serde_json::to_vec(&reply).unwrap_or_default();
    if reply["body"]["status"]=="FEASIBLE" && start.elapsed()>budget.unwrap_or(BUDGET) {
        reply["body"]["status"]=json!("UNKNOWN");reply["body"]["assignments"]=json!([]);
        reply["body"]["wallTimeSeconds"]=json!(seconds(start));output=serde_json::to_vec(&reply).unwrap_or_default();
    }
    if output.is_empty()||output.len()>MAX_BYTES {output=br#"{"httpStatus":500,"body":{"error":"SPIKE_OUTPUT_LIMIT"},"maxRssKiB":null}"#.to_vec();}
    let mut out=std::io::stdout().lock();let _=out.write_all(&output);let _=out.write_all(b"\n");
}

#[cfg(test)]
mod integration {
    use super::*;

    fn input() -> Value {
        json!({"input":{"schemaVersion":1,"branchCode":"SYNTH","simulation":true,
            "timeZone":"America/Sao_Paulo","planningWeekStartsOn":"SUNDAY","restRulesVersion":3,
            "generationMode":"DAYS_AND_HOURS","defaultWeeklyHours":42,"startDate":"2026-11-01","endDate":"2026-11-07",
            "storeClosingMinutes":1200,"policy":{"calendarMode":"MANUAL","normativeProfile":"CUSTOM",
                "weeklyLimit":44,"dailyLimitMinutes":528,"maxConsecutiveWorkDays":5,"minMealMinutes":60,
                "minInterShiftMinutes":660,"minWeeklyRestMinutes":2100,"closedDates":[],"holidayDates":[],"authorizedHolidayDates":[]},
            "shifts":[{"id":"clock","segments":[{"kind":"WORK","start":420,"end":660},{"kind":"BREAK","start":660,"end":780},{"kind":"WORK","start":780,"end":1044}]}],
            "employees": (0..3).map(|i|json!({"id":format!("person-{i}"),"name":format!("Synthetic person {i}"),
                "sector":"S","role":"Repositor","weeklyHours":42,"shiftIds":["clock"],"scheduleMode":"TIMED",
                "offMode":"VARIABLE","offPattern":"ANY","activeFrom":"","maxConsecutiveSundays":1,
                "historyKnown":false,"history":[],"fixedOffDays":[],"preferredOffDays":[]})).collect::<Vec<_>>(),
            "assignments":[{"employeeId":"person-0","date":"2026-11-01","kind":"OFF","locked":true}],
            "demands": (1..=7).map(|i|json!({"id":format!("synthetic-demand-{i}"),"date":format!("2026-11-{i:02}"),"sector":"S",
                "start":480,"end":540,"minimum":1,"estimated":true})).collect::<Vec<_>>()}})
    }

    #[test]
    fn exact_mapper_pins_and_native_search() {
        let mut plan=wire::read(&input(),Instant::now()+Duration::from_secs(5)).expect("valid wire");
        assert_eq!(plan.employees.len(),3);
        assert!(std::sync::Arc::ptr_eq(&plan.employees[1].allowed,&plan.employees[2].allowed));
        assert!(model::seed(&mut plan,Instant::now()+Duration::from_secs(5)).0);
        assert!(model::validate_complete(&plan));
        let before=model::evaluate(&plan);
        let config=SolverConfig::from_toml_str("environment_mode = \"fast_assert\"\nrandom_seed = 37\nmove_thread_count = \"none\"\n[termination]\nseconds_spent_limit = 1\n").unwrap();
        let solved=plan.solve_with_config(config).expect("native solver");
        assert!(model::validate_complete(&solved));
        assert!(!model::worked(solved.employees[0].mask().unwrap(),0));
        let after=model::evaluate(&solved);
        assert!(after<=before);
        let expected=score::EscalasScore::of([-after[0]],std::array::from_fn(|i|-after[i+1]));
        assert_eq!(solved.score,Some(expected));
    }

    #[test]
    fn malformed_wire_and_partial_warm_start_rejected() {
        let mut value=input();
        value["input"]["simulation"]=json!("true");
        assert!(matches!(wire::read(&value,Instant::now()+Duration::from_secs(5)),Err("EXPECTED_BOOLEAN")));
        let mut value=input();
        value["input"]["_initialAssignments"]=value["input"]["assignments"].clone();
        assert!(matches!(wire::read(&value,Instant::now()+Duration::from_secs(5)),Err("INCOMPLETE_SEED")));
        let mut value=input();
        value["input"]["_restPairTarget"]=json!(20);
        assert!(matches!(wire::read(&value,Instant::now()+Duration::from_secs(5)),Err("PRIVATE_FIELD_UNSUPPORTED")));
    }

    #[test]
    fn rejects_unmodeled_metadata_and_duplicate_demands() {
        let deadline = || Instant::now() + Duration::from_secs(5);
        for (key, value) in [
            ("monthlyCarry", json!(true)),
            ("carriedHolidayRest", json!(true)),
            ("absenceSource", json!("MANUAL")),
        ] {
            let mut data = input();
            data["input"]["assignments"][0][key] = value;
            assert!(matches!(wire::read(&data, deadline()), Err("ASSIGNMENT_METADATA_UNSUPPORTED")));
        }
        let mut data = input();
        data["input"]["planningCalendarSource"] = json!({"workspaceId":"synthetic","revision":1});
        assert!(matches!(wire::read(&data, deadline()), Err("CALENDAR_SOURCE_UNSUPPORTED")));
        let mut data = input();
        data["input"]["employees"][0]["leadership"] = json!({"source":"MANUAL","role":"SECTOR","sectors":["S"]});
        assert!(matches!(wire::read(&data, deadline()), Err("LEADERSHIP_UNSUPPORTED")));
        let mut data = input();
        data["input"]["policy"]["operationalCertificate"] = json!({});
        assert!(matches!(wire::read(&data, deadline()), Err("POLICY_METADATA_UNSUPPORTED")));
        let mut data = input();
        data["input"]["demands"][1]["id"] = data["input"]["demands"][0]["id"].clone();
        assert!(matches!(wire::read(&data, deadline()), Err("DUPLICATE_DEMAND")));
    }

    #[test]
    fn distinct_roles_are_distinct_weekend_cohorts() {
        let mut data=input();
        data["input"]["employees"][0]["role"]=json!("Encarregado");
        let plan=wire::read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        assert_ne!(plan.employees[0].cohort,plan.employees[1].cohort);
        assert_eq!(plan.employees[1].cohort,plan.employees[2].cohort);
    }

    #[test]
    fn rejects_clock_arithmetic_outside_civil_bounds() {
        let mut data=input();
        data["input"]["shifts"][0]["segments"][0]["start"]=json!(2147483647);
        assert!(matches!(wire::read(&data,Instant::now()+Duration::from_secs(5)),Err("CLOCK_RANGE")));
    }

    #[test]
    fn common_java_rust_wire_contract() {
        let corpus:Value=serde_json::from_str(include_str!("e2-wire-contract.json")).unwrap();
        assert_eq!(corpus["version"],"E2-WIRE-1");
        assert_eq!(corpus["cases"].as_array().unwrap().len(),26);
        for sample in corpus["cases"].as_array().unwrap() {
            let name=sample["name"].as_str().unwrap();
            let mut value=corpus["base"].clone();
            if let Some(pointer)=sample["pointer"].as_str() {
                let (parent,key)=pointer.rsplit_once('/').unwrap();
                value.pointer_mut(parent).and_then(Value::as_object_mut).unwrap()
                    .insert(key.to_owned(),sample["value"].clone());
            }
            let result=wire::read(&value,Instant::now()+Duration::from_secs(5));
            if sample["accept"]==true {
                let plan=result.unwrap_or_else(|err|panic!("{name}: {err}"));
                assert_eq!(plan.employees.len(),1,"{name}");
                assert_eq!(plan.employees[0].facts.days,7,"{name}");
                assert_eq!(plan.employees[0].facts.bands.len(),1,"{name}");
            } else {
                assert!(result.is_err(),"{name}");
            }
        }
    }

    #[test]
    fn shared_custom_profile_corpus_uses_native_search() {
        let corpus:Value=serde_json::from_str(include_str!("e3a-fixed-clock-contract.json")).unwrap();
        assert_eq!(corpus["version"],"E3A-FIXED-CLOCK-1");
        let input=&corpus["base"];
        let mut plan=wire::read(input,Instant::now()+Duration::from_secs(5)).unwrap();
        assert!(model::seed(&mut plan,Instant::now()+Duration::from_secs(5)).0);
        assert!(model::validate_complete(&plan));
        let config=SolverConfig::from_toml_str("environment_mode = \"fast_assert\"\nrandom_seed = 37\nmove_thread_count = \"none\"\n[termination]\nseconds_spent_limit = 1\n").unwrap();
        let result=plan.solve_with_config(config).unwrap();
        assert!(model::validate_complete(&result));
        assert_eq!(result.employees.len(),3);
        for (i,p) in result.employees.iter().enumerate(){
            assert_eq!(p.shift,format!("clock-{}",40+2*i));
            let mask=p.mask().unwrap();
            assert_eq!(mask.count_ones(),5);
            assert!(model::worked(mask,6));
            if i==0 {
                assert!(!model::worked(mask,1));
                assert!(!model::worked(mask,0)||!model::worked(mask,2));
            }
            if i==1 {assert!(!model::worked(mask,2)&&!model::worked(mask,5));}
        }
        let costs=model::evaluate(&result);
        assert_eq!(result.score,Some(score::EscalasScore::of([-costs[0]],std::array::from_fn(|i|-costs[i+1]))));
        for mutation in corpus["mutations"].as_array().unwrap(){
            let mut value=input.clone();
            let (parent,key)=mutation["pointer"].as_str().unwrap().rsplit_once('/').unwrap();
            value.pointer_mut(parent).unwrap().as_object_mut().unwrap().insert(key.to_owned(),mutation["value"].clone());
            assert!(wire::read(&value,Instant::now()+Duration::from_secs(5)).is_err(),"{}",mutation["name"]);
        }
    }

    #[test]
    fn custom_fixed_clock_profiles_preserve_individual_rules() {
        for (hours,end) in [(40,1020),(42,1044),(44,1068)] {
            let mut data=input();
            data["input"]["defaultWeeklyHours"]=json!(hours);
            data["input"]["shifts"][0]["segments"][2]["end"]=json!(end);
            for p in data["input"]["employees"].as_array_mut().unwrap(){p["weeklyHours"]=json!(hours);}
            data["input"]["assignments"]=json!([]);
            let p=&mut data["input"]["employees"][0];
            p["offMode"]=json!("MIXED");p["fixedOffDays"]=json!([0]);
            p["fixedRestSlots"]=json!([{"enabled":true,"weekday":0},{"enabled":false,"weekday":4}]);
            p["offPattern"]=json!("CONSECUTIVE");
            let p=&mut data["input"]["employees"][1];
            p["offMode"]=json!("FIXED");p["fixedOffDays"]=json!([1,4]);
            let p=&mut data["input"]["employees"][2];
            p["offPattern"]=json!("PREFER_CONSECUTIVE");p["preferredOffDays"]=json!([2]);
            data["input"]["generationMode"]=json!("REST_ONLY");
            let mut plan=wire::read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
            assert!(model::seed(&mut plan,Instant::now()+Duration::from_secs(5)).0);
            assert!(model::validate_complete(&plan));
            for p in &plan.employees{
                let m=p.mask().unwrap();
                assert_eq!(m.count_ones(),5);
                assert!(model::worked(m,6));
            }
            let m=plan.employees[0].mask().unwrap();
            assert!(!model::worked(m,1));
            let off=!m&127;assert_ne!(off&(off>>1),0);
            let m=plan.employees[1].mask().unwrap();
            assert!(!model::worked(m,2)&&!model::worked(m,5));
            let config=SolverConfig::from_toml_str("environment_mode = \"fast_assert\"\nrandom_seed = 37\nmove_thread_count = \"none\"\n[termination]\nseconds_spent_limit = 1\n").unwrap();
            let solved=plan.solve_with_config(config).unwrap();
            assert!(model::validate_complete(&solved));
            let costs=model::evaluate(&solved);
            assert_eq!(solved.score,Some(score::EscalasScore::of([-costs[0]],std::array::from_fn(|i|-costs[i+1]))));
        }
    }

    #[test]
    fn fixed_rest_and_weekly_caps_are_not_silently_relaxed(){
        let mut data=input();
        data["input"]["employees"][0]["offMode"]=json!("MIXED");
        data["input"]["employees"][0]["fixedOffDays"]=json!([5]);
        assert!(matches!(wire::read(&data,Instant::now()+Duration::from_secs(5)),Err("FIXED_SATURDAY")));
        data["input"]["employees"][0]["fixedOffDays"]=json!([0]);
        data["input"]["employees"][0]["fixedRestSlots"]=json!([{"enabled":true,"weekday":1},{"enabled":false,"weekday":null}]);
        assert!(matches!(wire::read(&data,Instant::now()+Duration::from_secs(5)),Err("FIXED_REST_PROJECTION")));
        let mut data=input();
        data["input"]["policy"]["weeklyLimit"]=json!(40);
        assert!(matches!(wire::read(&data,Instant::now()+Duration::from_secs(5)),Err("WEEKLY_MINUTES")));
    }

    #[test]
    fn fixed_clock_hours_only_changes_clocks_without_moving_days_or_locks(){
        let mut data=input();
        data["input"]["generationMode"]=json!("HOURS_ONLY");
        let mut old=data["input"]["shifts"][0].clone();
        old["id"]=json!("old");old["segments"][2]["end"]=json!(1020);
        data["input"]["shifts"].as_array_mut().unwrap().push(old);
        data["input"]["assignments"]=Value::Array((0..3).flat_map(|i|(0..7).map(move |d|{
            let rest=d==0||d==3;
            let mut row=json!({"employeeId":format!("person-{i}"),"date":wire::date(d),
                "kind":if rest{"OFF"}else{"WORK"},"locked":d==6});
            if !rest{row["shiftId"]=json!(if d==6{"clock"}else{"old"});}
            row
        })).collect());
        let bytes=serde_json::to_vec(&data).unwrap();
        let answer=solve(&bytes,Instant::now(),true,BUDGET,false);
        assert_eq!(answer["body"]["status"],"FEASIBLE");
        for (before,after) in data["input"]["assignments"].as_array().unwrap().iter()
            .zip(answer["body"]["assignments"].as_array().unwrap()){
            for key in ["employeeId","date","kind","locked"]{assert_eq!(before[key],after[key]);}
            if before["kind"]=="WORK"{assert_eq!(after["shiftId"],"clock");}
        }
        data["input"]["assignments"][6]["shiftId"]=json!("old");
        assert!(matches!(wire::read(&data,Instant::now()+Duration::from_secs(5)),Err("ASSIGNMENT_CLOCK")));
        data["input"]["assignments"].as_array_mut().unwrap().pop();
        assert!(wire::read(&data,Instant::now()+Duration::from_secs(5)).is_err());
    }

    #[test]
    fn rest_only_selects_first_reference_of_the_same_duration(){
        let mut data=input();
        let mut alternate=data["input"]["shifts"][0].clone();
        alternate["id"]=json!("other");
        data["input"]["shifts"].as_array_mut().unwrap().push(alternate);
        data["input"]["employees"][0]["shiftIds"]=json!(["other","clock"]);
        data["input"]["generationMode"]=json!("REST_ONLY");
        let plan=wire::read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        assert_eq!(plan.employees[0].shift,"other");
        data["input"]["generationMode"]=json!("DAYS_AND_HOURS");
        assert!(matches!(wire::read(&data,Instant::now()+Duration::from_secs(5)),Err("CLOCK_OPTIONS")));
    }

    #[test]
    fn scaled_42_day_wire_and_constructor_preserve_complete_personal_domains(){
        for people in [115,250]{
            let mut data=input();
            data["input"]["endDate"]=json!("2026-12-12");
            let template=data["input"]["employees"][1].clone();
            data["input"]["employees"]=Value::Array((0..people).map(|i|{
                let mut p=template.clone();
                p["id"]=json!(format!("person-{i}"));p["name"]=json!(format!("Synthetic person {i}"));
                p["sector"]=json!(format!("Sector {}",i/12+1));p
            }).collect());
            data["input"]["assignments"]=json!([]);
            data["input"]["demands"]=json!([]);
            let mut plan=wire::read(&data,Instant::now()+Duration::from_secs(10)).unwrap();
            assert_eq!(plan.employees.len(),people);
            assert!(plan.employees.iter().all(|p|p.facts.days==42&&p.allowed.len()==model::SCALE_DOMAIN_LIMIT
                &&p.full_domain_count==587620));
            assert!(std::sync::Arc::ptr_eq(&plan.employees[0].catalog,&plan.employees[people-1].catalog));
            assert!(model::seed(&mut plan,Instant::now()+Duration::from_secs(10)).0);
            assert!(model::validate_complete(&plan));
            assert_eq!(wire::date(30),"2026-12-01");assert_eq!(wire::date(41),"2026-12-12");
        }
    }

    #[test]
    fn adaptive_uses_bounded_native_rounds_and_preserves_incumbent(){
        let bytes=serde_json::to_vec(&input()).unwrap();
        let reply=solve(&bytes,Instant::now(),false,BUDGET,true);
        assert_eq!(reply["body"]["status"],"FEASIBLE");
        let t=&reply["solverforge"];
        assert_eq!(t["searchPolicy"],"BOUNDED_ROUNDS");
        assert_eq!(t["stagnationApplied"],false);
        let rounds=t["searchRounds"].as_array().unwrap();
        assert!(!rounds.is_empty());
        assert!(rounds.iter().all(|r|r["budgetSeconds"].as_u64().is_some_and(|n|(1..=2).contains(&n))));
        assert!(rounds.iter().take(rounds.len()-1).all(|r|r["accepted"]==true));
        assert_eq!(t["lastNativeCost"],rounds.last().unwrap()["candidateCost"]);
    }

    #[test]
    fn seed_only_is_not_reported_as_native_search() {
        let bytes=serde_json::to_vec(&input()).unwrap();
        let reply=solve(&bytes,Instant::now(),true,BUDGET,false);
        assert_eq!(reply["body"]["status"],"FEASIBLE");
        assert_eq!(reply["solverforge"]["mode"],"SEED_ONLY");
        assert_eq!(reply["solverforge"]["nativeSearch"],false);
        assert_eq!(reply["solverforge"]["resultSource"],"CONSTRUCTOR_ONLY");
        assert_eq!(reply["solverforge"]["nativeCost"],Value::Null);
        assert_eq!(reply["body"]["assignments"].as_array().unwrap().len(),21);
    }
}
