use serde_json::Value as V;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;
use std::time::Instant;
use crate::domain::{Employee, Plan};
use crate::model::{Band, Sector, Presence, allowed_indices, catalog, full_mask};

type Result<T> = std::result::Result<T, &'static str>;
fn check(ok: bool, code: &'static str) -> Result<()> { if ok { Ok(()) } else { Err(code) } }
fn text<'a>(v: &'a V, k: &str) -> Result<&'a str> { v.get(k).and_then(V::as_str).ok_or("EXPECTED_TEXT") }
fn identifier<'a>(v: &'a V, k: &str) -> Result<&'a str> {
    let value=text(v,k)?;
    check(!value.is_empty() && value.chars().count()<=100,"IDENTIFIER")?;
    Ok(value)
}
fn empty_array(v:&V,k:&str)->bool {
    v.get(k).is_none_or(|x|x.as_array().is_some_and(Vec::is_empty))
}
fn valid_inactive_slot(slot:&V)->bool {
    slot.as_object().is_some_and(|o|o.len()==2)
        && slot.get("enabled").and_then(V::as_bool)==Some(false)
        && slot.get("weekday").is_some_and(|d|d.is_null()||d.as_i64().is_some_and(|n|(0..=6).contains(&n)))
}
fn number(v: &V, k: &str) -> Result<i32> {
    v.get(k).and_then(V::as_i64).and_then(|n| i32::try_from(n).ok()).ok_or("EXPECTED_INTEGER")
}
fn boolean(v: &V, k: &str, default: bool) -> Result<bool> {
    match v.get(k) { None => Ok(default), Some(value) => value.as_bool().ok_or("EXPECTED_BOOLEAN") }
}
fn optional_text<'a>(v: &'a V, k: &str, default: &'a str) -> Result<&'a str> {
    if v.get(k).is_none() { Ok(default) } else { text(v, k) }
}
fn array<'a>(v: &'a V, k: &str) -> Result<&'a Vec<V>> {
    let items = v.get(k).and_then(V::as_array).ok_or("EXPECTED_ARRAY")?;
    check(items.len() <= 12000, "ARRAY_LIMIT")?;
    Ok(items)
}
fn empty(v: &V, k: &str) -> bool {
    v.get(k).is_none_or(|x| x.as_array().is_some_and(Vec::is_empty) || x.as_object().is_some_and(|o| o.is_empty()))
}
fn range(v: i32, low: i32, high: i32) -> bool { v >= low && v <= high }

fn civil_date(value: &str) -> bool {
    let s = value.as_bytes();
    if s.len() != 10 || s[4] != b'-' || s[7] != b'-'
        || !s.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) { return false; }
    let year = value[0..4].parse::<u32>().unwrap_or(0);
    let month = value[5..7].parse::<usize>().unwrap_or(0);
    let day = value[8..10].parse::<u32>().unwrap_or(0);
    if !(1900..=2099).contains(&year) || !(1..=12).contains(&month) { return false; }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let lengths = [31, if leap {29} else {28},31,30,31,30,31,31,30,31,30,31];
    day > 0 && day <= lengths[month - 1]
}
fn date_index(value: &str, days: usize) -> Result<usize> {
    check(civil_date(value) && value.starts_with("2026-11-"), "DATE")?;
    let index = value[8..].parse::<usize>().map_err(|_| "DATE")? - 1;
    check(index < days, "DATE")?;
    Ok(index)
}
pub fn date(index: usize) -> String { format!("2026-11-{:02}", index + 1) }

#[derive(Clone, Debug)]
struct Person {
    id: String, sector: usize, role: String, shift: String,
    segments: [(i32, i32); 2], cap: usize,
}
#[derive(Clone, Copy, Debug)]
struct Row { work: bool, locked: Option<bool> }

fn records(input: &V, field: &str, people: &[Person], by_id: &HashMap<String, usize>, days: usize)
    -> Result<BTreeMap<(usize, usize), Row>> {
    let mut result = BTreeMap::new();
    for row in array(input, field)? {
        // Carry/absence metadata has semantics beyond this experiment.
        for key in ["absenceSource", "monthlyCarry", "carriedHolidayRest"] {
            check(row.get(key).is_none(), "ASSIGNMENT_METADATA_UNSUPPORTED")?;
        }
        let person = *by_id.get(text(row, "employeeId")?).ok_or("ASSIGNMENT_REFERENCE")?;
        let day = date_index(text(row, "date")?, days)?;
        let work = match text(row, "kind")? { "WORK" => true, "OFF" => false, _ => return Err("ASSIGNMENT_KIND") };
        check(if work { row.get("shiftId").and_then(V::as_str) == Some(people[person].shift.as_str()) }
            else { row.get("shiftId").is_none() }, "ASSIGNMENT_CLOCK")?;
        let locked = match row.get("locked") { None => None, Some(v) => Some(v.as_bool().ok_or("LOCK_TYPE")?) };
        check(result.insert((person, day), Row { work, locked }).is_none(), "DUPLICATE_ASSIGNMENT")?;
    }
    Ok(result)
}

