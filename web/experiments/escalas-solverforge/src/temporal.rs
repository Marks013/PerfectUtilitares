//! SF54d/e: bounded temporal horizon, synthetic-only, not a production adapter.
//! OFF, ABSENCE and HOLIDAY are separate states; work is a concrete clock.
//! Only admitted, synthetic, same-civil-day shifts before the transition date.
use std::collections::{BTreeMap,BTreeSet};
use std::sync::Arc;
use std::time::{Duration,Instant};
use serde_json::{json,Value as V};
use solverforge::{MoveThreadCount,SolverConfig};
use solverforge::stream::collector::Accumulator;
mod rules;
mod tie_rank;
mod seed;
use rules::{Rules,enumerate,PATH_LIMIT};
use crate::model::Presence;
use crate::temporal_domain::{TemporalEmployee,TemporalPlan};
use crate::temporal_score::TemporalScore;
use crate::wire::{array,boolean,check,civil_date,empty,empty_array,identifier,number,optional_text,personal_rules,range,text};

type Result<T>=std::result::Result<T,&'static str>;
pub type Cost=[i64;17];
pub(crate) const OFF:u8=0;
const ABS:u8=1;
const HOL:u8=2;
pub const MAX_DAYS:usize=42;
const DUTY:u8=15;
const OBJECTIVES:[(&str,&str);16]=[
    ("COVERAGE","SCOPED"),("SUNDAY_COVERAGE","SCOPED"),("SUNDAY_PEAK","PARTIAL_GLOBAL_BOUND"),
    ("MOVEMENT_COVERAGE","SCOPED"),("CLOSING_COVERAGE","SCOPED"),
    ("UNTIMED_ROTATION","SCOPED_WEEKDAY_AND_SUNDAY"),("SUNDAY_BALANCE","SCOPED_COHORT_AND_DATES"),
    ("REST_SPACING","PARTIAL_PAIR_SCORE"),("LEADERSHIP","PARTIAL_LOCAL_RESPONSIBILITY"),
    ("SATURDAY_BALANCE","PARTIAL_COHORT"),("REST_DISTRIBUTION","PARTIAL_SECTOR_ROLE"),
    ("REST_ROTATION","SCOPED"),("PEOPLE_CHANGED","SCOPED"),("STABILITY","SCOPED"),
    ("PREFERENCES","SCOPED"),("TIE_BREAK","SCOPED_ORIGINAL_SHA256"),
];
#[derive(Clone,Debug,PartialEq,Eq,Hash)]
struct Clock {id:String,segments:[(i32,i32);2],paid:i32}
impl Clock {
    fn start(&self)->i32{self.segments[0].0}
    fn end(&self)->i32{self.segments[1].1}
    fn covers(&self,a:i32,b:i32)->bool{self.segments.iter().any(|&(s,e)|s<=a&&b<=e)}
}
fn clock(clocks:&[Clock],state:u8)->Option<&Clock>{state.checked_sub(3).and_then(|i|clocks.get(i as usize))}
fn work(state:u8)->bool{state>=3}
#[derive(Clone,Copy,Debug,PartialEq,Eq,Hash)]
pub struct Pattern{pub(crate) states:[u8;MAX_DAYS],pub(crate) personal:Cost,rates:[Option<i64>;2],sunday_opportunities:u64}
#[derive(Clone,Copy,Debug,PartialEq,Eq,PartialOrd,Ord)]
struct Record{state:u8,locked:Option<bool>,manual_absence:bool}
#[derive(Clone,Debug,PartialEq,Eq,Hash)]
struct Band{day:usize,start:i32,end:i32,estimated:bool,general:i64,roles:Vec<(usize,i64)>,clock_mask:u16}
#[derive(Debug,PartialEq,Eq,Hash)]
pub struct TemporalFacts{pub(crate) days:usize,clocks:Arc<Vec<Clock>>,bands:Vec<Band>,closed:[bool;MAX_DAYS],closing:i32,
    priority:[Option<i64>;MAX_DAYS],movement_enabled:bool,peak_weight:i64,peak_quantum:i64}
