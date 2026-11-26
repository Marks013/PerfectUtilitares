mod domain;
mod model;
mod score;
mod wire;

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
fn solve(bytes:&[u8], start:Instant, seed_only:bool, budget:Duration) -> Value {
    let root:Value=match serde_json::from_slice(bytes) {Ok(v)=>v,Err(_)=>return failure(400,"SPIKE_UNSUPPORTED_INPUT","MAPPING","JSON")};
    let mut plan=match wire::read(&root,start+budget-Duration::from_secs(1)) {
        Ok(v)=>v,Err("MAPPING_TIMEOUT")=>return failure(504,"SOLVER_TIMED_OUT","MAPPING","MAPPING_TIMEOUT"),
        Err("NO_PERSONAL_PATTERN")=>return json!({"httpStatus":200,"body":{"status":"UNKNOWN","message":"No admissible personal pattern","assignments":[],"wallTimeSeconds":seconds(start)},"maxRssKiB":null}),
        Err(code)=>return failure(400,"SPIKE_UNSUPPORTED_INPUT","MAPPING",code)
    };
    let map_seconds=seconds(start);
    let seed_start=Instant::now();
    let seed_complete=model::seed(&mut plan,(seed_start+Duration::from_millis(1250)).min(start+Duration::from_secs(2)).min(start+budget-Duration::from_secs(1)));
    let seed_seconds=seconds(seed_start);
    let initialized=plan.employees.iter().filter(|p|p.pattern.is_some()).count();
    let initial_cost=model::evaluate(&plan);
    let people=plan.employees.len();
    let positions:usize=plan.employees.iter().map(|p|p.facts.days).sum();
    let patterns:usize=plan.employees.iter().map(|p|p.allowed.len()).sum();
    let search_start=Instant::now();
    if !seed_only {
        let remaining=(start+budget-Duration::from_millis(500)).saturating_duration_since(search_start).as_secs();
        if remaining==0 {return failure(504,"SOLVER_TIMED_OUT","SEARCH","BUDGET");}
        let mut config=match SolverConfig::from_toml_str(include_str!("../solver.toml")) {
            Ok(v)=>v,Err(_)=>return failure(500,"SPIKE_FAILED","FACTORY","CONFIG")
        };
        config=config.with_termination_seconds(remaining).with_random_seed(37);
        config.move_thread_count=MoveThreadCount::None;
        plan=match plan.solve_with_config(config) {Ok(v)=>v,Err(_)=>return failure(500,"SPIKE_FAILED","SEARCH","NATIVE_SOLVE")};
    }
    let search_seconds=if seed_only {0.0} else {seconds(search_start)};
    let cost=model::evaluate(&plan);
    if !seed_only {
        let expected=score::EscalasScore::of([-cost[0]],std::array::from_fn(|i|-cost[i+1]));
        if plan.score!=Some(expected) {return failure(500,"SPIKE_FAILED","RESULT","SCORE_DRIFT");}
    }
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
        "solverforge":{"version":"0.31.2","mode":if seed_only {"SEED_ONLY"} else {"NATIVE"},
            "mapSeconds":map_seconds,"seedSeconds":seed_seconds,"searchSeconds":search_seconds,
            "seedComplete":seed_complete,"nativeSearch":!seed_only,"entities":people,"positions":positions,
            "initialized":initialized,"allowedPatterns":patterns,"initialCost":initial_cost,"finalCost":cost,
            "partialModel":true,"budgetSeconds":budget.as_secs()}})
}

fn main() {
    let start=Instant::now();
    std::panic::set_hook(Box::new(|_|{}));
    // External process deadline; 12s request acceptance stays separate.
    std::thread::spawn(|| {std::thread::sleep(Duration::from_secs(18));std::process::exit(124);});
    let args:Vec<String>=std::env::args().skip(1).collect();
    let seed_only=args.len()==1&&args[0]=="--seed-only";
    let budget=match args.as_slice() {
        [] => Some(BUDGET),
        [flag] if flag=="--seed-only" => Some(BUDGET),
        [flag] => flag.strip_prefix("--budget-seconds=").and_then(|v|v.parse::<u64>().ok())
            .filter(|v|matches!(v,2|4|8|12)).map(Duration::from_secs),
        _=>None,
    };
    let mut bytes=Vec::new();
    let mut reply=if budget.is_none() {failure(400,"SPIKE_UNSUPPORTED_INPUT","MAPPING","ARGUMENT")}
        else if std::io::stdin().take((MAX_BYTES+1) as u64).read_to_end(&mut bytes).is_err() {failure(400,"SPIKE_UNSUPPORTED_INPUT","MAPPING","INPUT")}
        else if bytes.len()>MAX_BYTES {failure(413,"SPIKE_INPUT_LIMIT","MAPPING","SIZE")}
        else {std::panic::catch_unwind(||solve(&bytes,start,seed_only,budget.unwrap())).unwrap_or_else(|_|failure(500,"SPIKE_FAILED","RESULT","PANIC"))};
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
        assert!(model::seed(&mut plan,Instant::now()+Duration::from_secs(5)));
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
    fn seed_only_is_not_reported_as_native_search() {
        let bytes=serde_json::to_vec(&input()).unwrap();
        let reply=solve(&bytes,Instant::now(),true,BUDGET);
        assert_eq!(reply["body"]["status"],"FEASIBLE");
        assert_eq!(reply["solverforge"]["mode"],"SEED_ONLY");
        assert_eq!(reply["solverforge"]["nativeSearch"],false);
        assert_eq!(reply["body"]["assignments"].as_array().unwrap().len(),21);
    }
}
