use serde_json::Value as V;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;
use std::time::Instant;
use crate::domain::{Employee, Plan};
use crate::model::{Band, Sector, Presence, PersonalRules, allowed_indices, bounded_patterns, catalog, full_mask, legal_profile};

type Result<T> = std::result::Result<T, &'static str>;
pub(crate) fn check(ok: bool, code: &'static str) -> Result<()> { if ok { Ok(()) } else { Err(code) } }
pub(crate) fn text<'a>(v: &'a V, k: &str) -> Result<&'a str> { v.get(k).and_then(V::as_str).ok_or("EXPECTED_TEXT") }
pub(crate) fn identifier<'a>(v: &'a V, k: &str) -> Result<&'a str> {
    let value=text(v,k)?;
    check(!value.is_empty() && value.chars().count()<=100,"IDENTIFIER")?;
    Ok(value)
}
pub(crate) fn empty_array(v:&V,k:&str)->bool {
    v.get(k).is_none_or(|x|x.as_array().is_some_and(Vec::is_empty))
}
fn weekday_bit(v:&V)->Result<u8>{
    let n=v.as_i64().filter(|n|(0..=6).contains(n)).ok_or("WEEKDAY")?;
    Ok(1u8<<((n+1)%7))
}
fn weekday_mask(person:&V,key:&str)->Result<u8>{
    let mut mask=0;
    for v in array(person,key)?{
        let bit=weekday_bit(v)?;
        check(mask&bit==0,"DUPLICATE_WEEKDAY")?;
        mask|=bit;
    }
    Ok(mask)
}
pub(crate) fn personal_rules(person:&V,max_run:u8)->Result<(u8,PersonalRules)>{
    let fixed=weekday_mask(person,"fixedOffDays")?;
    let mode=text(person,"offMode")?;
    check(match mode{"VARIABLE"=>fixed==0,"MIXED"=>fixed.count_ones()==1,
        "FIXED"=>fixed.count_ones()==2,_=>false},"FIXED_REST_PROJECTION")?;
    if let Some(slots)=person.get("fixedRestSlots"){
        let slots=slots.as_array().filter(|a|a.len()==2).ok_or("FIXED_REST_SLOTS")?;
        let mut projected=0;
        for slot in slots{
            check(slot.as_object().is_some_and(|o|o.len()==2),"FIXED_REST_SLOT")?;
            let enabled=slot.get("enabled").and_then(V::as_bool).ok_or("FIXED_REST_SLOT")?;
            let value=slot.get("weekday").ok_or("FIXED_REST_SLOT")?;
            let bit=if value.is_null(){0}else{weekday_bit(value)?};
            if enabled{
                check(bit!=0&&projected&bit==0,"FIXED_REST_SLOT")?;
                projected|=bit;
            }
        }
        check(projected==fixed,"FIXED_REST_PROJECTION")?;
    }
    check(fixed&64==0,"FIXED_SATURDAY")?;
    let pattern=text(person,"offPattern")?;
    check(["ANY","CONSECUTIVE","PREFER_CONSECUTIVE"].contains(&pattern),"OFF_PATTERN")?;
    Ok((fixed,PersonalRules{max_run,variable:mode=="VARIABLE",consecutive:pattern=="CONSECUTIVE",
        prefer_consecutive:pattern=="PREFER_CONSECUTIVE",preferred:weekday_mask(person,"preferredOffDays")?}))
}
pub(crate) fn number(v: &V, k: &str) -> Result<i32> {
    v.get(k).and_then(V::as_i64).and_then(|n| i32::try_from(n).ok()).ok_or("EXPECTED_INTEGER")
}
pub(crate) fn boolean(v: &V, k: &str, default: bool) -> Result<bool> {
    match v.get(k) { None => Ok(default), Some(value) => value.as_bool().ok_or("EXPECTED_BOOLEAN") }
}
pub(crate) fn optional_text<'a>(v: &'a V, k: &str, default: &'a str) -> Result<&'a str> {
    if v.get(k).is_none() { Ok(default) } else { text(v, k) }
}
pub(crate) fn array<'a>(v: &'a V, k: &str) -> Result<&'a Vec<V>> {
    let items = v.get(k).and_then(V::as_array).ok_or("EXPECTED_ARRAY")?;
    check(items.len() <= 12000, "ARRAY_LIMIT")?;
    Ok(items)
}
pub(crate) fn empty(v: &V, k: &str) -> bool {
    v.get(k).is_none_or(|x| x.as_array().is_some_and(Vec::is_empty) || x.as_object().is_some_and(|o| o.is_empty()))
}
pub(crate) fn range(v: i32, low: i32, high: i32) -> bool { v >= low && v <= high }