#[derive(Clone)]
pub struct Member{
    pub id:usize,pub role:usize,pub cohort:usize,pub leader:bool,pub untimed:bool,pub facts:Arc<TemporalFacts>,pub pattern:Option<Pattern>,
}
#[derive(Default)]
pub struct TemporalAccumulator{members:BTreeMap<usize,Member>}
impl Accumulator<Member,Cost> for TemporalAccumulator{
    type Retraction=usize;
    fn accumulate(&mut self,value:Member)->usize{
        let id=value.id;assert!(self.members.insert(id,value).is_none());id
    }
    fn retract(&mut self,id:usize){assert!(self.members.remove(&id).is_some());}
    fn with_result<T>(&self,f:impl FnOnce(&Cost)->T)->T{f(&sector_cost(self.members.values()))}
    fn reset(&mut self){self.members.clear();}
}
fn add(a:&mut Cost,b:Cost){for (x,y) in a.iter_mut().zip(b){*x+=y;}}
fn sector_cost<'a>(members:impl Iterator<Item=&'a Member>)->Cost{
    let rows:Vec<_>=members.collect();
    let mut result=[0;17];
    let Some(first)=rows.first() else{return result;};
    let facts=&first.facts;
    let mut sunday=[0i64;6];let mut sunday_ref=[false;6];
    let mut attendance=[[Presence::EMPTY;16];MAX_DAYS];
    let mut role_members=BTreeMap::<usize,Presence>::new();
    for row in &rows{
        if let Some(p)=row.pattern{
            add(&mut result,p.personal);
            let bit=Presence::one(row.id);
            *role_members.entry(row.role).or_default()|=bit;
            for (d,&state) in p.states.iter().enumerate().take(facts.days){
                if work(state){attendance[d][usize::from(state)]|=bit;}
            }
        }
    }
    for band in &facts.bands{
        let present=attendance[band.day].iter().enumerate().filter(|(state,_)|band.clock_mask&(1u16<<state)!=0)
            .fold(Presence::EMPTY,|mask,(_,p)|mask|*p);
        let role_gap:i64=band.roles.iter().map(|(r,n)|{
            let members=role_members.get(r).copied().unwrap_or_default();
            (*n-i64::from((present&members).count_ones())).max(0)
        }).sum();
        let gap=(band.general-i64::from(present.count_ones())).max(0).max(role_gap);
        if band.estimated{
            let cost=gap*i64::from(band.end-band.start);
            result[1]+=cost;
            if band.day.is_multiple_of(7){result[2]+=cost;sunday[band.day/7]+=cost/facts.peak_quantum;sunday_ref[band.day/7]=true;}
            if facts.movement_enabled{result[4]+=cost*facts.priority[band.day].unwrap_or(2);}
            let close=(band.end.min(facts.closing)-band.start.max(facts.closing-60)).max(0);
            result[5]+=gap*i64::from(close);
        }else{result[0]+=gap*i64::from(band.end-band.start);}
    }
    if sunday_ref.iter().filter(|&&r|r).count()>=2{
        result[3]=sunday.iter().max().copied().unwrap_or(0)*facts.peak_weight+sunday.iter().map(|x|x*x).sum::<i64>();
    }
    for (day,weight) in facts.priority.iter().enumerate().take(facts.days){
        if !facts.closed[day]&&weight.is_some()&&!rows.iter().any(|r|r.leader&&r.pattern.is_some_and(|p|work(p.states[day]))){
            result[9]+=weight.unwrap_or(0);
        }
    }
    let mut cohorts=BTreeMap::<(usize,usize),(i64,i64)>::new();
    let mut sunday_cohorts=BTreeMap::<usize,Vec<&Member>>::new();
    for row in &rows{sunday_cohorts.entry(row.cohort).or_default().push(row);}
    for row in &rows{
        if let Some(p)=row.pattern{
            for (i,value) in p.rates.iter().enumerate(){
                if let Some(rate)=value{
                    let entry=cohorts.entry((row.cohort,i)).or_insert((*rate,*rate));
                    entry.0=entry.0.min(*rate);entry.1=entry.1.max(*rate);
                }
            }
        }
    }
    for ((_,i),(lo,hi)) in cohorts{result[if i==0{7}else{10}]+=hi-lo;}
    // Spread across dates uses actual eligible people, not all headcount.
    for cohort in sunday_cohorts.values(){
        if cohort.len()<2{continue;}
        let mut rates=Vec::new();
        for day in (0..facts.days).step_by(7){
            let eligible:Vec<_>=cohort.iter().filter_map(|r|r.pattern).filter(|p|p.sunday_opportunities&(1u64<<day)!=0).collect();
            if !eligible.is_empty(){rates.push(eligible.iter().filter(|p|work(p.states[day])).count() as i64*10_000/eligible.len() as i64);}
        }
        if let (Some(lo),Some(hi))=(rates.iter().min(),rates.iter().max()){
            result[7]+=hi-lo;
            if cohort.iter().all(|r|r.untimed){result[6]+=hi-lo;}
        }
    }
    // Unique sector + role groups; don't double-count a sector with one role.
    let mut groups=BTreeMap::<usize,Vec<&Member>>::new();
    for row in &rows{groups.entry(row.role).or_default().push(row);}
    let mut all_groups=vec![rows.clone()];
    if groups.len()>1{all_groups.extend(groups.into_values());}
    for group in all_groups{
        for day in 0..facts.days{
            if facts.closed[day]{continue;}
            let states:Vec<_>=group.iter().filter_map(|r|r.pattern.map(|p|p.states[day])).filter(|&s|s!=ABS).collect();
            if states.len()>=2{
                result[11]+=(7*states.iter().filter(|&&s|s==OFF).count() as i64-2*states.len() as i64).abs();
            }
        }
    }
    result
}
fn evaluate(plan:&TemporalPlan)->Cost{
    let mut groups=BTreeMap::<usize,Vec<Member>>::new();let mut total=[0;17];
    for person in &plan.employees{
        if person.pattern.is_none(){total[0]+=1;}
        groups.entry(person.sector).or_default().push(person.member());
    }
    for rows in groups.values(){add(&mut total,sector_cost(rows.iter()));}
    total
}
fn sector_prefix(plan:&TemporalPlan)->BTreeMap<usize,[i64;5]>{
    let mut sectors=BTreeMap::<usize,Vec<Member>>::new();
    for p in &plan.employees{sectors.entry(p.sector).or_default().push(p.member());}
    sectors.into_iter().map(|(id,rows)|{
        let c=sector_cost(rows.iter());(id,[c[1],c[2],c[3],c[4],c[5]])
    }).collect()
}
fn prefix_preserved(before:&BTreeMap<usize,[i64;5]>,after:&BTreeMap<usize,[i64;5]>)->bool{
    before.iter().all(|(s,c)|after.get(s).is_some_and(|next|next.iter().zip(c).all(|(a,b)|a<=b)))
}
fn expected(cost:Cost)->TemporalScore{TemporalScore::of([-cost[0]],std::array::from_fn(|i|-cost[i+1]))}
fn relative(date:&str)->Result<i32>{
    check(civil_date(date),"DATE")?;
    let n=date[8..].parse::<i32>().map_err(|_|"DATE")?;
    match &date[..7]{"2026-09"=>Ok(n-62),"2026-10"=>Ok(n-32),"2026-11"=>Ok(n-1),"2026-12"=>Ok(n+29),"2027-01"=>Ok(n+60),_=>Err("TEMPORAL_DATE")}
}
fn dates(policy:&V,key:&str)->Result<BTreeSet<i32>>{
    let mut out=BTreeSet::new();
    if policy.get(key).is_none(){return Ok(out);}
    for item in array(policy,key)?{
        let d=relative(item.as_str().ok_or("DATE")?)?;
        check(out.insert(d),"DUPLICATE_DATE")?;
    }
    Ok(out)
}
fn code(row:&V,ids:&BTreeMap<String,u8>,pid:&str)->Result<Record>{
    check(text(row,"employeeId")?==pid,"ASSIGNMENT_REFERENCE")?;
    // Metadata that cannot be round-tripped remains a hard admission barrier.
    for k in ["monthlyCarry","carriedHolidayRest"]{
        check(row.get(k).is_none(),"ASSIGNMENT_METADATA_UNSUPPORTED")?;
    }
    let kind=text(row,"kind")?;
    let state=match kind{"OFF"=>OFF,"ABSENCE"=>ABS,"HOLIDAY"=>HOL,"DUTY"=>DUTY,
        "WORK"=>*ids.get(text(row,"shiftId")?).ok_or("CLOCK_REFERENCE")?,_=>return Err("ASSIGNMENT_KIND")};
    check((work(state)&&state!=DUTY)||row.get("shiftId").is_none(),"ASSIGNMENT_CLOCK")?;
    let locked=row.get("locked").map(|v|v.as_bool().ok_or("LOCK_TYPE")).transpose()?;
    let manual_absence=match row.get("absenceSource"){None=>false,Some(v)=>{
        check(state==ABS&&v.as_str()==Some("MANUAL"),"ABSENCE_SOURCE")?;true
    }};
    Ok(Record{state,locked,manual_absence})
}
// The global peak weight dominates every possible secondary squared deficit.
// Use checked wide arithmetic and reject exceptional envelopes rather than
// overflowing the safe-integer telemetry or silently changing precedence.
fn configure_peak(facts:&mut [TemporalFacts])->Result<()>{
    let mut quantum=0i64;
    for sector in facts.iter(){
        for band in sector.bands.iter().filter(|b|b.estimated&&b.day.is_multiple_of(7)){
            let mut n=i64::from(band.end-band.start);
            while n!=0{let rem=quantum%n;quantum=n;n=rem;}
        }
    }
    quantum=quantum.max(1);
    let mut peak=0i128;let mut secondary=0i128;
    for sector in facts.iter(){
        let mut days=[0i128;6];let mut referenced=[false;6];
        for band in sector.bands.iter().filter(|b|b.estimated&&b.day.is_multiple_of(7)){
            days[band.day/7]+=i128::from(band.general)*i128::from(band.end-band.start)/i128::from(quantum);
            referenced[band.day/7]=true;
        }
        if referenced.iter().filter(|&&x|x).count()>=2{
            peak+=days.iter().max().copied().unwrap_or(0);
            secondary+=days.iter().map(|x|x*x).sum::<i128>();
        }
    }
    let weight=secondary+1;
    check(peak*weight+secondary<=9_007_199_254_740_991,"TEMPORAL_PEAK_BOUND")?;
    for sector in facts{sector.peak_weight=weight as i64;sector.peak_quantum=quantum;}
    Ok(())
}
fn read(root:&V,deadline:Instant)->Result<TemporalPlan>{
    check(root.as_object().is_some_and(|o|o.len()==1)&&root["input"].is_object(),"ENVELOPE")?;
    let input=&root["input"];let policy=&input["policy"];
    check(number(input,"schemaVersion")?==1&&text(input,"branchCode")?=="SYNTH"&&boolean(input,"simulation",false)?
        &&text(input,"timeZone")?=="America/Sao_Paulo"&&text(input,"planningWeekStartsOn")?=="SUNDAY"
        &&number(input,"restRulesVersion")?==3&&text(input,"startDate")?=="2026-11-01"
        &&input.get("visibleMonth").is_none(),"TEMPORAL_HORIZON")?;
    let days=match text(input,"endDate")?{"2026-11-07"=>7,"2026-11-28"=>28,"2026-12-12"=>42,_=>return Err("TEMPORAL_HORIZON")};
    for k in input.as_object().unwrap().keys(){check(!k.starts_with('_'),"PRIVATE_FIELD_UNSUPPORTED")?;}
    check(input.get("planningCalendarSource").is_none(),"TEMPORAL_METADATA")?;
    for k in ["calendarProvenance","collectiveAgreement","operationalCertificate","mealIntervalAgreement"]{
        check(policy.get(k).is_none(),"POLICY_METADATA_UNSUPPORTED")?;
    }
    let mode=optional_text(input,"generationMode","DAYS_AND_HOURS")?;
    check(["DAYS_AND_HOURS","REST_ONLY","HOURS_ONLY"].contains(&mode),"MODE")?;
    check(text(policy,"calendarMode")?=="MANUAL"&&optional_text(policy,"normativeProfile","CUSTOM")?=="CUSTOM","POLICY")?;
    let default_hours=number(input,"defaultWeeklyHours")?;
    let weekly=number(policy,"weeklyLimit")?;let daily=number(policy,"dailyLimitMinutes")?;
    let meal=number(policy,"minMealMinutes")?;let inter=number(policy,"minInterShiftMinutes")?;
    let weekly_rest=number(policy,"minWeeklyRestMinutes")?;let max_run=number(policy,"maxConsecutiveWorkDays")?;
    let closing=number(input,"storeClosingMinutes")?;
    check(matches!(default_hours,40|42|44)&&matches!(weekly,40|42|44)&&range(daily,1,600)
        &&range(meal,30,180)&&range(inter,660,1440)&&range(weekly_rest,2100,4320)&&range(max_run,1,6)
        &&range(closing,300,1440),"POLICY_LIMIT")?;
    let limit_blocks=boolean(policy,"limitContinuousWorkBlocks",false)?;
    let closed=dates(policy,"closedDates")?;let holidays=dates(policy,"holidayDates")?;
    let paid=dates(policy,"paidHolidayDates")?;let authorized=dates(policy,"authorizedHolidayDates")?;
    check(paid.is_subset(&closed)&&paid.is_subset(&holidays)&&authorized.is_subset(&holidays),"HOLIDAY_POLICY")?;
    let closed_days:[bool;MAX_DAYS]=std::array::from_fn(|d|d<days&&closed.contains(&(d as i32)));
    let holiday_days:[bool;MAX_DAYS]=std::array::from_fn(|d|d<days&&holidays.contains(&(d as i32)));
    let mut mixed_sectors=BTreeSet::new();
    if input.get("mixed42Sectors").is_some(){
        for s in array(input,"mixed42Sectors")?{check(default_hours==42&&mixed_sectors.insert(s.as_str().ok_or("MIXED_SECTOR")?),"MIXED_SECTOR")?;}
    }
    let clock_rows=array(input,"shifts")?;
    check(clock_rows.len()<=12,"CLOCK_LIMIT")?;
    let mut clocks=Vec::new();let mut ids=BTreeMap::new();
    for row in clock_rows{
        let seg=array(row,"segments")?;
        check(seg.len()==3&&text(&seg[0],"kind")?=="WORK"&&text(&seg[1],"kind")?=="BREAK"&&text(&seg[2],"kind")?=="WORK","CLOCK_KIND")?;
        let a=number(&seg[0],"start")?;let b=number(&seg[0],"end")?;
        let c=number(&seg[1],"start")?;let d=number(&seg[1],"end")?;
        let e=number(&seg[2],"start")?;let f=number(&seg[2],"end")?;
        check([a,b,c,d,e,f].iter().all(|&v|range(v,0,1440))&&a>=300&&a<b&&b==c&&c<d&&d==e&&e<f&&f<=closing.min(1200),"CLOCK_GEOMETRY")?;
        let minutes=b-a+f-e;let long=b-a==270&&d-c==180&&f-e==270;
        check((long||matches!(minutes,480|504|528)&&minutes<=daily&&d-c<=120)&&d-c>=meal
            &&(!limit_blocks||(b-a).max(f-e)<=270),"CLOCK_GEOMETRY")?;
        let id=identifier(row,"id")?.to_string();check(ids.insert(id.clone(),(clocks.len()+3) as u8).is_none(),"DUPLICATE_CLOCK")?;
        clocks.push(Clock{id,segments:[(a,b),(e,f)],paid:minutes});
    }
    let clocks=Arc::new(clocks);
    let people=array(input,"employees")?;
    check(!people.is_empty()&&people.len()<=if days==7{12}else{250},"TEMPORAL_PEOPLE_LIMIT")?;
    let mut sectors=BTreeMap::<String,usize>::new();let mut roles=BTreeMap::<String,usize>::new();
    for row in people{
        let n=sectors.len();sectors.entry(text(row,"sector")?.to_string()).or_insert(n);
        let n=roles.len();roles.entry(text(row,"role")?.to_string()).or_insert(n);
    }
    check(mixed_sectors.iter().all(|s|sectors.contains_key(*s)),"MIXED_SECTOR")?;
    type DemandGroups=BTreeMap<(usize,usize,bool),Vec<(i32,i32,i64,Option<usize>)>>;
    let mut demand_groups=DemandGroups::new();let mut demand_ids=BTreeSet::new();
    for d in array(input,"demands")?{
        check(demand_ids.insert(identifier(d,"id")?),"DUPLICATE_DEMAND")?;
        let day=relative(text(d,"date")?)?;let a=number(d,"start")?;let b=number(d,"end")?;let n=number(d,"minimum")?;
        check((0..days as i32).contains(&day)&&a>=0&&a<b&&b<=1440&&range(n,0,250),"DEMAND")?;
        let sector=*sectors.get(text(d,"sector")?).ok_or("DEMAND_SECTOR")?;
        let role=match d.get("role"){None=>None,Some(v) if v.is_null()=>None,Some(v)=>{
            let r=v.as_str().ok_or("ROLE")?;
            let next=roles.len();Some(*roles.entry(r.to_string()).or_insert(next))
        }};
        let estimated=boolean(d,"estimated",false)?;
        if estimated&&paid.contains(&day){continue;}
        demand_groups.entry((sector,day as usize,estimated)).or_default().push((a,b,i64::from(n),role));
    }
    let mut priorities=Vec::new();
    if input.get("movementPriorities").is_some(){
        for entry in array(input,"movementPriorities")?{
            let a=relative(text(entry,"startDate")?)?;let b=relative(text(entry,"endDate")?)?;
            check((0..days as i32).contains(&a)&&(a..days as i32).contains(&b),"MOVEMENT_DATES")?;
            let weight=match text(entry,"level")?{"LOW"=>1,"NORMAL"=>2,"HIGH"=>3,_=>return Err("MOVEMENT_LEVEL")};
            let name=optional_text(entry,"sector","")?;
            let sector=if name.is_empty(){None}else{Some(*sectors.get(name).ok_or("MOVEMENT_SECTOR")?)};
            priorities.push((a,b,weight,sector));
        }
    }
    let mut facts:Vec<_>=(0..sectors.len()).map(|sector|TemporalFacts{
        days,clocks:Arc::clone(&clocks),bands:Vec::new(),closed:closed_days,closing,movement_enabled:!priorities.is_empty(),peak_weight:1,peak_quantum:1,
        priority:std::array::from_fn(|d|{
            let matches=|p:&&(i32,i32,i64,Option<usize>)|p.0<=d as i32&&p.1>=d as i32;
            priorities.iter().filter(matches).filter(|p|p.3==Some(sector)).map(|p|p.2).max()
                .or_else(||priorities.iter().filter(matches).filter(|p|p.3.is_none()).map(|p|p.2).max())
        })
    }).collect();
    for ((sector,day,estimated),demands) in demand_groups{
        check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
        let mut edges=BTreeSet::new();
        for &(a,b,_,_) in &demands{edges.insert(a);edges.insert(b);}
        for clock in clocks.iter(){for (a,b) in clock.segments{edges.insert(a);edges.insert(b);}}
        let edges:Vec<_>=edges.into_iter().collect();
        for pair in edges.windows(2){
            let a=pair[0];let b=pair[1];let mut general=0;let mut floors=BTreeMap::<usize,i64>::new();
            for &(s,e,n,r) in &demands{
                if s>a||e<b||n==0{continue;}
                if let Some(r)=r{let v=floors.entry(r).or_default();*v=(*v).max(n);}else{general=general.max(n);}
            }
            general=general.max(floors.values().sum());
            if general>0{
                check(facts[sector].bands.len()<12000,"BAND_LIMIT")?;
                let clock_mask=clocks.iter().enumerate().filter(|(_,c)|c.covers(a,b)).fold(0u16,|mask,(i,_)|mask|1u16<<(i+3));
                facts[sector].bands.push(Band{day,start:a,end:b,estimated,general,roles:floors.into_iter().collect(),clock_mask});
            }
        }
    }
    configure_peak(&mut facts)?;
    let facts:Vec<_>=facts.into_iter().map(Arc::new).collect();
    let mut employees=Vec::new();let mut seen=BTreeSet::new();
    type CohortKey=(usize,usize,bool,Vec<[(i32,i32);2]>,i32,i32);
    let mut cohorts=BTreeMap::<CohortKey,usize>::new();
    let assignment_rows=array(input,"assignments")?;
    type CachedDomain=(Arc<Vec<Pattern>>,Arc<[usize]>);
    let mut domains=BTreeMap::<(Rules,Vec<Vec<u8>>),CachedDomain>::new();
    let rest_weight=1+(people.len()*days) as i64;
    for p in people{
        check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
        let pid=identifier(p,"id")?;
        check(pid.strip_prefix("person-").is_some_and(|s|!s.is_empty()&&s.bytes().all(|b|b.is_ascii_digit()))
            &&text(p,"name")?.starts_with("Synthetic person ")&&seen.insert(pid),"SYNTHETIC_ID")?;
        let active=text(p,"activeFrom")?;
        let schedule=text(p,"scheduleMode")?;
        let untimed=matches!(schedule,"UNTIMED"|"MISSING");
        check((active.is_empty()||civil_date(active)&&active<="2026-11-01")&&p.get("activeUntil").is_none()
            &&boolean(p,"planningEnabled",true)?&&(untimed||schedule=="TIMED")&&p.get("simulationDailyMinutes").is_none(),"PERSON_PROFILE")?;
        for k in ["manualShiftOverrides","manualShiftBaseIds"]{check(empty_array(p,k),"MANUAL_PROVENANCE_UNSUPPORTED")?;}
        let mut manual=BTreeMap::new();
        if !empty(p,"manualShiftByDate"){
            check(!untimed,"DATED_OVERRIDE_UNTIMED")?;
            let entries=p["manualShiftByDate"].as_object().ok_or("DATED_OVERRIDE")?;
            for (date,sid) in entries{
                let day=relative(date)?;check((0..days as i32).contains(&day),"DATED_OVERRIDE_DATE")?;
                manual.insert(day,*ids.get(sid.as_str().ok_or("DATED_OVERRIDE")?).ok_or("CLOCK_REFERENCE")?);
            }
        }
        let sector_name=text(p,"sector")?;let sector=sectors[sector_name];let role_name=text(p,"role")?;let role=roles[role_name];
        let leader=if let Some(l)=p.get("leadership"){
            check(["MANUAL","INFERRED"].contains(&text(l,"source")?),"LEADERSHIP_UNSUPPORTED")?;
            let responsibility=text(l,"role")?;let scope=array(l,"sectors")?;
            check(["NONE","SECTOR","BRANCH"].contains(&responsibility)&&scope.len()<=1
                &&scope.iter().all(|s|s.as_str()==Some(sector_name))
                &&(responsibility!="NONE"||scope.is_empty()),"CROSS_SECTOR_LEADERSHIP_PENDING")?;
            responsibility!="NONE"&&!scope.is_empty()
        }else{
            // Admit only the unambiguous ASCII local-role inference. Other
            // spellings must supply the prepared explicit responsibility.
            let upper=role_name.to_uppercase();
            upper.starts_with("ENCARREGAD")||upper.starts_with("ENC.")||upper.starts_with("ENC ")
        };
        let hours=number(p,"weeklyHours")?;check(matches!(hours,40|42|44)&&hours<=weekly,"WEEKLY_MINUTES")?;
        check(["INDIVIDUAL","BRANCH"].contains(&optional_text(p,"weeklyHoursMode","INDIVIDUAL")?),"WEEKLY_MODE")?;
        let mixed=!untimed&&mixed_sectors.contains(sector_name)&&hours==42;
        let (fixed,personal)=personal_rules(p,max_run.min(5) as u8)?;
        let cap=number(p,"maxConsecutiveSundays")?;let rule=optional_text(p,"sundayRestRule","PROTECTIVE")?;
        check(matches!(cap,1|2)&&["PROTECTIVE","UNREVIEWED","CLT_386","COMMERCE"].contains(&rule),"SUNDAY_RULE")?;
        let cap=if rule=="COMMERCE"{cap}else{1};
        let mut options=Vec::new();let mut unique=BTreeSet::new();
        for v in array(p,"shiftIds")?{
            let id=v.as_str().ok_or("CLOCK_REFERENCE")?;let s=*ids.get(id).ok_or("CLOCK_REFERENCE")?;
            check(unique.insert(s),"DUPLICATE_CLOCK")?;options.push(s);
        }
        check(if untimed{options.is_empty()}else{!options.is_empty()&&options.len()<=4},"TEMPORAL_CLOCK_OPTIONS")?;
        let imported=optional_text(p,"fixedImportedShiftId","")?;
        if !imported.is_empty(){
            check(!untimed,"CLOCK_REFERENCE")?;
            let s=*ids.get(imported).ok_or("CLOCK_REFERENCE")?;check(unique.contains(&s),"CLOCK_REFERENCE")?;options=vec![s];
        }else if mode=="REST_ONLY"{
            let mut durations=BTreeSet::new();options.retain(|&s|durations.insert(clock(&clocks,s).unwrap().paid));
        }
        let allowed_clock=|s:u8|!untimed&&clock(&clocks,s).is_some_and(|c|if mixed{c.paid==540||c.paid==480&&c.paid<=daily}else{c.paid!=540&&c.paid<=daily});
        let mut old=[None;MAX_DAYS];
        for row in assignment_rows{
            if text(row,"employeeId")?!=pid{continue;}
            let d=relative(text(row,"date")?)?;check((0..days as i32).contains(&d),"DATE")?;
            check(old[d as usize].replace(code(row,&ids,pid)?).is_none(),"DUPLICATE_ASSIGNMENT")?;
        }
        if mode=="HOURS_ONLY"{check(old[..days].iter().all(Option::is_some),"HOURS_ONLY_GRID")?;}
        let mut context=BTreeMap::new();
        for key in ["planningHistory","history","planningFuture"]{
            if p.get(key).is_none(){continue;}
            let mut local=BTreeSet::new();
            for row in array(p,key)?{
                let d=relative(text(row,"date")?)?;
                check(if key=="planningFuture"{(days as i32..days as i32+21).contains(&d)}else{(-56..0).contains(&d)},"CONTEXT_DATE")?;
                check(local.insert(d),"DUPLICATE_CONTEXT")?;
                context.insert(d,code(row,&ids,pid)?.state);
            }
        }
        let mut daily_options=vec![Vec::<u8>::new();days];
        for (day,out) in daily_options.iter_mut().enumerate(){
            let saved=old[day];let date=day as i32;let absence=saved.is_some_and(|r|r.state==ABS);
            let holiday=mode!="HOURS_ONLY"&&paid.contains(&date)||saved.is_some_and(|r|r.state==HOL);
            if absence{out.push(ABS);}else if holiday{
                check(paid.contains(&date),"HOLIDAY_POLICY")?;
                check(saved.is_none_or(|r|r.locked!=Some(true)||r.state==HOL),"LOCKED_HOLIDAY")?;
                out.push(HOL);
            }else{
                let force_off=fixed&(1<<(day%7))!=0;
                let off_allowed=day%7!=6&&(!holidays.contains(&date)||day.is_multiple_of(7)||boolean(policy,"holidayRestAllowed",false)?);
                if off_allowed{out.push(OFF);}
                if !force_off&&!closed.contains(&date){
                    if untimed{out.push(DUTY);}
                    else if let Some(&s)=manual.get(&date){
                        if allowed_clock(s){out.push(s);}
                    }else{
                        out.extend(options.iter().copied().filter(|&s|allowed_clock(s)));
                        if let Some(r)=saved{
                            if r.locked==Some(true)&&allowed_clock(r.state)&&!out.contains(&r.state){out.push(r.state);}
                        }
                    }
                }
                if force_off{out.retain(|&s|s==OFF);}
            }
            if let Some(r)=saved{
                if r.locked==Some(true){out.retain(|&s|s==r.state);}
                if mode=="HOURS_ONLY"{out.retain(|&s|if work(r.state){work(s)&&(s==DUTY)==(r.state==DUTY)}else{s==r.state});}
            }
        }
        let profile:Vec<_>=daily_options.iter().flatten().filter_map(|&s|clock(&clocks,s).map(|c|c.segments)).collect::<BTreeSet<_>>().into_iter().collect();
        let rules=Rules{days,personal,fixed,cap,target:hours*60,weekly_limit:weekly*60,inter,weekly_rest,mixed,
            untimed,hours_only:mode=="HOURS_ONLY",closed:closed_days,holiday:holiday_days,old,context,rest_weight};
        let key=(rules,daily_options);
        let (catalog,allowed)=match domains.entry(key){
            std::collections::btree_map::Entry::Occupied(entry)=>entry.get().clone(),
            std::collections::btree_map::Entry::Vacant(entry)=>{
                let (rules,options)=entry.key();
                let catalog=Arc::new(enumerate(options,rules,&clocks,deadline)?);
                let allowed:Arc<[usize]>=Arc::from((0..catalog.len()).collect::<Vec<_>>());
                entry.insert((catalog,allowed)).clone()
            }
        };
        let pinned=allowed.len()==1;
        let next=cohorts.len();let cohort=*cohorts.entry((sector,role,untimed,profile,if untimed{0}else{hours},cap)).or_insert(next);
        employees.push(TemporalEmployee{id:employees.len(),name_id:pid.to_string(),sector,role,cohort,facts:Arc::clone(&facts[sector]),
            catalog,allowed,pinned,leader,untimed,tie_ranks:std::array::from_fn(|d|if d<days{tie_rank::rank(pid,&crate::wire::date(d))}else{0}),lock_flags:std::array::from_fn(|d|old[d].and_then(|r|r.locked)),
            manual_absences:std::array::from_fn(|d|old[d].is_some_and(|r|r.manual_absence)),pattern:if pinned{Some(0)}else{None}});
    }
    check(assignment_rows.iter().all(|r|r["employeeId"].as_str().is_some_and(|id|seen.contains(id))),"ASSIGNMENT_REFERENCE")?;
    Ok(TemporalPlan{employees,score:None})
}
fn unknown(start:Instant)->V{
    json!({"httpStatus":200,"body":{"status":"UNKNOWN","message":"No validated temporal candidate","assignments":[],"wallTimeSeconds":start.elapsed().as_secs_f64()},"maxRssKiB":null})
}
pub fn solve(bytes:&[u8],start:Instant,budget:Duration)->V{
    let root:V=match serde_json::from_slice(bytes){Ok(v)=>v,Err(_)=>return super::failure(400,"SPIKE_UNSUPPORTED_INPUT","MAPPING","JSON")};
    let mut plan=match read(&root,start+budget-Duration::from_secs(1)){
        Ok(v)=>v,Err("NO_PERSONAL_PATTERN")=>return unknown(start),Err("MAPPING_TIMEOUT")=>return super::failure(504,"SOLVER_TIMED_OUT","MAPPING","MAPPING_TIMEOUT"),
        Err(e)=>return super::failure(400,"SPIKE_UNSUPPORTED_INPUT","MAPPING",e)
    };
    let mapped=start.elapsed().as_secs_f64();
    let patterns:usize=plan.employees.iter().map(|p|p.catalog.len()).sum();
    let seed_start=Instant::now();
    seed::construct(&mut plan,(seed_start+Duration::from_millis(1500)).min(start+budget-Duration::from_millis(700)));
    let seed_seconds=seed_start.elapsed().as_secs_f64();
    let initial=evaluate(&plan);
    // Preserve observed high-priority local leadership, independent of
    // the ordinal position of LEADERSHIP in the soft score.
    let critical=|plan:&TemporalPlan|->BTreeSet<(usize,usize)>{
        let mut out=BTreeSet::new();
        for p in &plan.employees{
            if !p.leader{continue;}
            if let Some(i)=p.pattern{
                for (day,&s) in p.catalog[i].states.iter().enumerate().take(p.facts.days){
                    if work(s)&&p.facts.priority[day]==Some(3)&&!p.facts.closed[day]{out.insert((p.sector,day));}
                }
            }
        }
        out
    };
    let protected=if initial[0]==0{critical(&plan)}else{BTreeSet::new()};
    let sector_guard=if initial[0]==0{Some(sector_prefix(&plan))}else{None};
    let saved:Vec<_>=plan.employees.iter().map(|p|p.pattern).collect();
    let remaining=(start+budget-Duration::from_millis(500)).saturating_duration_since(Instant::now()).as_secs();
    let attempted=remaining>0&&plan.employees.iter().any(|p|!p.pinned);
    let search_start=Instant::now();
    if attempted{
        let mut config=match SolverConfig::from_toml_str(include_str!("../solver.toml")){
            Ok(v)=>v,Err(_)=>return super::failure(500,"SPIKE_FAILED","FACTORY","CONFIG")
        };
        config=config.with_termination_seconds(remaining.min(if initial[0]==0{2}else{remaining})).with_random_seed(37);
        config.move_thread_count=MoveThreadCount::None;
        plan=match plan.solve_with_config(config){Ok(v)=>v,Err(_)=>return super::failure(500,"SPIKE_FAILED","SEARCH","NATIVE_SOLVE")};
        let cost=evaluate(&plan);
        if plan.score!=Some(expected(cost)){return super::failure(500,"SPIKE_FAILED","RESULT","TEMPORAL_SCORE_DRIFT");}
        if cost>initial||!protected.is_subset(&critical(&plan))||sector_guard.as_ref().is_some_and(|before|!prefix_preserved(before,&sector_prefix(&plan))){for (p,s) in plan.employees.iter_mut().zip(saved){p.pattern=s;}}
    }
    let cost=evaluate(&plan);
    if cost[0]!=0||start.elapsed()>budget||!plan.employees.iter().all(|p|p.pattern.is_some_and(|i|p.allowed.binary_search(&i).is_ok())){
        return unknown(start);
    }
    let mut assignments=Vec::new();
    for person in &plan.employees{
        let p=person.catalog[person.pattern.unwrap()];
        for (day,&s) in p.states.iter().enumerate().take(person.facts.days){
            let mut row=json!({"employeeId":person.name_id,"date":crate::wire::date(day),
                "kind":match s{OFF=>"OFF",ABS=>"ABSENCE",HOL=>"HOLIDAY",DUTY=>"DUTY",_=>"WORK"}});
            if let Some(c)=clock(&person.facts.clocks,s){row["shiftId"]=json!(c.id);}
            if let Some(lock)=person.lock_flags[day]{row["locked"]=json!(lock);}
            if s==ABS&&person.manual_absences[day]{row["absenceSource"]=json!("MANUAL");}
            assignments.push(row);
        }
    }
    let priorities=plan.employees.iter().any(|p|p.facts.movement_enabled);
    let days=plan.employees[0].facts.days;
    let untimed=plan.employees.iter().filter(|p|p.untimed).count();
    debug_assert!(days==7||plan.employees.iter().all(|p|p.catalog.len()<=PATH_LIMIT));
    let objective_audit:Vec<_>=OBJECTIVES.iter().enumerate().map(|(i,(name,status))|{
        let status=match *name{
            "MOVEMENT_COVERAGE"|"LEADERSHIP" if !priorities=>"NOT_APPLICABLE_NO_PRIORITIES",
            "UNTIMED_ROTATION" if untimed==0=>"NOT_APPLICABLE_TIMED_ONLY",
            "SUNDAY_PEAK" if days==7=>"NOT_APPLICABLE_ONE_WEEK",
            _=>*status,
        };
        json!({"name":name,"status":status,"cost":if status.starts_with("SCOPED")||status.starts_with("PARTIAL"){Some(cost[i+1])}else{None}})
    }).collect();
    json!({"httpStatus":200,"body":{"status":"FEASIBLE","message":"Synthetic bounded temporal candidate; independent validation required",
        "assignments":assignments,"wallTimeSeconds":start.elapsed().as_secs_f64()},"maxRssKiB":null,
        "temporal":{"version":2,"scope":"SYNTHETIC_TEMPORAL","days":days,"untimed":untimed,
            "domainMode":if days==7{"EXACT_WEEK"}else{"BOUNDED_PATHS"},"pathLimit":if days==7{30000}else{PATH_LIMIT},"partialModel":true,"mapSeconds":mapped,"seedSeconds":seed_seconds,
            "searchSeconds":if attempted{search_start.elapsed().as_secs_f64()}else{0.0},"nativeSearch":attempted,
            "entities":plan.employees.len(),"patterns":patterns,"initialCost":initial,"finalCost":cost,"objectives":objective_audit}})
}
#[cfg(test)]
mod tests{
    use super::*;
    fn fixture()->V{
        let shift=|id:&str,a:i32,block:i32,meal:i32|json!({"id":id,"segments":[
            {"kind":"WORK","start":a,"end":a+block},{"kind":"BREAK","start":a+block,"end":a+block+meal},
            {"kind":"WORK","start":a+block+meal,"end":a+2*block+meal}]});
        json!({"input":{"schemaVersion":1,"branchCode":"SYNTH","simulation":true,"timeZone":"America/Sao_Paulo",
        "planningWeekStartsOn":"SUNDAY","restRulesVersion":3,"startDate":"2026-11-01","endDate":"2026-11-07",
        "defaultWeeklyHours":42,"storeClosingMinutes":1200,"mixed42Sectors":["S"],
        "policy":{"calendarMode":"MANUAL","normativeProfile":"CUSTOM","weeklyLimit":44,"dailyLimitMinutes":528,
        "minMealMinutes":60,"minInterShiftMinutes":660,"minWeeklyRestMinutes":2100,"maxConsecutiveWorkDays":5,
        "closedDates":[],"holidayDates":[],"authorizedHolidayDates":[],"paidHolidayDates":[]},
        "shifts":[shift("eight",420,240,60),shift("nine",420,270,180),shift("late",480,240,60)],
        "employees":[{"id":"person-0","name":"Synthetic person 0","sector":"S","role":"Repositor","weeklyHours":42,
        "shiftIds":["eight","nine","late"],"scheduleMode":"TIMED","activeFrom":"","offMode":"VARIABLE","fixedOffDays":[],
        "preferredOffDays":[],"offPattern":"ANY","maxConsecutiveSundays":1,"historyKnown":true,
        "history":[{"employeeId":"person-0","date":"2026-10-25","kind":"WORK","shiftId":"eight"}]}],
        "assignments":[],"demands":[]}})
    }
    #[test]
    fn mixed_domain_exact_minutes_and_historical_sunday(){
        let plan=read(&fixture(),Instant::now()+Duration::from_secs(5)).unwrap();
        let p=&plan.employees[0];
        assert!(p.catalog.iter().all(|x|x.states[0]==OFF&&x.states.iter().filter(|&&s|s==4).count()==2
            &&x.states.iter().filter(|&&s|work(s)).count()==5));
        assert!(p.catalog.iter().any(|x|x.states.contains(&5)));
    }
    #[test]
    fn paid_holiday_and_absence_are_not_regular_off(){
        let mut data=fixture();
        data["input"]["policy"]["closedDates"]=json!(["2026-11-03"]);
        data["input"]["policy"]["holidayDates"]=json!(["2026-11-03"]);
        data["input"]["policy"]["paidHolidayDates"]=json!(["2026-11-03"]);
        data["input"]["assignments"]=json!([{"employeeId":"person-0","date":"2026-11-05","kind":"ABSENCE","locked":true}]);
        let plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        assert!(plan.employees[0].catalog.iter().all(|p|p.states[2]==HOL&&p.states[4]==ABS));
    }
    #[test]
    fn locked_hours_only_grid_and_manual_absence_are_preserved(){
        let mut data=fixture();
        data["input"]["generationMode"]=json!("HOURS_ONLY");
        data["input"]["assignments"]=json!([
            {"employeeId":"person-0","date":"2026-11-01","kind":"OFF"},
            {"employeeId":"person-0","date":"2026-11-02","kind":"WORK","shiftId":"nine","locked":true},
            {"employeeId":"person-0","date":"2026-11-03","kind":"ABSENCE","absenceSource":"MANUAL","locked":true},
            {"employeeId":"person-0","date":"2026-11-04","kind":"WORK","shiftId":"eight"},
            {"employeeId":"person-0","date":"2026-11-05","kind":"OFF"},
            {"employeeId":"person-0","date":"2026-11-06","kind":"WORK","shiftId":"eight"},
            {"employeeId":"person-0","date":"2026-11-07","kind":"WORK","shiftId":"eight"}]);
        let plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        let p=&plan.employees[0];assert!(p.manual_absences[2]);
        assert!(p.catalog.iter().all(|x|x.states[0]==OFF&&x.states[1]==4&&x.states[2]==ABS&&x.states[4]==OFF
            &&work(x.states[3])&&work(x.states[5])&&work(x.states[6])));
    }
    #[test]
    fn movement_priorities_override_branch_and_local_leader_is_scored(){
        let mut data=fixture();
        data["input"]["employees"][0]["leadership"]=json!({"source":"MANUAL","role":"SECTOR","sectors":["S"]});
        data["input"]["movementPriorities"]=json!([
            {"startDate":"2026-11-01","endDate":"2026-11-07","level":"NORMAL"},
            {"startDate":"2026-11-04","endDate":"2026-11-04","level":"HIGH","sector":"S"}]);
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        let p=&mut plan.employees[0];assert!(p.leader);assert_eq!(p.facts.priority[3],Some(3));
        p.pattern=p.catalog.iter().position(|p|p.states[3]==OFF);
        let miss=evaluate(&plan)[9];
        assert!(miss>=3);
        assert!(plan.employees[0].pattern.is_some());
    }
    #[test]
    fn rest_only_uses_first_clock_per_duration(){
        let mut data=fixture();data["input"]["generationMode"]=json!("REST_ONLY");
        let plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        assert!(plan.employees[0].catalog.iter().all(|p|!p.states.contains(&5)));
    }
    #[test]
    fn multiweek_temporal_catalogues_are_bounded_and_shared_at_scale(){
        for people in [115,250]{
            let mut data=fixture();
            data["input"]["endDate"]=json!("2026-12-12");
            let template=data["input"]["employees"][0].clone();
            data["input"]["mixed42Sectors"]=json!(["S"]);
            data["input"]["employees"]=V::Array((0..people).map(|i|{
                let mut p=template.clone();p["id"]=json!(format!("person-{i}"));p["name"]=json!(format!("Synthetic person {i}"));
                p["history"]=json!([{"employeeId":format!("person-{i}"),"date":"2026-10-25","kind":"WORK","shiftId":"eight"}]);
                p
            }).collect());
            let mut plan=read(&data,Instant::now()+Duration::from_secs(10)).unwrap();
            assert_eq!(plan.employees.len(),people);
            assert!(Arc::ptr_eq(&plan.employees[0].catalog,&plan.employees[people-1].catalog));
            let domain=&plan.employees[0].catalog;
            assert!(!domain.is_empty()&&domain.len()<=PATH_LIMIT);
            for p in domain.iter(){
                assert_eq!(p.states[0],OFF);
                for w in p.states.chunks_exact(7){
                    assert_eq!(w.iter().filter(|&&s|work(s)).count(),5);
                    assert_eq!(w.iter().filter(|&&s|s==4).count(),2);
                }
                assert!((0..5).all(|w|!work(p.states[w*7])||!work(p.states[(w+1)*7])));
                assert!(p.states.windows(6).all(|w|!w.iter().copied().all(work)));
            }
            seed::construct(&mut plan,Instant::now()+Duration::from_secs(5));
            assert_eq!(evaluate(&plan)[0],0);
        }
    }
    #[test]
    fn untimed_duty_never_covers_hourly_demand_and_keeps_history(){
        let mut data=fixture();
        data["input"]["employees"][0]["scheduleMode"]=json!("UNTIMED");
        data["input"]["employees"][0]["shiftIds"]=json!([]);
        data["input"]["employees"][0]["history"][0]["kind"]=json!("DUTY");
        data["input"]["employees"][0]["history"][0].as_object_mut().unwrap().remove("shiftId");
        data["input"]["demands"]=json!([{"id":"required","date":"2026-11-04","sector":"S","start":480,"end":540,"minimum":1,"estimated":false}]);
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        assert!(plan.employees[0].catalog.iter().all(|p|p.states[0]==OFF&&p.states.iter().filter(|&&s|s==DUTY).count()==5));
        plan.employees[0].pattern=Some(0);
        assert_eq!(evaluate(&plan)[0],60);
        assert_eq!(plan.employees[0].member().pattern.unwrap().personal[16],plan.employees[0].pattern_cost(0)[16]);
    }
    #[test]
    fn native_variable_shift_covers_confirmed_demand(){
        let mut data=fixture();
        data["input"]["demands"]=json!([{"id":"d","date":"2026-11-04","sector":"S","role":"Repositor","start":1050,"end":1140,"minimum":1,"estimated":false}]);
        let answer=solve(&serde_json::to_vec(&data).unwrap(),Instant::now(),Duration::from_secs(12));
        assert_eq!(answer["body"]["status"],"FEASIBLE");
        assert_eq!(answer["temporal"]["nativeSearch"],true);
        assert!(answer["body"]["assignments"].as_array().unwrap().iter().any(|r|r["date"]=="2026-11-04"&&r["shiftId"]=="nine"));
        assert_eq!(answer["temporal"]["objectives"].as_array().unwrap().len(),16);
    }
}