pub fn read(root: &V, deadline: Instant) -> Result<Plan> {
    check(root.as_object().is_some_and(|o| o.len() == 1) && root["input"].is_object(), "ENVELOPE")?;
    let input = &root["input"];
    let policy = &input["policy"];
    check(number(input,"schemaVersion")? == 1 && text(input,"branchCode")? == "SYNTH"
        && boolean(input,"simulation",false)? && text(input,"timeZone")? == "America/Sao_Paulo"
        && text(input,"planningWeekStartsOn")? == "SUNDAY" && number(input,"restRulesVersion")? == 3
        && number(input,"defaultWeeklyHours")? == 42
        && optional_text(input,"generationMode","DAYS_AND_HOURS")? == "DAYS_AND_HOURS", "SYNTHETIC_ONLY")?;
    check(text(input,"startDate")? == "2026-11-01" && input.get("visibleMonth").is_none(), "HORIZON")?;
    let days = match text(input,"endDate")? { "2026-11-07" => 7, "2026-11-28" => 28, _ => return Err("HORIZON") };
    for k in input.as_object().unwrap().keys() {
        check(!k.starts_with('_') || k == "_initialAssignments", "PRIVATE_FIELD_UNSUPPORTED")?;
    }
    for k in ["mixed42Sectors","movementPriorities"] { check(empty(input,k), "UNSUPPORTED_INPUT")?; }
    check(input.get("planningCalendarSource").is_none(), "CALENDAR_SOURCE_UNSUPPORTED")?;
    for k in ["calendarProvenance", "collectiveAgreement", "operationalCertificate"] {
        check(policy.get(k).is_none(), "POLICY_METADATA_UNSUPPORTED")?;
    }
    check(text(policy,"calendarMode")? == "MANUAL" && optional_text(policy,"normativeProfile","CUSTOM")? == "CUSTOM"
        && matches!(number(policy,"weeklyLimit")?,42|44) && range(number(policy,"dailyLimitMinutes")?,504,600)
        && number(policy,"maxConsecutiveWorkDays")? == 5 && policy.get("mealIntervalAgreement").is_none(), "POLICY")?;
    for k in ["closedDates","holidayDates","authorizedHolidayDates","paidHolidayDates"] { check(empty(policy,k), "HOLIDAY_UNSUPPORTED")?; }
    let closing = number(input,"storeClosingMinutes")?;
    let meal = number(policy,"minMealMinutes")?;
    let inter = number(policy,"minInterShiftMinutes")?;
    let weekly_rest = number(policy,"minWeeklyRestMinutes")?;
    check(range(closing,300,1440) && range(meal,30,180) && range(inter,660,1440) && range(weekly_rest,2100,4320), "POLICY_LIMIT")?;
    let limit_blocks = boolean(policy,"limitContinuousWorkBlocks",false)?;
    let mut clocks = BTreeMap::new();
    let shift_rows=array(input,"shifts")?;
    check(!shift_rows.is_empty() && shift_rows.len()<=120,"CLOCK_LIMIT")?;
    for clock in shift_rows {
        let segments = array(clock,"segments")?;
        check(segments.len() == 3, "CLOCK_KIND")?;
        check(text(&segments[0],"kind")? == "WORK" && text(&segments[1],"kind")? == "BREAK"
            && text(&segments[2],"kind")? == "WORK", "CLOCK_KIND")?;
        let a=number(&segments[0],"start")?; let b=number(&segments[0],"end")?;
        let c=number(&segments[1],"start")?; let d=number(&segments[1],"end")?;
        let e=number(&segments[2],"start")?; let f=number(&segments[2],"end")?;
        check([a,b,c,d,e,f].iter().all(|&v|range(v,0,1440)), "CLOCK_RANGE")?;
        check(a >= 300 && a < b && b == c && c < d && d == e && e < f && f <= closing.min(1200)
            && b-a+f-e == 504 && d-c >= meal && d-c <=120 && 1440-(f-a) >= inter
            && 2880-(f-a) >= weekly_rest && (!limit_blocks || (b-a).max(f-e) <= 270), "CLOCK_GEOMETRY")?;
        check(clocks.insert(identifier(clock,"id")?.to_string(),[(a,b),(e,f)]).is_none(), "DUPLICATE_CLOCK")?;
    }
    let employees = array(input,"employees")?;
    check(!employees.is_empty() && employees.len() <= 50, "PEOPLE_LIMIT")?;
    let mut sectors = BTreeMap::<String,usize>::new();
    let mut people = Vec::new();
    let mut by_id = HashMap::new();
    for person in employees {
        let id = identifier(person,"id")?;
        check(id.strip_prefix("person-").is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
            && text(person,"name")?.starts_with("Synthetic person "), "SYNTHETIC_ID")?;
        let active = text(person,"activeFrom")?;
        check(boolean(person,"planningEnabled",true)? && text(person,"scheduleMode")? == "TIMED"
            && number(person,"weeklyHours")? == 42 && text(person,"offMode")? == "VARIABLE"
            && text(person,"offPattern")? == "ANY" && !boolean(person,"historyKnown",false)?
            && person.get("activeUntil").is_none() && person.get("simulationDailyMinutes").is_none()
            && (active.is_empty() || civil_date(active) && active <= "2026-11-01"), "PERSON_PROFILE")?;
        check(["INDIVIDUAL","BRANCH"].contains(&optional_text(person,"weeklyHoursMode","INDIVIDUAL")?), "WEEKLY_MODE")?;
        // The E2 model does not score manually assigned leadership responsibilities.
        if let Some(leadership) = person.get("leadership") {
            check(leadership.is_object() && text(leadership, "source")? == "INFERRED",
                "LEADERSHIP_UNSUPPORTED")?;
        }
        for k in ["history","planningHistory","planningFuture","fixedOffDays","preferredOffDays","manualShiftOverrides","manualShiftBaseIds"] {
            check(empty_array(person,k), "PERSON_RESTRICTION_UNSUPPORTED")?;
        }
        check(empty(person,"manualShiftByDate"),"PERSON_RESTRICTION_UNSUPPORTED")?;
        if let Some(slots) = person.get("fixedRestSlots") {
            check(slots.as_array().is_some_and(|a| a.len()==2 && a.iter().all(valid_inactive_slot)), "FIXED_REST_UNSUPPORTED")?;
        }
        let options=array(person,"shiftIds")?;
        check(options.len()==1, "CLOCK_OPTIONS")?;
        let shift=options[0].as_str().ok_or("CLOCK_OPTIONS")?;
        let fixed=optional_text(person,"fixedImportedShiftId","")?;
        check(fixed.is_empty() || fixed==shift, "CLOCK_OPTIONS")?;
        let cap=number(person,"maxConsecutiveSundays")?;
        let rule=optional_text(person,"sundayRestRule","PROTECTIVE")?;
        check((cap==1 || cap==2) && ["PROTECTIVE","UNREVIEWED","CLT_386","COMMERCE"].contains(&rule), "SUNDAY_RULE")?;
        let next=sectors.len();
        let sector=*sectors.entry(text(person,"sector")?.to_string()).or_insert(next);
        let p=Person { id:id.to_string(),sector, role:text(person,"role")?.to_string(),shift:shift.to_string(),
            segments:*clocks.get(shift).ok_or("CLOCK_REFERENCE")?,cap:if rule=="COMMERCE" {cap as usize} else {1} };
        check(by_id.insert(id.to_string(),people.len()).is_none(), "DUPLICATE_PERSON")?;
        people.push(p);
    }
    let saved=records(input,"assignments",&people,&by_id,days)?;
    let explicit=input.get("_initialAssignments").is_some();
    let initial=if explicit { records(input,"_initialAssignments",&people,&by_id,days)? } else {saved.clone()};
    if explicit { check(initial.len()==people.len()*days, "INCOMPLETE_SEED")?; }

    let mut demand_groups=BTreeMap::<(usize,usize,bool),Vec<(i32,i32,i64,Option<String>)>>::new();
    let mut demand_ids = BTreeSet::new();
    for demand in array(input,"demands")? {
        // The real schema requires unique IDs. The minimal Rust test fixture
        // also supplies them; a duplicate must not disappear into a max floor.
        check(demand_ids.insert(identifier(demand, "id")?), "DUPLICATE_DEMAND")?;
        let day=date_index(text(demand,"date")?,days)?;
        let a=number(demand,"start")?;let b=number(demand,"end")?;let minimum=number(demand,"minimum")?;
        check(a>=0 && a<b && b<=1440 && range(minimum,0,250), "DEMAND")?;
        let sector=*sectors.get(text(demand,"sector")?).ok_or("EMPTY_DEMAND_SECTOR")?;
        let role=match demand.get("role") { None=>None,Some(v) if v.is_null()=>None,Some(v)=>Some(v.as_str().ok_or("ROLE")?.to_string()) };
        demand_groups.entry((sector,day,boolean(demand,"estimated",false)?)).or_default().push((a,b,minimum as i64,role));
    }
    let mut facts:Vec<Sector>=(0..sectors.len()).map(|sector|Sector {days,members:people.iter().filter(|p|p.sector==sector).count(),bands:Vec::new()}).collect();
    let mut bands=0usize;
    for ((sector,day,estimated),demands) in demand_groups {
        check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
        let mut edges=BTreeSet::new();
        for (a,b,_,_) in &demands {edges.insert(*a);edges.insert(*b);}
        for person in people.iter().filter(|p|p.sector==sector) {for (a,b) in person.segments {edges.insert(a);edges.insert(b);}}
        let edges:Vec<i32>=edges.into_iter().collect();
        for bounds in edges.windows(2) {
            check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
            let (a,b)=(bounds[0],bounds[1]);
            let mut general=0;
            let mut floors=BTreeMap::<String,i64>::new();
            for (start,end,min,role) in &demands {
                if *start>a || *end<b || *min==0 {continue;}
                match role.as_ref().filter(|s|!s.is_empty()) {None=>general=general.max(*min),Some(role)=>{let n=floors.entry(role.clone()).or_default();*n=(*n).max(*min);}}
            }
            if general==0 && floors.is_empty() {continue;}
            let eligible=people.iter().enumerate().filter(|(_,p)|p.sector==sector && p.segments.iter().any(|(s,e)|*s<=a&&*e>=b))
                .fold(Presence::EMPTY,|m,(i,_)|m|Presence::one(i));
            let minimum=general.max(floors.values().sum());
            let role_floors=floors.into_iter().map(|(role,min)|{
                let mask=people.iter().enumerate().filter(|(_,p)|p.sector==sector&&p.role==role)
                    .fold(Presence::EMPTY,|m,(i,_)|m|Presence::one(i));(mask,min)
            }).collect();
            facts[sector].bands.push(Band{day,minutes:(b-a) as i64,estimated,minimum,eligible,role_floors});
            bands+=1;check(bands<=12000,"BAND_LIMIT")?;
        }
    }
    let facts:Vec<Arc<Sector>>=facts.into_iter().map(Arc::new).collect();
    let catalogue=Arc::new(catalog(days));
    let mut cache=HashMap::<(u32,u32,usize,u32),Arc<[usize]>>::new();
    let mut entities=Vec::with_capacity(people.len());
    let mut cohorts=BTreeMap::new();
    for (i,p) in people.into_iter().enumerate() {
        let(mut lock_work,mut lock_off,mut saved_known,mut saved_work,mut seed_known,mut seed_work)=(0u32,0u32,0u32,0u32,0u32,0u32);
        let mut comparable=(1u32<<(days/7))-1;
        let mut lock_flags=Vec::with_capacity(days);
        for day in 0..days {
            let bit=1u32<<day;
            let old=saved.get(&(i,day));let init=initial.get(&(i,day));
            let locked=old.is_some_and(|r|r.locked==Some(true));
            let saturday=day%7==6;
            if locked {
                comparable&=!(1u32<<(day/7));
                let old=old.unwrap();
                check(!saturday||old.work,"LOCKED_SATURDAY")?;
                check(init.is_none_or(|r|r.work==old.work),"SEED_LOCK_CONFLICT")?;
                if old.work {lock_work|=bit;} else {lock_off|=bit;}
            }
            if saturday {lock_work|=bit;}
            if let Some(row)=old {saved_known|=bit;if row.work {saved_work|=bit;}}
            lock_flags.push(old.and_then(|row|row.locked));
            if locked || saturday {seed_known|=bit;if lock_work&bit!=0{seed_work|=bit;}}
            else if let Some(row)=init {seed_known|=bit;if row.work {seed_work|=bit;}}
        }
        let key=(lock_work,lock_off,p.cap,comparable);
        if !cache.contains_key(&key) {
            let allowed = allowed_indices(&catalogue, days, lock_work, lock_off, p.cap, comparable, deadline)
                .ok_or("MAPPING_TIMEOUT")?;
            cache.insert(key, Arc::from(allowed));
        }
        let allowed=cache[&key].clone();
        check(!allowed.is_empty(),"NO_PERSONAL_PATTERN")?;
        let initial_index=if seed_known==full_mask(days) {catalogue.binary_search(&seed_work).ok().filter(|j|allowed.binary_search(j).is_ok())} else {None};
        let pinned=allowed.len()==1;
        let next=cohorts.len();
        let cohort=*cohorts.entry((p.sector,p.role.clone(),p.segments,p.cap)).or_insert(next);
        entities.push(Employee{id:i,name_id:p.id,shift:p.shift,sector:p.sector,cohort,sunday_cap:p.cap,locked_work:lock_work,locked_off:lock_off,
            saved_known,saved_work,lock_flags,comparable_weeks:comparable,facts:Arc::clone(&facts[p.sector]),
            catalog:Arc::clone(&catalogue),pattern:if pinned {Some(allowed[0])} else {initial_index},allowed,pinned});
    }
    Ok(Plan {employees:entities,score:None})
}