pub(crate) fn civil_date(value: &str) -> bool {
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
    check(civil_date(value) && (value.starts_with("2026-11-")||value.starts_with("2026-12-")), "DATE")?;
    let index = value[8..].parse::<usize>().map_err(|_| "DATE")? - 1
        + if value.starts_with("2026-12-"){30}else{0};
    check(index < days, "DATE")?;
    Ok(index)
}
pub fn date(index: usize) -> String {
    assert!(index<42,"date horizon");
    if index<30{format!("2026-11-{:02}",index+1)}else{format!("2026-12-{:02}",index-29)}
}

#[derive(Clone, Debug)]
struct Person {
    id: String, sector: usize, role: String, shift: String,
    segments: [(i32, i32); 2], cap: usize, fixed:u8, rules:PersonalRules,
}
#[derive(Clone, Copy, Debug)]
struct Row { work: bool, locked: Option<bool> }

fn records(input: &V, field: &str, people: &[Person], by_id: &HashMap<String, usize>, days: usize,
           clocks:&BTreeMap<String,[(i32,i32);2]>,hours_only:bool)
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
        let locked = match row.get("locked") { None => None, Some(v) => Some(v.as_bool().ok_or("LOCK_TYPE")?) };
        check(if work {
            let sid=text(row,"shiftId")?;
            sid==people[person].shift || hours_only&&locked!=Some(true)&&clocks.contains_key(sid)
        } else { row.get("shiftId").is_none() }, "ASSIGNMENT_CLOCK")?;
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
        && matches!(number(input,"defaultWeeklyHours")?,40|42|44)
        && ["DAYS_AND_HOURS","REST_ONLY","HOURS_ONLY"].contains(&optional_text(input,"generationMode","DAYS_AND_HOURS")?), "SYNTHETIC_ONLY")?;
    let mode=optional_text(input,"generationMode","DAYS_AND_HOURS")?;
    let hours_only=mode=="HOURS_ONLY";
    check(text(input,"startDate")? == "2026-11-01" && input.get("visibleMonth").is_none(), "HORIZON")?;
    let days = match text(input,"endDate")? { "2026-11-07" => 7, "2026-11-28" => 28, "2026-12-12" => 42, _ => return Err("HORIZON") };
    for k in input.as_object().unwrap().keys() {
        check(!k.starts_with('_') || k == "_initialAssignments", "PRIVATE_FIELD_UNSUPPORTED")?;
    }
    for k in ["mixed42Sectors","movementPriorities"] { check(empty(input,k), "UNSUPPORTED_INPUT")?; }
    check(input.get("planningCalendarSource").is_none(), "CALENDAR_SOURCE_UNSUPPORTED")?;
    for k in ["calendarProvenance", "collectiveAgreement", "operationalCertificate"] {
        check(policy.get(k).is_none(), "POLICY_METADATA_UNSUPPORTED")?;
    }
    check(text(policy,"calendarMode")? == "MANUAL" && optional_text(policy,"normativeProfile","CUSTOM")? == "CUSTOM"
        && matches!(number(policy,"weeklyLimit")?,40|42|44) && range(number(policy,"dailyLimitMinutes")?,1,600)
        && range(number(policy,"maxConsecutiveWorkDays")?,1,6) && policy.get("mealIntervalAgreement").is_none(), "POLICY")?;
    let max_run=number(policy,"maxConsecutiveWorkDays")?.min(5) as u8;
    let weekly_limit=number(policy,"weeklyLimit")?;
    let daily_limit=number(policy,"dailyLimitMinutes")?;
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
            && matches!(b-a+f-e,480|504|528) && d-c >= meal && d-c <=120 && 1440-(f-a) >= inter
            && 2880-(f-a) >= weekly_rest && (!limit_blocks || (b-a).max(f-e) <= 270), "CLOCK_GEOMETRY")?;
        check(clocks.insert(identifier(clock,"id")?.to_string(),[(a,b),(e,f)]).is_none(), "DUPLICATE_CLOCK")?;
    }
    let employees = array(input,"employees")?;
    check(!employees.is_empty() && employees.len() <= if days==42{250}else{50}, "PEOPLE_LIMIT")?;
    let mut sectors = BTreeMap::<String,usize>::new();
    let mut people = Vec::new();
    let mut by_id = HashMap::new();
    for person in employees {
        let id = identifier(person,"id")?;
        check(id.strip_prefix("person-").is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
            && text(person,"name")?.starts_with("Synthetic person "), "SYNTHETIC_ID")?;
        let active = text(person,"activeFrom")?;
        check(boolean(person,"planningEnabled",true)? && text(person,"scheduleMode")? == "TIMED"
            && matches!(number(person,"weeklyHours")?,40|42|44) && !boolean(person,"historyKnown",false)?
            && person.get("activeUntil").is_none() && person.get("simulationDailyMinutes").is_none()
            && (active.is_empty() || civil_date(active) && active <= "2026-11-01"), "PERSON_PROFILE")?;
        check(["INDIVIDUAL","BRANCH"].contains(&optional_text(person,"weeklyHoursMode","INDIVIDUAL")?), "WEEKLY_MODE")?;
        // The E2 model does not score manually assigned leadership responsibilities.
        if let Some(leadership) = person.get("leadership") {
            check(leadership.is_object() && text(leadership, "source")? == "INFERRED",
                "LEADERSHIP_UNSUPPORTED")?;
        }
        for k in ["history","planningHistory","planningFuture","manualShiftOverrides","manualShiftBaseIds"] {
            check(empty_array(person,k), "PERSON_RESTRICTION_UNSUPPORTED")?;
        }
        check(empty(person,"manualShiftByDate"),"PERSON_RESTRICTION_UNSUPPORTED")?;
        let (fixed_rest,rules)=personal_rules(person,max_run)?;
        let options=array(person,"shiftIds")?;
        let mut unique=BTreeSet::new();
        check(!options.is_empty()&&options.len()<=12&&options.iter().all(|v|
            v.as_str().is_some_and(|id|clocks.contains_key(id)&&unique.insert(id))),"CLOCK_OPTIONS")?;
        let fixed=optional_text(person,"fixedImportedShiftId","")?;
        let shift=if fixed.is_empty(){
            let first=options[0].as_str().unwrap();
            // In REST_ONLY, OR-Tools retains the first clock per duration.
            // Only admit the single-duration case here; different durations
            // require the later temporal-domain model, never silently prune.
            let paid=clocks[first].iter().map(|(a,b)|b-a).sum::<i32>();
            check(options.len()==1 || mode=="REST_ONLY"&&unique.iter().all(|id|
                clocks[*id].iter().map(|(a,b)|b-a).sum::<i32>()==paid),"CLOCK_OPTIONS")?;
            first
        }else{check(unique.contains(fixed),"CLOCK_OPTIONS")?;fixed};
        let segments=*clocks.get(shift).ok_or("CLOCK_REFERENCE")?;
        let hours=number(person,"weeklyHours")?;
        let paid=segments.iter().map(|(a,b)|b-a).sum::<i32>();
        check(hours<=weekly_limit&&paid*5==hours*60&&paid<=daily_limit,"WEEKLY_MINUTES")?;
        let cap=number(person,"maxConsecutiveSundays")?;
        let rule=optional_text(person,"sundayRestRule","PROTECTIVE")?;
        check((cap==1 || cap==2) && ["PROTECTIVE","UNREVIEWED","CLT_386","COMMERCE"].contains(&rule), "SUNDAY_RULE")?;
        let next=sectors.len();
        let sector=*sectors.entry(text(person,"sector")?.to_string()).or_insert(next);
        let p=Person { id:id.to_string(),sector, role:text(person,"role")?.to_string(),shift:shift.to_string(),
            segments,cap:if rule=="COMMERCE" {cap as usize} else {1},fixed:fixed_rest,rules };
        check(by_id.insert(id.to_string(),people.len()).is_none(), "DUPLICATE_PERSON")?;
        people.push(p);
    }
    let saved=records(input,"assignments",&people,&by_id,days,&clocks,hours_only)?;
    let explicit=input.get("_initialAssignments").is_some();
    check(!hours_only||!explicit&&saved.len()==people.len()*days,"HOURS_ONLY_GRID")?;
    let initial=if explicit { records(input,"_initialAssignments",&people,&by_id,days,&clocks,false)? } else {saved.clone()};
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
            facts[sector].bands.push(Band{day,start:a,minutes:(b-a) as i64,estimated,minimum,eligible,role_floors});
            bands+=1;check(bands<=12000,"BAND_LIMIT")?;
        }
    }
    let facts:Vec<Arc<Sector>>=facts.into_iter().map(Arc::new).collect();
    let exact_catalogue=Arc::new(if days==42{Vec::new()}else{catalog(days)});
    type DomainKey=(u64,u64,usize,u32,PersonalRules);
    type BoundedDomain=(usize,Arc<Vec<u64>>,Arc<[usize]>);
    let mut cache=HashMap::<DomainKey,Arc<[usize]>>::new();
    let mut bounded_cache=HashMap::<DomainKey,BoundedDomain>::new();
    let mut entities=Vec::with_capacity(people.len());
    let mut cohorts=BTreeMap::new();
    let mut rest_groups=BTreeMap::new();
    for (i,p) in people.into_iter().enumerate() {
        let(mut lock_work,mut lock_off,mut saved_known,mut saved_work,mut seed_known,mut seed_work)=(0u64,0u64,0u64,0u64,0u64,0u64);
        let mut comparable=if hours_only||p.fixed.count_ones()==2||p.rules.consecutive{0}else{(1u32<<(days/7))-1};
        let mut lock_flags=Vec::with_capacity(days);
        for day in 0..days {
            let bit=1u64<<day;
            let old=saved.get(&(i,day));let init=initial.get(&(i,day));
            let locked=old.is_some_and(|r|r.locked==Some(true));
            let saturday=day%7==6;
            let fixed_rest=p.fixed&(1<<(day%7))!=0;
            if fixed_rest {lock_off|=bit;}
            if locked {
                comparable&=!(1u32<<(day/7));
                let old=old.unwrap();
                check(!saturday||old.work,"LOCKED_SATURDAY")?;
                check(!fixed_rest||!old.work,"LOCKED_FIXED_REST")?;
                check(init.is_none_or(|r|r.work==old.work),"SEED_LOCK_CONFLICT")?;
                if old.work {lock_work|=bit;} else {lock_off|=bit;}
            }
            if saturday {lock_work|=bit;}
            if let Some(row)=old {saved_known|=bit;if row.work {saved_work|=bit;}}
            lock_flags.push(old.and_then(|row|row.locked));
            if locked || saturday || fixed_rest {seed_known|=bit;if lock_work&bit!=0{seed_work|=bit;}}
            else if let Some(row)=init {seed_known|=bit;if row.work {seed_work|=bit;}}
        }
        let key=(lock_work,lock_off,p.cap,comparable,p.rules);
        let (catalogue,allowed,full_domain_count):(Arc<Vec<u64>>,Arc<[usize]>,usize)=if hours_only {
            check(saved_known==full_mask(days)&&legal_profile(saved_work,days,lock_work,lock_off,p.cap,comparable,p.rules),
                "HOURS_ONLY_GRID_CONFLICT")?;
            if days==42{(Arc::new(vec![saved_work]),Arc::from(vec![0]),1)}
            else{(Arc::clone(&exact_catalogue),Arc::from(vec![exact_catalogue.binary_search(&saved_work).map_err(|_|"HOURS_ONLY_GRID_CONFLICT")?]),1)}
        }else if days==42{
            let (count,shared,indices)=match bounded_cache.entry(key){
                std::collections::hash_map::Entry::Occupied(entry)=>entry.get().clone(),
                std::collections::hash_map::Entry::Vacant(entry)=>{
                    let (count,patterns)=bounded_patterns((lock_work,lock_off),p.cap,comparable,p.rules,deadline)
                        .ok_or("MAPPING_TIMEOUT")?;
                    let indices:Arc<[usize]>=Arc::from((0..patterns.len()).collect::<Vec<_>>());
                    entry.insert((count,Arc::new(patterns),indices)).clone()
                }
            };
            // Preserve an admissible supplied seed between sampled ranks.
            if seed_known==full_mask(days)&&legal_profile(seed_work,days,lock_work,lock_off,p.cap,comparable,p.rules)
                &&shared.binary_search(&seed_work).is_err(){
                let mut own=shared.as_ref().clone();own.push(seed_work);own.sort_unstable();
                let indices=Arc::from((0..own.len()).collect::<Vec<_>>());
                (Arc::new(own),indices,count)
            }else{(shared,indices,count)}
        }else{
            let allowed=match cache.entry(key){
                std::collections::hash_map::Entry::Occupied(entry)=>Arc::clone(entry.get()),
                std::collections::hash_map::Entry::Vacant(entry)=>{
                    let indices=allowed_indices(&exact_catalogue,days,(lock_work,lock_off),p.cap,comparable,p.rules,deadline)
                        .ok_or("MAPPING_TIMEOUT")?;
                    Arc::clone(entry.insert(Arc::from(indices)))
                }
            };
            let count=allowed.len();(Arc::clone(&exact_catalogue),allowed,count)
        };
        check(!allowed.is_empty(),"NO_PERSONAL_PATTERN")?;
        let initial_index=if seed_known==full_mask(days) {catalogue.binary_search(&seed_work).ok().filter(|j|allowed.binary_search(j).is_ok())} else {None};
        let pinned=full_domain_count==1;
        let next=cohorts.len();
        let cohort=*cohorts.entry((p.sector,p.role.clone(),p.segments,p.cap)).or_insert(next);
        let next_group=rest_groups.len();
        let weekly_minutes=p.segments.iter().map(|(a,b)|5*(b-a)).sum::<i32>();
        let rest_group=*rest_groups.entry((p.sector,p.cap,weekly_minutes)).or_insert(next_group);
        entities.push(Employee{id:i,name_id:p.id,shift:p.shift,sector:p.sector,cohort,rest_group,sunday_cap:p.cap,rules:p.rules,locked_work:lock_work,locked_off:lock_off,
            saved_known,saved_work,lock_flags,comparable_weeks:comparable,facts:Arc::clone(&facts[p.sector]),
            catalog:catalogue,full_domain_count,pattern:if pinned {Some(allowed[0])} else {initial_index},allowed,pinned});
    }
    Ok(Plan {employees:entities,score:None})
}
