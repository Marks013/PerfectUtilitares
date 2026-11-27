//! SF54d/e: bounded temporal horizon, synthetic-only, not a production adapter.
//! OFF, ABSENCE and HOLIDAY are separate states; work is a concrete clock.
//! Admitted synthetic same-civil-day shifts, with explicit paid and service geometry.
use std::collections::{BTreeMap,BTreeSet};
use std::sync::Arc;
use std::time::{Duration,Instant};
use serde_json::{json,Value as V};
use solverforge::{MoveThreadCount,SolverConfig};
use solverforge::stream::collector::Accumulator;
mod calendar;
mod rules;
mod tie_rank;
mod seed;
mod service_guard;
mod service_bounds;
mod comparison;
mod rest_guard;
mod feasibility;
mod report;
mod service_clocks;
use rules::{Rules,enumerate,PATH_LIMIT};
use calendar::Calendar;
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
// Not an assignment, never a rest, absence, coverage or opportunity.
const INACTIVE:u8=16;
const OBJECTIVES:[(&str,&str);16]=[
    ("COVERAGE","SCOPED"),("SUNDAY_COVERAGE","SCOPED"),("SUNDAY_PEAK","PARTIAL_GLOBAL_BOUND"),
    ("MOVEMENT_COVERAGE","SCOPED"),("CLOSING_COVERAGE","SCOPED"),
    ("UNTIMED_ROTATION","SCOPED_WEEKDAY_AND_SUNDAY"),("SUNDAY_BALANCE","SCOPED_COHORT_AND_DATES"),
    ("REST_SPACING","SCOPED_MONTHLY_EXCESS_AND_PAIRS"),("LEADERSHIP","SCOPED_EXPLICIT_RESPONSIBILITY"),
    ("SATURDAY_BALANCE","SCOPED_COHORT"),("REST_DISTRIBUTION","SCOPED_SECTOR_ROLE_AND_LEADERS"),
    ("REST_ROTATION","SCOPED"),("PEOPLE_CHANGED","SCOPED"),("STABILITY","SCOPED"),
    ("PREFERENCES","SCOPED"),("TIE_BREAK","SCOPED_ORIGINAL_SHA256"),
];
#[derive(Clone,Debug,PartialEq,Eq,Hash)]
struct Clock {id:String,segments:Vec<(i32,i32)>,paid:i32,start:i32,end:i32}
impl Clock {
    fn start(&self)->i32{self.start}
    fn end(&self)->i32{self.end}
    fn covers(&self,a:i32,b:i32)->bool{self.segments.iter().any(|&(s,e)|s<=a&&b<=e)}
    fn overnight(&self)->bool{self.end>1440}
    fn civil_parts(&self)->impl Iterator<Item=(usize,i32,i32)>+'_{
        self.segments.iter().flat_map(|&(a,b)|(0..2usize).filter_map(move |offset|{
            let base=offset as i32*1440;
            let start=(a-base).max(0);let end=(b-base).min(1440);
            (start<end).then_some((offset,start,end))
        }))
    }
}
// One unpaid meal; optional paid pauses inside the two paid blocks.
// Same civil day and store closing remain hard admission boundaries.
// Only the exact original WORK/BREAK/WORK geometry qualifies for 9h mixed.
fn read_clock(row:&V,closing:i32,daily:i32,meal:i32,limit_blocks:bool,civil_night:bool)->Result<Clock>{
    let raw=array(row,"segments")?;
    check((3..=12).contains(&raw.len()),"CLOCK_KIND")?;
    check(text(&raw[0],"kind")?=="WORK"&&text(raw.last().unwrap(),"kind")?=="WORK","CLOCK_KIND")?;
    let mut service=Vec::<(i32,i32)>::new();
    let start=number(&raw[0],"start")?;
    check(range(start,0,1439),"CLOCK_GEOMETRY")?;
    let max_end=if civil_night&&closing==1440{2880}else{closing};
    let mut end=start;
    let mut paid=0;
    let mut unpaid=0;
    let mut meal_count=0;
    let mut blocks=[0;2];
    for segment in raw{
        let a=number(segment,"start")?;
        let b=number(segment,"end")?;
        check(range(a,0,2879)&&range(b,1,2880)&&a==end&&a<b&&b<=max_end,"CLOCK_GEOMETRY")?;
        let duration=b-a;
        match text(segment,"kind")?{
            "WORK"=>{
                paid+=duration;
                blocks[meal_count]+=duration;
                // Contiguous WORK segments are one service interval.
                if let Some(last)=service.last_mut().filter(|last|last.1==a){last.1=b;}
                else{service.push((a,b));}
            },
            "PAID_BREAK"=>{paid+=duration;blocks[meal_count]+=duration;},
            "BREAK"=>{check(meal_count==0,"CLOCK_MEAL_COUNT")?;meal_count=1;unpaid=duration;},
            _=>return Err("CLOCK_KIND")
        }
        end=b;
    }
    let long=raw.len()==3&&blocks==[270,270]&&unpaid==180&&service.len()==2;
    check(meal_count==1&&unpaid>=meal&&end-start<=1080
        &&(long||matches!(paid,480|504|528)&&paid<=daily&&unpaid<=120)
        &&(!limit_blocks||blocks.into_iter().max().unwrap_or(0)<=270),"CLOCK_GEOMETRY")?;
    Ok(Clock{id:identifier(row,"id")?.to_string(),segments:service,paid,start,end})
}
fn clock(clocks:&[Clock],state:u8)->Option<&Clock>{state.checked_sub(3).and_then(|i|clocks.get(i as usize))}
fn work(state:u8)->bool{(3..=DUTY).contains(&state)}
#[derive(Clone,Copy,Debug,PartialEq,Eq,Hash)]
pub struct Pattern{pub(crate) states:[u8;MAX_DAYS],pub(crate) personal:Cost,rates:[Option<i64>;2],sunday_opportunities:u64,civil_work:u64,pub(crate) rest:[i64;5]}
#[derive(Clone,Copy,Debug,PartialEq,Eq,PartialOrd,Ord)]
struct Record{state:u8,locked:Option<bool>,manual_absence:bool}
#[derive(Clone,Debug,PartialEq,Eq,Hash)]
struct Band{day:usize,start:i32,end:i32,estimated:bool,general:i64,roles:Vec<(usize,i64)>,clock_mask:u16,previous_mask:u16}
#[derive(Debug,PartialEq,Eq,Hash)]
pub struct TemporalFacts{pub(crate) days:usize,dates:Arc<Vec<String>>,weekday_offset:usize,week_offset:usize,visible:[bool;MAX_DAYS],clocks:Arc<Vec<Clock>>,bands:Vec<Band>,closed:[bool;MAX_DAYS],closing:i32,
    priority:[Option<i64>;MAX_DAYS],movement_enabled:bool,peak_weight:i64,peak_quantum:i64,
    protected_days:u64,protected_bands:Vec<service_bounds::Bound>,comparison:Option<comparison::Bounds>}
impl TemporalFacts{
    fn weekday(&self,day:usize)->usize{(self.weekday_offset+day)%7}
    fn week(&self,day:usize)->usize{(self.week_offset+day)/7}
}
#[derive(Clone)]
pub struct Member{
    pub id:usize,pub sector:usize,pub role:usize,pub rest_role:usize,pub cohort:usize,pub leader_targets:Arc<Vec<usize>>,pub leader_label:bool,pub untimed:bool,pub facts:Arc<TemporalFacts>,pub pattern:Option<Pattern>,
}
mod incremental;
pub(crate) use incremental::TemporalAccumulator;
fn add(a:&mut Cost,b:Cost){for (x,y) in a.iter_mut().zip(b){*x+=y;}}
fn clock_masks(clocks:&[Clock],a:i32,b:i32)->(u16,u16){
    clocks.iter().enumerate().fold((0,0),|(mut current,mut previous),(i,c)|{
        let bit=1u16<<(i+3);
        if c.covers(a,b){current|=bit;}
        if c.covers(a+1440,b+1440){previous|=bit;}
        (current,previous)
    })
}
fn civil_presence(attendance:&[[Presence;16];MAX_DAYS],day:usize,current:u16,previous:u16)->Presence{
    let mut present=Presence::EMPTY;
    for (d,mut mask) in [(Some(day),current),(day.checked_sub(1),previous)]{
        let Some(d)=d else{continue;};
        while mask!=0{
            let state=mask.trailing_zeros() as usize;mask&=mask-1;
            present|=attendance[d][state];
        }
    }
    present
}
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
    result[0]+=service_bounds::deficit(facts,&attendance,&role_members);
    result[0]+=comparison::deficit(facts,&attendance,&role_members);
    for band in &facts.bands{
        // Full oracle: independently union the current and preceding
        // assignment-day bitmaps on this civil interval.
        let mut present=Presence::EMPTY;
        for (state,mask) in attendance[band.day].iter().enumerate(){
            if band.clock_mask&(1u16<<state)!=0{present|=*mask;}
            if band.day>0&&band.previous_mask&(1u16<<state)!=0{present|=attendance[band.day-1][state];}
        }
        let role_gap:i64=band.roles.iter().map(|(r,n)|{
            let members=role_members.get(r).copied().unwrap_or_default();
            (*n-i64::from((present&members).count_ones())).max(0)
        }).sum();
        let gap=(band.general-i64::from(present.count_ones())).max(0).max(role_gap);
        if band.estimated{
            let cost=gap*i64::from(band.end-band.start);
            result[1]+=cost;
            if facts.weekday(band.day)==0{result[2]+=cost;sunday[facts.week(band.day)]+=cost/facts.peak_quantum;sunday_ref[facts.week(band.day)]=true;}
            if facts.movement_enabled{result[4]+=cost*facts.priority[band.day].unwrap_or(2);}
            let close=(band.end.min(facts.closing)-band.start.max(facts.closing-60)).max(0);
            result[5]+=gap*i64::from(close);
        }else{result[0]+=gap*i64::from(band.end-band.start);}
    }
    if sunday_ref.iter().filter(|&&r|r).count()>=2{
        result[3]=sunday.iter().max().copied().unwrap_or(0)*facts.peak_weight+sunday.iter().map(|x|x*x).sum::<i64>();
    }
    add_fairness(&rows,facts,&mut result);
    result
}

// Shared fairness calculation; the coverage portion of sector_cost remains
// an independent full recomputation for differential validation.
fn add_fairness(rows:&[&Member],facts:&TemporalFacts,result:&mut Cost){
    let mut cohorts=BTreeMap::<(usize,usize),(i64,i64)>::new();
    let mut sunday_cohorts=BTreeMap::<usize,Vec<&Member>>::new();
    for row in rows{sunday_cohorts.entry(row.cohort).or_default().push(row);}
    for row in rows{
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
        for day in (0..facts.days).filter(|&d|facts.weekday(d)==0){
            let eligible:Vec<_>=cohort.iter().filter_map(|r|r.pattern).filter(|p|p.sunday_opportunities&(1u64<<day)!=0).collect();
            if !eligible.is_empty(){rates.push(eligible.iter().filter(|p|p.civil_work&(1u64<<day)!=0).count() as i64*10_000/eligible.len() as i64);}
        }
        if let (Some(lo),Some(hi))=(rates.iter().min(),rates.iter().max()){
            result[7]+=hi-lo;
            if cohort.iter().all(|r|r.untimed){result[6]+=hi-lo;}
        }
    }
    // Unique sector + role groups; don't double-count a sector with one role.
    let mut groups=BTreeMap::<usize,Vec<&Member>>::new();
    for row in rows{groups.entry(row.rest_role).or_default().push(row);}
    let mut all_groups=vec![rows.to_vec()];
    if groups.len()>1{all_groups.extend(groups.into_values());}
    for group in all_groups{result[11]+=rest_group_cost(&group,facts);}
}

fn rest_group_cost(rows:&[&Member],facts:&TemporalFacts)->i64{
    let mut total=0;
    for day in 0..facts.days{
        if facts.closed[day]{continue;}
        let (mut eligible,mut off)=(0i64,0i64);
        for row in rows{
            let Some(p)=row.pattern else{continue;};
            if !matches!(p.states[day],ABS|INACTIVE){eligible+=1;off+=i64::from(p.states[day]==OFF);}
        }
        if eligible>=2{total+=(7*off-2*eligible).abs();}
    }
    total
}
fn leadership_presence(rows:&[&Member])->BTreeSet<(usize,usize)>{
    let mut present=BTreeSet::new();
    for row in rows{
        if row.leader_targets.is_empty(){continue;}
        if let Some(p)=row.pattern{
            for (day,&state) in p.states.iter().enumerate().take(row.facts.days){
                if work(state){for &sector in row.leader_targets.iter(){present.insert((sector,day));}}
            }
        }
    }
    present
}
fn critical_leadership(plan:&TemporalPlan)->BTreeSet<(usize,usize)>{
    let members:Vec<_>=plan.employees.iter().map(TemporalEmployee::member).collect();
    let rows:Vec<_>=members.iter().collect();
    let sectors:BTreeMap<_,_>=rows.iter().map(|r|(r.sector,&r.facts)).collect();
    leadership_presence(&rows).into_iter().filter(|(s,d)|sectors.get(s).is_some_and(|f|!f.closed[*d]&&f.priority[*d]==Some(3))).collect()
}
fn global_cost<'a>(members:impl Iterator<Item=&'a Member>)->Cost{
    let rows:Vec<_>=members.collect();
    let mut out=[0;17];
    let Some(first)=rows.first() else{return out;};
    if rows.iter().any(|r|r.facts.movement_enabled){
        let facts=rows.iter().map(|r|(r.sector,&r.facts)).collect::<BTreeMap<_,_>>();
        let present=leadership_presence(&rows);
        for (&sector,f) in &facts{
            for (day,&weight) in f.priority.iter().enumerate().take(f.days){
                if !f.closed[day]&&!present.contains(&(sector,day)){out[9]+=weight.unwrap_or(0);}
            }
        }
    }
    // Original REST_DISTRIBUTION adds one distinct leadership-label group
    // across sectors. Deduplicate against the sector and role groups.
    let leaders:Vec<_>=rows.iter().copied().filter(|r|r.leader_label).collect();
    if leaders.len()>1{
        let sector=leaders[0].sector;let role=leaders[0].rest_role;
        let same_sector=leaders.iter().all(|r|r.sector==sector);
        let duplicate=same_sector&&(rows.iter().filter(|r|r.sector==sector).count()==leaders.len()
            ||leaders.iter().all(|r|r.rest_role==role)&&rows.iter().filter(|r|r.sector==sector&&r.rest_role==role).count()==leaders.len());
        if !duplicate{out[11]+=rest_group_cost(&leaders,&first.facts);}
    }
    out
}

#[derive(Default)]
pub struct GlobalAccumulator{members:BTreeMap<usize,Member>}
impl Accumulator<Member,Cost> for GlobalAccumulator{
    type Retraction=usize;
    fn accumulate(&mut self,value:Member)->usize{
        let id=value.id;assert!(self.members.insert(id,value).is_none());id
    }
    fn retract(&mut self,id:usize){assert!(self.members.remove(&id).is_some());}
    fn with_result<T>(&self,f:impl FnOnce(&Cost)->T)->T{f(&global_cost(self.members.values()))}
    fn reset(&mut self){self.members.clear();}
}
fn evaluate(plan:&TemporalPlan)->Cost{
    let mut groups=BTreeMap::<usize,Vec<Member>>::new();let mut total=[0;17];
    for person in &plan.employees{
        if person.pattern.is_none(){total[0]+=1;}
        groups.entry(person.sector).or_default().push(person.member());
    }
    for rows in groups.values(){add(&mut total,sector_cost(rows.iter()));}
    add(&mut total,global_cost(groups.values().flatten()));
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
fn dates(policy:&V,key:&str,calendar:&Calendar)->Result<BTreeSet<i32>>{
    dates_admitted(policy,key,calendar,false)
}
fn dates_admitted(policy:&V,key:&str,calendar:&Calendar,service:bool)->Result<BTreeSet<i32>>{
    let mut out=BTreeSet::new();
    if policy.get(key).is_none(){return Ok(out);}
    for item in array(policy,key)?{
        let date=item.as_str().ok_or("DATE")?;
        if key=="paidHolidayDates"&&!service{check(calendar::paid_date(date),"PAID_HOLIDAY_DATE")?;}
        let d=calendar.relative(date)?;
        check(out.insert(d),"DUPLICATE_DATE")?;
    }
    Ok(out)
}
fn code(row:&V,ids:&BTreeMap<String,u8>,pid:&str,scoped:bool)->Result<Record>{
    // requestSolver deliberately removes employeeId from nested histories.
    // Flat records still require identity; an explicitly supplied nested ID
    // must agree with the enclosing person and cannot refer to a peer.
    check(match row.get("employeeId"){None=>scoped,Some(v)=>v.as_str()==Some(pid)},"ASSIGNMENT_REFERENCE")?;
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
        for band in sector.bands.iter().filter(|b|b.estimated&&sector.weekday(b.day)==0){
            let mut n=i64::from(band.end-band.start);
            while n!=0{let rem=quantum%n;quantum=n;n=rem;}
        }
    }
    quantum=quantum.max(1);
    let mut peak=0i128;let mut secondary=0i128;
    for sector in facts.iter(){
        let mut days=[0i128;6];let mut referenced=[false;6];
        for band in sector.bands.iter().filter(|b|b.estimated&&sector.weekday(b.day)==0){
            days[sector.week(band.day)]+=i128::from(band.general)*i128::from(band.end-band.start)/i128::from(quantum);
            referenced[sector.week(band.day)]=true;
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
fn read(root:&V,deadline:Instant)->Result<TemporalPlan>{read_mode(root,deadline,false)}
fn read_mode(root:&V,deadline:Instant,civil_night:bool)->Result<TemporalPlan>{
    read_admitted(root,deadline,civil_night,false)
}
fn read_admitted(root:&V,deadline:Instant,civil_night:bool,service:bool)->Result<TemporalPlan>{
    read_detailed(root,deadline,civil_night,service,&mut None)
}
fn read_detailed(root:&V,deadline:Instant,civil_night:bool,service:bool,proof_detail:&mut Option<feasibility::BandConflict>)->Result<TemporalPlan>{
    check(root.as_object().is_some_and(|o|o.len()==1)&&root["input"].is_object(),"ENVELOPE")?;
    let input=&root["input"];let policy=&input["policy"];
    let branch=identifier(input,"branchCode")?;let simulation=boolean(input,"simulation",false)?;
    let convention=if service{optional_text(input,"planningWeekStartsOn","MONDAY")?}
        else{text(input,"planningWeekStartsOn")?};
    let rest_version=if service&&input.get("restRulesVersion").is_none(){1}else{number(input,"restRulesVersion")?};
    let version=if service&&input.get("schemaVersion").is_none(){1}else{number(input,"schemaVersion")?};
    let zone=if service{optional_text(input,"timeZone","America/Sao_Paulo")?}else{text(input,"timeZone")?};
    check(version==1&&(service||branch=="SYNTH"&&simulation)
        &&zone=="America/Sao_Paulo"
        &&if service{["MONDAY","SUNDAY"].contains(&convention)&&(1..=3).contains(&rest_version)}
            else{convention=="SUNDAY"&&rest_version==3},"TEMPORAL_HORIZON")?;
    let branch_two=service&&rest_version>=3&&!branch.trim().is_empty()
        &&branch.trim().bytes().all(|c|c.is_ascii_digit())&&branch.trim().trim_start_matches('0')=="2";
    let first=text(input,"startDate")?;
    let month=input.get("visibleMonth").map(|m|m.as_str().ok_or("VISIBLE_MONTH")).transpose()?;
    let calendar=if service{Calendar::service(first,text(input,"endDate")?,month,usize::from(convention=="MONDAY"))?}
        else{Calendar::new(first,text(input,"endDate")?,month)?};
    let days=calendar.labels.len();
    let labels=Arc::new(calendar.labels.clone());
    let relative=|date:&str|calendar.relative(date);
    for k in input.as_object().unwrap().keys(){check(!k.starts_with('_')||["_coverageServiceProtection","_initialAssignments","_coverageComparison","_coverageProtection"].contains(&k.as_str()),"PRIVATE_FIELD_UNSUPPORTED")?;}
    check(input.get("planningCalendarSource").is_none(),"TEMPORAL_METADATA")?;
    for k in ["calendarProvenance","collectiveAgreement","operationalCertificate","mealIntervalAgreement"]{
        check(policy.get(k).is_none_or(|v|service&&(v.is_null()||v.is_object())),"POLICY_METADATA_UNSUPPORTED")?;
    }
    let mode=optional_text(input,"generationMode","DAYS_AND_HOURS")?;
    check(["DAYS_AND_HOURS","REST_ONLY","HOURS_ONLY"].contains(&mode),"MODE")?;
    let calendar_mode=if service{optional_text(policy,"calendarMode","MANUAL")?}else{text(policy,"calendarMode")?};
    let profile=optional_text(policy,"normativeProfile","CUSTOM")?;
    let cct=service&&profile=="SINDECOMU_SUPERMARKETS_2026_2027";
    check(calendar_mode=="MANUAL"&&(profile=="CUSTOM"||cct),"POLICY")?;
    // Documentary metadata never grants permission. Explicit configured
    // operational limits and the original named-profile rest rule still bind.
    let holiday_rest_allowed=boolean(policy,"holidayRestAllowed",false)?&&!cct;
    let max_meal=if service{policy.get("mealIntervalAgreement").and_then(|v|v.get("maximumMinutes"))
        .and_then(V::as_i64).filter(|n|(121..=360).contains(n)).unwrap_or(120) as i32}else{120};
    let default_hours=number(input,"defaultWeeklyHours")?;
    let weekly=number(policy,"weeklyLimit")?;let daily=number(policy,"dailyLimitMinutes")?;
    let meal=number(policy,"minMealMinutes")?;let inter=number(policy,"minInterShiftMinutes")?;
    let weekly_rest=number(policy,"minWeeklyRestMinutes")?;let max_run=number(policy,"maxConsecutiveWorkDays")?;
    // Legacy callers omitted closing; do not invent an earlier cutoff.
    let closing=if service&&input.get("storeClosingMinutes").is_none(){1440}else{number(input,"storeClosingMinutes")?};
    let people=array(input,"employees")?;
    let presence_only=service&&people.iter().any(|p|p["planningEnabled"].as_bool()!=Some(false))
        &&people.iter().all(|p|p["planningEnabled"].as_bool()==Some(false)
            ||matches!(p["scheduleMode"].as_str(),Some("UNTIMED"|"MISSING")));
    check(matches!(default_hours,40|42|44)&&matches!(weekly,40|42|44)&&range(daily,1,600)
        &&range(meal,30,180)&&range(inter,660,if presence_only{i32::MAX}else{1440})
        &&range(weekly_rest,2100,if presence_only{i32::MAX}else{4320})&&range(max_run,1,6)
        &&range(closing,300,1440),"POLICY_LIMIT")?;
    let limit_blocks=boolean(policy,"limitContinuousWorkBlocks",false)?;
    let mut closed=dates(policy,"closedDates",&calendar)?;let holidays=dates(policy,"holidayDates",&calendar)?;
    if branch_two{
        for d in -1..=days as i32{if (calendar.offset as i32+d).rem_euclid(7)==0{closed.insert(d);}}
    }
    let paid=dates_admitted(policy,"paidHolidayDates",&calendar,service)?;let authorized=dates(policy,"authorizedHolidayDates",&calendar)?;
    check(paid.is_subset(&closed)&&paid.is_subset(&holidays)&&authorized.is_subset(&holidays),"HOLIDAY_POLICY")?;
    let closed_days:[bool;MAX_DAYS]=std::array::from_fn(|d|d<days&&closed.contains(&(d as i32)));
    let holiday_days:[bool;MAX_DAYS]=std::array::from_fn(|d|d<days&&holidays.contains(&(d as i32)));
    let mut mixed_sectors=BTreeSet::new();
    if input.get("mixed42Sectors").is_some(){
        for s in array(input,"mixed42Sectors")?{
            let name=s.as_str().ok_or("MIXED_SECTOR")?;
            if service{if default_hours==42{mixed_sectors.insert(name);}}
            else{check(default_hours==42&&mixed_sectors.insert(name),"MIXED_SECTOR")?;}
        }
    }
    let clock_rows=array(input,"shifts")?;
    check(clock_rows.len()<=12,"CLOCK_LIMIT")?;
    let mut clocks=Vec::new();let mut ids=BTreeMap::new();let mut admissions=Vec::new();
    for row in clock_rows{
        let c=if service{let (c,admission)=service_clocks::read(row)?;admissions.push(admission);c}
            else{read_clock(row,closing,daily,meal,limit_blocks,civil_night)?};
        check(ids.insert(c.id.clone(),(clocks.len()+3) as u8).is_none(),"DUPLICATE_CLOCK")?;
        clocks.push(c);
    }
    let clocks=Arc::new(clocks);
    let mut hints=BTreeMap::<(&str,i32),Record>::new();
    if input.get("_initialAssignments").is_some(){
        for row in array(input,"_initialAssignments")?{
            let pid=text(row,"employeeId")?;
            let day=relative(text(row,"date")?)?;
            check((0..days as i32).contains(&day),"HINT_DATE")?;
            check(hints.insert((pid,day),code(row,&ids,pid,false)?).is_none(),"DUPLICATE_HINT")?;
        }
    }
    let mut witnesses=Vec::new();

    check(!people.is_empty()&&people.len()<=if days==7&&!service{12}else{250},"TEMPORAL_PEOPLE_LIMIT")?;
    let mut sectors=BTreeMap::<String,usize>::new();let mut roles=BTreeMap::<String,usize>::new();
    let mut rest_roles=BTreeMap::<String,usize>::new();
    for row in people{
        let n=sectors.len();sectors.entry(text(row,"sector")?.to_string()).or_insert(n);
        let n=roles.len();roles.entry(text(row,"role")?.to_string()).or_insert(n);
        let n=rest_roles.len();rest_roles.entry(text(row,"role")?.trim().to_uppercase()).or_insert(n);
    }
    check(service||mixed_sectors.iter().all(|s|sectors.contains_key(*s)),"MIXED_SECTOR")?;
    type DemandGroups=BTreeMap<(usize,usize,bool),Vec<(i32,i32,i64,Option<usize>)>>;
    let mut demand_groups=DemandGroups::new();let mut demand_ids=BTreeSet::new();
    for d in array(input,"demands")?{
        if !service||d.get("id").is_some(){check(demand_ids.insert(identifier(d,"id")?),"DUPLICATE_DEMAND")?;}
        let day=relative(text(d,"date")?)?;let a=number(d,"start")?;let b=number(d,"end")?;let n=number(d,"minimum")?;
        check((0..days as i32).contains(&day)&&a>=0&&a<b&&b<=1440&&range(n,0,250),"DEMAND")?;
        let sector=*sectors.get(text(d,"sector")?).ok_or("DEMAND_SECTOR")?;
        let role=match d.get("role"){None=>None,Some(v) if v.is_null()=>None,Some(v)=>{
            let r=v.as_str().ok_or("ROLE")?;
            let next=roles.len();Some(*roles.entry(r.to_string()).or_insert(next))
        }};
        let estimated=boolean(d,"estimated",false)?;
        if estimated&&(paid.contains(&day)||branch_two&&calendar.weekday(day as usize)==0){continue;}
        demand_groups.entry((sector,day as usize,estimated)).or_default().push((a,b,i64::from(n),role));
    }
    // Legacy private coverage floors are additional mandatory minima,
    // never new estimated demand and never a replacement for confirmed input.
    if input.get("_coverageProtection").is_some(){
        for row in array(input,"_coverageProtection")?{
            check(row.as_object().is_some_and(|o|o.keys().all(|k|["date","sector","role","start","end","minimum"].contains(&k.as_str()))),"PROTECTION_FIELDS")?;
            let day=relative(text(row,"date")?)?;
            let a=number(row,"start")?;let b=number(row,"end")?;let n=number(row,"minimum")?;
            check((0..days as i32).contains(&day)&&a>=0&&a<b&&b<=1440&&range(n,0,250),"PROTECTION_BAND")?;
            let sector=*sectors.get(text(row,"sector")?).ok_or("PROTECTION_SECTOR")?;
            let role=match row.get("role"){None=>None,Some(v) if v.is_null()=>None,Some(v)=>{
                Some(*roles.get(v.as_str().ok_or("PROTECTION_ROLE")?).ok_or("PROTECTION_ROLE")?)
            }};
            demand_groups.entry((sector,day as usize,false)).or_default().push((a,b,i64::from(n),role));
        }
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
        days,dates:Arc::clone(&labels),weekday_offset:calendar.offset,week_offset:(calendar.offset+7-usize::from(convention=="MONDAY"))%7,visible:calendar.visible,clocks:Arc::clone(&clocks),bands:Vec::new(),closed:closed_days,closing,movement_enabled:!priorities.is_empty(),peak_weight:1,peak_quantum:1,protected_days:0,protected_bands:Vec::new(),comparison:None,
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
        for clock in clocks.iter(){for (_,a,b) in clock.civil_parts(){edges.insert(a);edges.insert(b);}}
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
                let (clock_mask,previous_mask)=clock_masks(&clocks,a,b);
                facts[sector].bands.push(Band{day,start:a,end:b,estimated,general,roles:floors.into_iter().collect(),clock_mask,previous_mask});
            }
        }
    }
    configure_peak(&mut facts)?;
    comparison::read(input,&calendar,&sectors,&roles,&mut facts,deadline)?;
    service_bounds::read(input,&calendar,&sectors,&roles,&mut facts)?;
    let facts:Vec<_>=facts.into_iter().map(Arc::new).collect();
    let mut employees=Vec::new();let mut seen=BTreeSet::new();
    let mut coverage_upper=feasibility::Upper::default();
    type CohortKey=(usize,usize,bool,Vec<Vec<(i32,i32)>>,[i32;6],i32);
    let mut cohorts=BTreeMap::<CohortKey,usize>::new();
    let mut rest_groups=BTreeMap::<(usize,bool,[i32;6],i32),usize>::new();
    let assignment_rows=array(input,"assignments")?;
    let mut assignments_by_person=BTreeMap::<&str,Vec<&V>>::new();
    for row in assignment_rows{assignments_by_person.entry(text(row,"employeeId")?).or_default().push(row);}
    type CachedDomain=(Arc<Vec<Pattern>>,Arc<[usize]>);
    let mut domains=BTreeMap::<(Rules,Vec<Vec<u8>>),CachedDomain>::new();
    let mut cached_patterns=0usize;
    let mut rest_weight=1i64;
    for p in people{
        check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
        let pid=identifier(p,"id")?;
        let name=if service&&p.get("name").is_none(){""}else{identifier(p,"name")?};
        check((service||pid.strip_prefix("person-").is_some_and(|s|!s.is_empty()&&s.bytes().all(|b|b.is_ascii_digit()))
            &&name.starts_with("Synthetic person "))&&seen.insert(pid),"PERSON_IDENTITY")?;
        if service&&!boolean(p,"planningEnabled",true)?{
            // Excluded rows are retained records, never optimization entities.
            let mut dates=BTreeSet::new();
            for &row in assignments_by_person.get(pid).into_iter().flatten(){
                let d=relative(text(row,"date")?)?;
                check((0..days as i32).contains(&d)&&dates.insert(d),"DUPLICATE_ASSIGNMENT")?;
                code(row,&ids,pid,false)?;
            }
            continue;
        }
        let active=text(p,"activeFrom")?;
        let schedule=if service{optional_text(p,"scheduleMode","TIMED")?}else{text(p,"scheduleMode")?};
        let untimed=matches!(schedule,"UNTIMED"|"MISSING");
        check((active.is_empty()||civil_date(active))
            &&boolean(p,"planningEnabled",true)?&&(untimed||schedule=="TIMED")&&(service||p.get("simulationDailyMinutes").is_none()),"PERSON_PROFILE")?;
        let active_start=if active.is_empty(){i32::MIN}else{relative(active)?};
        let active_end=if let Some(end)=p.get("activeUntil"){
            relative(end.as_str().ok_or("EMPLOYMENT_DATE")?)?
        }else{i32::MAX};
        check(active_start<=active_end&&active_start<days as i32&&active_end>=0,"EMPLOYMENT_WINDOW")?;
        let employed=|d:i32|(active_start..=active_end).contains(&d);
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
        let upper=role_name.trim().to_uppercase();
        let rest_role=rest_roles[&upper];
        let leader_label=upper.starts_with("ENC.")||upper.contains("ENCARREGAD")||upper.contains("GERENTE");
        let leader_targets=if let Some(l)=p.get("leadership"){
            check(["MANUAL","INFERRED"].contains(&text(l,"source")?),"LEADERSHIP_UNSUPPORTED")?;
            let responsibility=text(l,"role")?;let scope=array(l,"sectors")?;
            check(["NONE","SECTOR","BRANCH"].contains(&responsibility)&&scope.len()<=250
                &&(responsibility!="NONE"||scope.is_empty()),"LEADERSHIP_SCOPE")?;
            let mut targets=BTreeSet::new();
            for item in scope{
                let name=item.as_str().ok_or("LEADERSHIP_SCOPE")?;
                check(targets.insert(*sectors.get(name).ok_or("LEADERSHIP_SECTOR")?),"LEADERSHIP_DUPLICATE")?;
            }
            targets.into_iter().collect::<Vec<_>>()
        }else if !upper.split(|c:char|!c.is_alphanumeric()).any(|word|word=="GERENTE")
            &&(upper.contains("ENCARREGAD")||upper.split(|c:char|!c.is_alphanumeric()).any(|word|word=="ENC")){
            vec![sector]
        }else{Vec::new()};
        let leader_targets=Arc::new(leader_targets);
        let hours=number(p,"weeklyHours")?;check(matches!(hours,40|42|44),"WEEKLY_MINUTES")?;
        let simulation_daily=if p.get("simulationDailyMinutes").is_some(){
            let n=number(p,"simulationDailyMinutes")?;check(range(n,1,600),"SIMULATION_DAILY_MINUTES")?;Some(n)
        }else{None};
        let targets:[i32;6]=std::array::from_fn(|w|calendar.weeks.get(w).map_or(0,|&(_,end)|{
            let target=hours.min(calendar::weekly_ceiling(&labels[end-1]))*60;
            if simulation{simulation_daily.map_or(target,|n|target.min(n*5))}else{target}
        }));
        check(service||untimed||targets.iter().all(|&target|target<=weekly*60),"WEEKLY_MINUTES")?;
        check(["INDIVIDUAL","BRANCH"].contains(&optional_text(p,"weeklyHoursMode","INDIVIDUAL")?),"WEEKLY_MODE")?;
        let mixed:[bool;6]=std::array::from_fn(|w|!untimed&&simulation_daily.is_none()&&mixed_sectors.contains(sector_name)&&hours==42&&targets[w]==2520);
        let (fixed,personal)=if service{crate::wire::personal_rules_service(p,max_run.min(5) as u8,rest_version>=2)?}
            else{personal_rules(p,max_run.min(5) as u8)?};
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
        let mut preferred_clock=[false;16];
        let mut duration_seen=BTreeSet::new();
        for &state in &options{
            if duration_seen.insert(clock(&clocks,state).unwrap().paid){preferred_clock[usize::from(state)]=true;}
        }
        let compensation=boolean(policy,"compensationAuthorized",false)?;
        let short_pause=boolean(policy,"allowShortMealSimulation",false)?;
        let allowed_clock=|s:u8,day:usize|!untimed&&clock(&clocks,s).is_some_and(|c|{
            let ceiling=daily.min(calendar::daily_ceiling(&labels[day]));
            if service{return admissions[usize::from(s-3)].allowed(c,service_clocks::Policy{
                closing,daily:ceiling,meal,max_meal,simulation,compensation,short_pause,limit_blocks
            },mixed[calendar.week(day)]&&calendar::weekly_ceiling(&labels[day])>=42);}

            if mixed[calendar.week(day)]{c.paid==540&&calendar::weekly_ceiling(&labels[day])>=42||c.paid==480&&c.paid<=ceiling}
            else{c.paid!=540&&c.paid<=ceiling}
        });
        let mut old=[None;MAX_DAYS];
        for &row in assignments_by_person.get(pid).into_iter().flatten(){
            let d=relative(text(row,"date")?)?;check((0..days as i32).contains(&d),"DATE")?;
            check(employed(d),"OUTSIDE_EMPLOYMENT")?;
            check(old[d as usize].replace(code(row,&ids,pid,false)?).is_none(),"DUPLICATE_ASSIGNMENT")?;
        }
        if mode=="HOURS_ONLY"{check(old[..days].iter().enumerate().all(|(d,row)|!employed(d as i32)||row.is_some()),"HOURS_ONLY_GRID")?;}
        let mut context=BTreeMap::new();
        for key in ["planningHistory","history","planningFuture"]{
            if p.get(key).is_none(){continue;}
            let mut local=BTreeSet::new();
            for row in array(p,key)?{
                let d=relative(text(row,"date")?)?;
                check(if key=="planningFuture"{(days as i32..days as i32+21).contains(&d)}else{(-56..0).contains(&d)},"CONTEXT_DATE")?;
                check(local.insert(d),"DUPLICATE_CONTEXT")?;
                check(employed(d),"OUTSIDE_EMPLOYMENT")?;
                let record=code(row,&ids,pid,true)?;
                // Published overnight carry-in/out needs its own immutable
                // civil service ledger; reject rather than invent it.
                check(clock(&clocks,record.state).is_none_or(|c|!c.overnight()),"OVERNIGHT_CONTEXT_PENDING")?;
                context.insert(d,record.state);
            }
        }
        let mut daily_options=vec![Vec::<u8>::new();days];
        for (day,out) in daily_options.iter_mut().enumerate(){
            let saved=old[day];let date=day as i32;
            if !employed(date){out.push(INACTIVE);continue;}
            let absence=saved.is_some_and(|r|r.state==ABS);
            let holiday=mode!="HOURS_ONLY"&&paid.contains(&date)||saved.is_some_and(|r|r.state==HOL);
            if absence{out.push(ABS);}else if holiday{
                check(paid.contains(&date)||service&&saved.is_some_and(|r|r.state==HOL),"HOLIDAY_POLICY")?;
                check(saved.is_none_or(|r|r.locked!=Some(true)||r.state==HOL),if service{"INFEASIBLE_PERSONAL_DOMAIN"}else{"LOCKED_HOLIDAY"})?;
                out.push(HOL);
            }else{
                let weekday=calendar.weekday(day);
                let force_off=fixed&(1<<weekday)!=0;
                let off_allowed=(rest_version<2||weekday!=6)&&(!holidays.contains(&date)||weekday==0||holiday_rest_allowed);
                if off_allowed{out.push(OFF);}
                if !force_off&&!closed.contains(&date)&&(service||!holidays.contains(&date)||authorized.contains(&date)){
                    if untimed{out.push(DUTY);}
                    else if let Some(&s)=manual.get(&date){
                        if allowed_clock(s,day){out.push(s);}
                    }else{
                        out.extend(options.iter().copied().filter(|&s|allowed_clock(s,day)));
                        if let Some(r)=saved{
                            if r.locked==Some(true)&&allowed_clock(r.state,day)&&!out.contains(&r.state){out.push(r.state);}
                        }
                    }
                }
                if force_off{out.retain(|&s|s==OFF);}
            }
            out.retain(|&s|clock(&clocks,s).is_none_or(|c|!c.overnight()
                ||day+1<days&&employed(date+1)&&!closed.contains(&(date+1))
                &&(!holidays.contains(&(date+1))||authorized.contains(&(date+1)))));
            if let Some(r)=saved{
                if r.locked==Some(true){out.retain(|&s|s==r.state);}
                if mode=="HOURS_ONLY"{out.retain(|&s|if work(r.state){work(s)&&(s==DUTY)==(r.state==DUTY)}else{s==r.state});}
            }
        }
        let profile:Vec<_>=daily_options.iter().flatten().filter_map(|&s|clock(&clocks,s).map(|c|c.segments.clone())).collect::<BTreeSet<_>>().into_iter().collect();
        let rules=Rules{days,personal,fixed,cap,weeks:calendar.weeks.clone(),targets,offset:calendar.offset,cutover:calendar.cutover,weekly_limit:weekly*60,inter,weekly_rest,mixed,active_start,active_end,rest_version,service,
            terminal_fixed_rest_allowed:!service||employed(days as i32)
                &&(rest_version<2||calendar.weekday(days)!=6)
                &&(!holidays.contains(&(days as i32))||calendar.weekday(days)==0||holiday_rest_allowed),
            untimed,hours_only:mode=="HOURS_ONLY",closed:closed_days,holiday:holiday_days,old,context,visible:calendar.visible};
        rest_weight+=rules.pair_terms();
        let hint=if hints.is_empty(){None}else{
            let mut states=[OFF;MAX_DAYS];
            let mut complete=true;
            for (d,options) in daily_options.iter().enumerate(){
                let state=if employed(d as i32){
                    hints.get(&(pid,d as i32)).map(|r|r.state)
                }else{Some(INACTIVE)};
                if let Some(state)=state.filter(|s|options.contains(s)){states[d]=state;}else{complete=false;break;}
            }
            if complete&&rules.legal_prefix(&states[..days],&clocks){Some(rules.pattern(states,&clocks))}else{None}
        };
        witnesses.push(hint);
        let proof_options=service.then(||daily_options.clone());
        let key=(rules,daily_options);
        let (catalog,allowed)=match domains.entry(key){
            std::collections::btree_map::Entry::Occupied(entry)=>entry.get().clone(),
            std::collections::btree_map::Entry::Vacant(entry)=>{
                let (rules,options)=entry.key();
                let catalog=Arc::new(enumerate(options,rules,&clocks,deadline)?);
                // Preserve the old twelve-profile worst-case memory envelope
                // when larger service teams reuse or diversify weekly domains.
                cached_patterns+=catalog.len();
                check(cached_patterns<=12*30_000,"TEMPORAL_TOTAL_DOMAIN_LIMIT")?;
                let allowed:Arc<[usize]>=Arc::from((0..catalog.len()).collect::<Vec<_>>());
                entry.insert((catalog,allowed)).clone()
            }
        };
        let pinned=allowed.len()==1;
        let next=cohorts.len();let cohort=*cohorts.entry((sector,role,untimed,profile,if untimed{[0;6]}else{targets},cap)).or_insert(next);
        let next=rest_groups.len();let rest_group=*rest_groups.entry((sector,untimed,if untimed{[0;6]}else{targets},cap)).or_insert(next);
        // SHA ranks are immutable per person/date. Cache a compact sum
        // per admitted path instead of scanning 42 cells on every score.
        let ranks:[u16;MAX_DAYS]=std::array::from_fn(|d|if d<days{tie_rank::rank(pid,&labels[d]) as u16}else{0});
        let tie_costs:Arc<[u16]>=Arc::from(catalog.iter().map(|p|
            p.states.iter().zip(ranks).filter(|(state,_)|**state==OFF).map(|(_,rank)|rank).sum::<u16>()
        ).collect::<Vec<_>>());
        employees.push(TemporalEmployee{id:employees.len(),name_id:pid.to_string(),sector,role,cohort,facts:Arc::clone(&facts[sector]),
            catalog,allowed,pinned,leader_targets,leader_label,rest_role,untimed,rest_group,rest_weight:0,preferred_clock,tie_costs,lock_flags:std::array::from_fn(|d|old[d].and_then(|r|r.locked)),
            manual_absences:std::array::from_fn(|d|old[d].is_some_and(|r|r.manual_absence)),pattern:if pinned{Some(0)}else{None}});
        if let Some(options)=proof_options{coverage_upper.observe(employees.last().unwrap(),&options,deadline)?;}
    }
    check(assignment_rows.iter().all(|r|r["employeeId"].as_str().is_some_and(|id|seen.contains(id))),"ASSIGNMENT_REFERENCE")?;
    for p in &mut employees{p.rest_weight=rest_weight;}
    // Optional client hint is all-or-nothing. It is not an assignment lock.
    // Keep the shared sampled catalogue untouched and add a legal individual
    // witness only if all active positions were supplied and validated.
    let required:usize=witnesses.iter().flatten().map(|p|p.states[..days].iter().filter(|&&s|s!=INACTIVE).count()).sum();
    let complete=!hints.is_empty()&&witnesses.iter().all(Option::is_some)&&hints.len()==required
        &&hints.keys().all(|(pid,_)|seen.contains(pid));
    if complete{
        for (person,hint) in employees.iter_mut().zip(witnesses){
            let hint=hint.unwrap();
            if let Some(index)=person.catalog.iter().position(|p|p.states==hint.states){person.pattern=Some(index);continue;}
            // A complete seven-day catalogue cannot miss a legal witness.
            check(days!=7,"HINT_EXACT_DOMAIN_DRIFT")?;
            let mut catalog=person.catalog.as_ref().clone();
            if catalog.len()==PATH_LIMIT{catalog.pop();}
            let index=catalog.len();catalog.push(hint);
            person.allowed=Arc::from((0..catalog.len()).collect::<Vec<_>>());
            let ranks:[u16;MAX_DAYS]=std::array::from_fn(|d|if d<days{tie_rank::rank(&person.name_id,&labels[d]) as u16}else{0});
            person.tie_costs=Arc::from(catalog.iter().map(|p|p.states.iter().zip(ranks)
                .filter(|(s,_)|**s==OFF).map(|(_,r)|r).sum::<u16>()).collect::<Vec<_>>());
            person.catalog=Arc::new(catalog);person.pinned=person.allowed.len()==1;person.pattern=Some(index);
        }
    }
    if service{
        coverage_upper.verify(&facts,&calendar,deadline,proof_detail)?;
        // Keep unsupported all-disabled/empty estimated sectors explicit rather
        // than omit a constant demand cost from the published quality vector.
        check(!employees.is_empty(),"NO_ACTIVE_EMPLOYEES")?;
        let active:BTreeSet<_>=employees.iter().map(|p|p.sector).collect();
        check(facts.iter().enumerate().all(|(id,f)|active.contains(&id)||f.bands.iter()
            .all(|b|!b.estimated||b.general==0&&b.roles.iter().all(|(_,n)|*n==0))),"EMPTY_SECTOR_ESTIMATES_PENDING")?;
    }
    let mut plan=TemporalPlan{employees,score:None};
    if complete&&evaluate(&plan)[0]!=0{
        // A complete but globally infeasible hint cannot replace construction.
        for p in &mut plan.employees{if !p.pinned{p.pattern=None;}}
    }
    Ok(plan)
}
fn unknown(start:Instant)->V{
    json!({"httpStatus":200,"body":{"status":"UNKNOWN","message":"No validated temporal candidate","assignments":[],"wallTimeSeconds":start.elapsed().as_secs_f64()},"maxRssKiB":null})
}
/// Private service entry: original identifiers, unchanged bounded policy model.
pub(crate) fn solve_service(bytes:&[u8],start:Instant,budget:Duration)->V{solve_admitted(bytes,start,budget,false,true)}
pub fn solve(bytes:&[u8],start:Instant,budget:Duration)->V{solve_mode(bytes,start,budget,false)}
pub(crate) fn solve_civil_night(bytes:&[u8],start:Instant,budget:Duration)->V{solve_mode(bytes,start,budget,true)}
fn solve_mode(bytes:&[u8],start:Instant,budget:Duration,civil_night:bool)->V{
    solve_admitted(bytes,start,budget,civil_night,false)
}
fn solve_admitted(bytes:&[u8],start:Instant,budget:Duration,civil_night:bool,service:bool)->V{
    let root:V=match serde_json::from_slice(bytes){Ok(v)=>v,Err(_)=>return super::failure(400,"SPIKE_UNSUPPORTED_INPUT","MAPPING","JSON")};
    let deadline=start+budget-Duration::from_secs(1);
    let mut proof_detail=None;
    let mut plan=match if service{read_detailed(&root,deadline,false,true,&mut proof_detail)}else if civil_night{read_mode(&root,deadline,true)}else{read(&root,deadline)}{
        Ok(v)=>v,
        Err(code @ ("INFEASIBLE_COVERAGE_BOUND"|"INFEASIBLE_COMPARISON_BOUND")) if service=>{
            let message=if code=="INFEASIBLE_COMPARISON_BOUND"{
                "A disponibilidade máxima não atende ao limite de desfalque configurado."
            }else{"A disponibilidade máxima não atende à cobertura obrigatória; nenhuma proteção foi removida."};
            let message=proof_detail.as_ref().map_or_else(||message.to_string(),|d|format!(
                "Cobertura obrigatória indisponível em {}, das {:02}:{:02} às {:02}:{:02}; intervalos de refeição não contam como trabalho. Nenhuma proteção foi removida.",
                d.date,d.start/60,d.start%60,d.end/60,d.end%60));
            return json!({"httpStatus":200,"body":{"status":"INFEASIBLE","assignments":[],
                "message":message,"rejectionStage":"SEARCH","proofMethod":"RELAXED_CAPACITY_BOUND",
                "solverDiagnostics":[{"family":"COVERAGE","message":message}],
                "wallTimeSeconds":start.elapsed().as_secs_f64()},"maxRssKiB":null});
        },
        Err("INFEASIBLE_PERSONAL_DOMAIN") if service=>{
            let message="As regras pessoais e os horários permitidos não admitem um padrão completo; nenhum bloqueio foi removido.";
            let mut diagnostics=vec![json!({"family":"AVAILABILITY","message":message})];
            let input=&root["input"];
            if !empty_array(input,"_coverageProtection")||input.get("_coverageServiceProtection").is_some(){
                diagnostics.push(json!({"family":"COVERAGE","message":"A cobertura solicitada não pode ser satisfeita junto das regras pessoais comprovadamente incompatíveis."}));
            }
            return json!({"httpStatus":200,"body":{"status":"INFEASIBLE","message":message,
                "proofMethod":"EXHAUSTIVE_PERSONAL_DOMAIN","solverDiagnostics":diagnostics,
                "assignments":[],"wallTimeSeconds":start.elapsed().as_secs_f64()},"maxRssKiB":null});
        },
        Err("NO_PERSONAL_PATTERN")=>return unknown(start),Err("MAPPING_TIMEOUT")=>return super::failure(504,"SOLVER_TIMED_OUT","MAPPING","MAPPING_TIMEOUT"),
        Err(e)=>return super::failure(400,"SPIKE_UNSUPPORTED_INPUT","MAPPING",e)
    };
    let mapped=start.elapsed().as_secs_f64();
    let patterns:usize=plan.employees.iter().map(|p|p.catalog.len()).sum();
    if service{eprintln!("SOLVERFORGE_PHASE_V1 CONSTRUCTION");}
    let seed_start=Instant::now();
    seed::construct(&mut plan,(seed_start+Duration::from_millis(1500)).min(start+budget-Duration::from_millis(700)));
    let seed_seconds=seed_start.elapsed().as_secs_f64();
    let initial=evaluate(&plan);
    // Explicit responsibilities are global; a leader's presence can cover
    // another named sector, but never becomes that sector's hourly WORK.
    let protected=if initial[0]==0{critical_leadership(&plan)}else{BTreeSet::new()};
    let sector_guard=if initial[0]==0{Some(sector_prefix(&plan))}else{None};
    let service_guard=if initial[0]==0{Some(service_guard::Snapshot::capture(&plan))}else{None};
    let rest_guard=if initial[0]==0{Some(rest_guard::Snapshot::capture(&plan))}else{None};
    let saved:Vec<_>=plan.employees.iter().map(|p|p.pattern).collect();
    let remaining=(start+budget-Duration::from_millis(500)).saturating_duration_since(Instant::now()).as_secs();
    let attempted=remaining>0&&plan.employees.iter().any(|p|!p.pinned);
    let search_start=Instant::now();
    let mut native_candidate=None;let mut guard_preserved=None;let mut native_accepted=false;
    if attempted{
        let mut config=match SolverConfig::from_toml_str(include_str!("../solver.toml")){
            Ok(v)=>v,Err(_)=>return super::failure(500,"SPIKE_FAILED","FACTORY","CONFIG")
        };
        config=config.with_termination_seconds(remaining.min(if initial[0]==0{2}else{remaining})).with_random_seed(37);
        config.move_thread_count=MoveThreadCount::None;
        if service{eprintln!("SOLVERFORGE_PHASE_V1 REFINEMENT");}
        plan=match plan.solve_with_config(config){Ok(v)=>v,Err(_)=>return super::failure(500,"SPIKE_FAILED","SEARCH","NATIVE_SOLVE")};
        let cost=evaluate(&plan);
        if plan.score!=Some(expected(cost)){return super::failure(500,"SPIKE_FAILED","RESULT","TEMPORAL_SCORE_DRIFT");}
        native_candidate=Some(cost);
        let preserves=protected.is_subset(&critical_leadership(&plan))
            &&sector_guard.as_ref().is_none_or(|before|prefix_preserved(before,&sector_prefix(&plan)))
            &&service_guard.as_ref().is_none_or(|before|before.preserves(&plan))
            &&rest_guard.as_ref().is_none_or(|before|before.preserves(&plan));
        guard_preserved=Some(preserves);
        native_accepted=preserves&&cost<initial;
        if !native_accepted{for (p,s) in plan.employees.iter_mut().zip(saved){p.pattern=s;}}
    }
    let cost=evaluate(&plan);
    if cost[0]!=0||start.elapsed()>budget||!plan.employees.iter().all(|p|p.pattern.is_some_and(|i|p.allowed.binary_search(&i).is_ok())){
        return unknown(start);
    }
    let search_seconds=if attempted{search_start.elapsed().as_secs_f64()}else{0.0};
    let mut assignments=Vec::new();
    for person in &plan.employees{
        let p=person.catalog[person.pattern.unwrap()];
        for (day,&s) in p.states.iter().enumerate().take(person.facts.days){
            if s==INACTIVE{continue;}
            let mut row=json!({"employeeId":person.name_id,"date":person.facts.dates[day],
                "kind":match s{OFF=>"OFF",ABS=>"ABSENCE",HOL=>"HOLIDAY",DUTY=>"DUTY",_=>"WORK"}});
            if let Some(c)=clock(&person.facts.clocks,s){row["shiftId"]=json!(c.id);}
            if let Some(lock)=person.lock_flags[day]{row["locked"]=json!(lock);}
            if s==ABS&&person.manual_absences[day]{row["absenceSource"]=json!("MANUAL");}
            assignments.push(row);
        }
    }
    if service{
        let input=&root["input"];
        let disabled:BTreeSet<_>=input["employees"].as_array().unwrap().iter()
            .filter(|p|p.get("planningEnabled")==Some(&V::Bool(false))).filter_map(|p|p["id"].as_str()).collect();
        let originals:BTreeMap<_,_>=input["assignments"].as_array().unwrap().iter()
            .map(|r|((r["employeeId"].as_str().unwrap(),r["date"].as_str().unwrap()),r)).collect();
        for row in &mut assignments{
            let key=(row["employeeId"].as_str().unwrap(),row["date"].as_str().unwrap());
            if let Some(old)=originals.get(&key){
                let mut merged=(*old).clone();
                merged.as_object_mut().unwrap().remove("shiftId");
                if row["kind"]!="ABSENCE"{merged.as_object_mut().unwrap().remove("absenceSource");}
                for (key,value) in row.as_object().unwrap(){merged[key]=value.clone();}
                *row=merged;
            }
        }
        let preserve_all=input["generationMode"]=="HOURS_ONLY";
        assignments.extend(input["assignments"].as_array().unwrap().iter().filter(|row|
            row["employeeId"].as_str().is_some_and(|id|disabled.contains(id))
            &&(preserve_all||row["locked"]==true||row["kind"]=="ABSENCE"||row["kind"]=="HOLIDAY")).cloned());
    }
    let rest_weight=plan.employees[0].rest_weight;
    let rest_pairs:i64=plan.employees.iter().map(|p|p.catalog[p.pattern.unwrap()].rest[1]).sum();
    let rest_excess:i64=plan.employees.iter().map(|p|p.catalog[p.pattern.unwrap()].rest[0]).sum();
    let priorities=plan.employees.iter().any(|p|p.facts.movement_enabled);
    let days=plan.employees[0].facts.days;
    let untimed=plan.employees.iter().filter(|p|p.untimed).count();
    let positions=|p:&TemporalEmployee|p.catalog[p.pattern.unwrap()].states[..days].iter().filter(|&&s|s!=INACTIVE).count();
    let active_positions:usize=plan.employees.iter().map(positions).sum();
    let untimed_positions:usize=plan.employees.iter().filter(|p|p.untimed).map(positions).sum();
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
    let mut reply=json!({"httpStatus":200,"body":{"status":"FEASIBLE","message":if service{"Bounded SolverForge candidate; independent validation required"}else{"Synthetic bounded temporal candidate; independent validation required"},
        "assignments":assignments,"wallTimeSeconds":start.elapsed().as_secs_f64()},"maxRssKiB":null,
        "temporal":{"version":2,"scope":if service{"SERVICE_TEMPORAL"}else if civil_night{"SYNTHETIC_CIVIL_NIGHT"}else{"SYNTHETIC_TEMPORAL"},"days":days,"untimed":untimed,"activePositions":active_positions,"untimedPositions":untimed_positions,
            "domainMode":if days==7{"EXACT_WEEK"}else{"BOUNDED_PATHS"},"pathLimit":if days==7{30000}else{PATH_LIMIT},"partialModel":true,"mapSeconds":mapped,"visibleDays":plan.employees[0].facts.visible.iter().filter(|&&v|v).count(),"seedSeconds":seed_seconds,
            "searchSeconds":search_seconds,"nativeSearch":attempted,
            "nativeCandidateCost":native_candidate,"nativeAccepted":native_accepted,"guardPreserved":guard_preserved,
            "resultSource":if native_accepted{"NATIVE"}else if attempted{"SEED_RETAINED"}else{"CONSTRUCTOR_ONLY"},
            "entities":plan.employees.len(),"patterns":patterns,"restWeight":rest_weight,"restPairs":rest_pairs,"restExcess":rest_excess,"initialCost":initial,"finalCost":cost,"objectives":objective_audit}});
    if service{reply["body"]["optimization"]=report::metadata(&plan,initial,cost,[mapped,seed_seconds,search_seconds],attempted,native_accepted);}
    reply
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
        assert!(matches!(read(&data,Instant::now()+Duration::from_secs(5)),Err("PAID_HOLIDAY_DATE")));
        data["input"]["startDate"]=json!("2026-04-26");data["input"]["endDate"]=json!("2026-05-02");
        data["input"]["employees"][0]["history"][0]["date"]=json!("2026-04-19");
        data["input"]["policy"]["closedDates"]=json!(["2026-05-01"]);
        data["input"]["policy"]["holidayDates"]=json!(["2026-05-01"]);
        data["input"]["policy"]["paidHolidayDates"]=json!(["2026-05-01"]);
        data["input"]["assignments"]=json!([{"employeeId":"person-0","date":"2026-04-30","kind":"ABSENCE","locked":true}]);
        let plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        assert!(plan.employees[0].catalog.iter().all(|p|p.states[5]==HOL&&p.states[4]==ABS&&p.states[0]==OFF));
        assert_eq!(plan.employees[0].facts.dates[5],"2026-05-01");
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
        let p=&mut plan.employees[0];assert_eq!(p.leader_targets.as_slice(),&[0]);assert_eq!(p.facts.priority[3],Some(3));
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
    fn private_service_bound_is_hard_even_without_demands(){
        let mut data=fixture();
        data["input"]["employees"][0]["history"]=json!([]);
        data["input"]["_coverageServiceProtection"]=json!({
            "days":[{"sector":"S","date":"2026-11-04"}],
            "bands":[{"sector":"S","role":"Repositor","start":1050,"end":1140,"scope":"HORIZON","minimum":2}]
        });
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        let good=plan.employees[0].catalog.iter().position(|p|work(p.states[3])).unwrap();
        let bad=plan.employees[0].catalog.iter().position(|p|p.states[3]==OFF).unwrap();
        plan.employees[0].pattern=Some(good);assert_eq!(evaluate(&plan)[0],0);
        plan.employees[0].pattern=Some(bad);assert!(evaluate(&plan)[0]>0);
        data["input"]["_coverageServiceProtection"]["bands"][0]["role"]=json!("Unknown");
        assert!(matches!(read(&data,Instant::now()+Duration::from_secs(5)),Err("SERVICE_ROLE")));
        data["input"]["_coverageServiceProtection"]["bands"][0]["role"]=json!("Repositor");
        data["input"]["_coverageServiceProtection"]["bands"][0]["minimum"]=json!(3);
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        plan.employees[0].pattern=Some(0);assert!(evaluate(&plan)[0]>0);
    }
    #[test]
    fn explicit_cross_sector_leadership_does_not_invent_hourly_coverage(){
        let mut data=fixture();
        let mut peer=data["input"]["employees"][0].clone();
        peer["id"]=json!("person-1");peer["name"]=json!("Synthetic person 1");peer["sector"]=json!("T");
        peer["history"]=json!([]);
        data["input"]["employees"].as_array_mut().unwrap().push(peer);
        data["input"]["employees"][0]["leadership"]=json!({"source":"MANUAL","role":"BRANCH","sectors":["S","T"]});
        data["input"]["movementPriorities"]=json!([{"startDate":"2026-11-04","endDate":"2026-11-04","level":"HIGH"}]);
        data["input"]["demands"]=json!([{"id":"d","date":"2026-11-04","sector":"T","start":480,"end":540,"minimum":1,"estimated":false}]);
        // Both people have 42h contracts and only 480/540-minute clocks.
        // Without enabling the mixed 42h profile in T, that peer has no
        // legal 2520-minute week. Keep the rejection as a negative oracle.
        assert!(matches!(read(&data,Instant::now()+Duration::from_secs(5)),Err("NO_PERSONAL_PATTERN")));
        data["input"]["mixed42Sectors"]=json!(["S","T"]);
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        assert!(plan.employees.iter().all(|p|p.catalog.iter().all(|x|
            x.states[..7].iter().filter(|&&s|work(s)).count()==5
            &&x.states[..7].iter().filter(|&&s|s==4).count()==2)));
        let a=plan.employees[0].catalog.iter().position(|p|work(p.states[3])).unwrap();
        let b=plan.employees[1].catalog.iter().position(|p|p.states[3]==OFF).unwrap();
        plan.employees[0].pattern=Some(a);plan.employees[1].pattern=Some(b);
        assert_eq!(evaluate(&plan)[9],0);
        assert_eq!(evaluate(&plan)[0],60);
        assert_eq!(critical_leadership(&plan).len(),2);
        plan.employees[0].pattern=plan.employees[0].catalog.iter().position(|p|p.states[3]==OFF);
        assert_eq!(evaluate(&plan)[9],6);
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
                for w in p.states.as_chunks::<7>().0{
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
    fn temporal_guard_rejects_loss_of_role_clock_service_without_demand(){
        let mut plan=read(&fixture(),Instant::now()+Duration::from_secs(5)).unwrap();
        let domain=&plan.employees[0].catalog;
        let mut pair=None;
        for (i,p) in domain.iter().enumerate(){
            if let Some(day)=p.states[..7].iter().position(|&s|s==3){
                let mut shifted=p.states;shifted[day]=5;
                if let Some(j)=domain.iter().position(|x|x.states==shifted){
                    pair=Some((i,j));break;
                }
            }
        }
        let (early,late)=pair.expect("both legal clocks on the same day");
        plan.employees[0].pattern=Some(early);
        let guard=service_guard::Snapshot::capture(&plan);
        assert!(guard.preserves(&plan));
        plan.employees[0].pattern=Some(late);
        assert_eq!(evaluate(&plan)[0],0);
        assert!(!guard.preserves(&plan));
    }
    #[test]
    fn scoped_wire_history_uses_enclosing_person_and_rejects_wrong_identity(){
        let mut data=fixture();
        data["input"]["employees"][0]["history"][0].as_object_mut().unwrap().remove("employeeId");
        let plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        assert!(plan.employees[0].catalog.iter().all(|p|p.states[0]==OFF));
        data["input"]["employees"][0]["history"][0]["employeeId"]=json!("person-99");
        assert!(matches!(read(&data,Instant::now()+Duration::from_secs(5)),Err("ASSIGNMENT_REFERENCE")));
        data["input"]["employees"][0]["history"][0].as_object_mut().unwrap().remove("employeeId");
        data["input"]["assignments"]=json!([{"date":"2026-11-03","kind":"OFF","locked":true}]);
        assert!(read(&data,Instant::now()+Duration::from_secs(5)).is_err());
    }
    #[test]
    fn seed_prefers_first_clock_per_duration_only_when_coverage_ties(){
        let mut data=fixture();
        data["input"]["employees"][0]["history"]=json!([]);
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        seed::construct(&mut plan,Instant::now()+Duration::from_secs(1));
        assert!(!plan.employees[0].catalog[plan.employees[0].pattern.unwrap()].states.contains(&5));
        data["input"]["demands"]=json!([{"id":"late","date":"2026-11-04","sector":"S","start":990,"end":1020,"minimum":1,"estimated":false}]);
        // The ordinary early 8h shift ends at 960; the late one ends at 1020.
        // Restrict Wednesday to 8h by locking the two long shifts elsewhere.
        data["input"]["assignments"]=json!([
            {"employeeId":"person-0","date":"2026-11-03","kind":"WORK","shiftId":"nine","locked":true},
            {"employeeId":"person-0","date":"2026-11-06","kind":"WORK","shiftId":"nine","locked":true}]);
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        seed::construct(&mut plan,Instant::now()+Duration::from_secs(1));
        assert_eq!(plan.employees[0].catalog[plan.employees[0].pattern.unwrap()].states[3],5);
        assert_eq!(evaluate(&plan)[0],0);
    }
    #[test]
    fn transition_caps_and_december_partial_weeks_use_civil_dates(){
        let mut data=fixture();
        data["input"]["startDate"]=json!("2026-12-01");data["input"]["endDate"]=json!("2026-12-31");
        data["input"]["visibleMonth"]=json!("2026-12");
        data["input"]["defaultWeeklyHours"]=json!(44);data["input"]["mixed42Sectors"]=json!([]);
        let person=&mut data["input"]["employees"][0];
        person["weeklyHours"]=json!(44);person["shiftIds"]=json!(["before","after"]);person["history"]=json!([]);
        data["input"]["shifts"]=json!([
            {"id":"before","segments":[{"kind":"WORK","start":420,"end":684},{"kind":"BREAK","start":684,"end":744},{"kind":"WORK","start":744,"end":1008}]},
            {"id":"after","segments":[{"kind":"WORK","start":420,"end":672},{"kind":"BREAK","start":672,"end":732},{"kind":"WORK","start":732,"end":984}]}
        ]);
        data["input"]["policy"]["closedDates"]=json!(["2026-12-25"]);
        data["input"]["policy"]["holidayDates"]=json!(["2026-12-25"]);
        data["input"]["policy"]["paidHolidayDates"]=json!(["2026-12-25"]);
        let plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        assert_eq!(plan.employees[0].facts.dates.len(),31);
        for p in plan.employees[0].catalog.iter(){
            assert_eq!(p.states[..5].iter().filter(|&&s|work(s)).count(),3);
            assert_eq!(p.states[..5].iter().filter(|&&s|s==OFF).count(),2);
            assert_eq!(p.states[24],HOL);
            assert!(p.states[15..31].iter().all(|&s|s!=3));
            assert_eq!(p.states[5..12].iter().filter_map(|&s|clock(&plan.employees[0].facts.clocks,s)).map(|c|c.paid).sum::<i32>(),2640);
            assert_eq!(p.states[12..19].iter().filter_map(|&s|clock(&plan.employees[0].facts.clocks,s)).map(|c|c.paid).sum::<i32>(),2520);
        }
    }
    #[test]
    fn rest_spacing_uses_original_pair_count_weight_and_protects_padding(){
        let mut data=fixture();
        data["input"]["employees"][0]["history"]=json!([{"date":"2026-10-31","kind":"OFF"}]);
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        assert_eq!(plan.employees[0].rest_weight,8);
        let p=&mut plan.employees[0];
        let low=p.catalog.iter().position(|pat|pat.rest[1]==0).unwrap();
        let high=p.catalog.iter().position(|pat|pat.rest[1]>0).unwrap();
        p.pattern=Some(low);
        let guard=rest_guard::Snapshot::capture(&plan);
        assert!(guard.preserves(&plan));
        plan.employees[0].pattern=Some(high);
        assert!(!guard.preserves(&plan));
        let p=&plan.employees[0];
        assert_eq!(p.pattern_cost(high)[8],p.rest_weight*p.catalog[high].rest[0]+p.catalog[high].rest[1]);
    }
    #[test]
    fn same_day_night_simulation_does_not_bypass_closing(){
        let mut data=fixture();
        data["input"]["defaultWeeklyHours"]=json!(40);data["input"]["mixed42Sectors"]=json!([]);
        data["input"]["employees"][0]["weeklyHours"]=json!(40);
        data["input"]["employees"][0]["history"]=json!([]);
        data["input"]["employees"][0]["shiftIds"]=json!(["night"]);
        data["input"]["storeClosingMinutes"]=json!(1380);
        data["input"]["shifts"]=json!([{"id":"night","segments":[
            {"kind":"WORK","start":840,"end":1080},{"kind":"BREAK","start":1080,"end":1140},{"kind":"WORK","start":1140,"end":1380}]}]);
        let plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        assert!(plan.employees[0].catalog.iter().all(|p|p.states.iter().filter(|&&s|s==3).count()==5));
        data["input"]["storeClosingMinutes"]=json!(1200);
        assert!(matches!(read(&data,Instant::now()+Duration::from_secs(5)),Err("CLOCK_GEOMETRY")));
    }
    #[test]
    fn paid_pause_is_credited_but_never_provides_service(){
        let mut data=fixture();
        data["input"]["defaultWeeklyHours"]=json!(40);data["input"]["mixed42Sectors"]=json!([]);
        data["input"]["employees"][0]["weeklyHours"]=json!(40);
        data["input"]["employees"][0]["shiftIds"]=json!(["pause"]);
        data["input"]["employees"][0]["history"]=json!([]);
        data["input"]["shifts"]=json!([{"id":"pause","segments":[
            {"kind":"WORK","start":420,"end":540},
            {"kind":"PAID_BREAK","start":540,"end":555},
            {"kind":"WORK","start":555,"end":660},
            {"kind":"BREAK","start":660,"end":720},
            {"kind":"WORK","start":720,"end":960}
        ]}]);
        data["input"]["assignments"]=json!([{"employeeId":"person-0","date":"2026-11-04","kind":"WORK","shiftId":"pause","locked":true}]);
        data["input"]["demands"]=json!([
            {"id":"pause","date":"2026-11-04","sector":"S","start":540,"end":555,"minimum":1,"estimated":false},
            {"id":"service","date":"2026-11-04","sector":"S","start":555,"end":600,"minimum":1,"estimated":false}
        ]);
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        let p=&mut plan.employees[0];
        assert_eq!(p.facts.clocks[0].paid,480);
        assert_eq!(p.facts.clocks[0].segments.iter().map(|(a,b)|b-a).sum::<i32>(),465);
        assert!(p.catalog.iter().all(|x|x.states[3]==3&&x.states[..7].iter().filter(|&&s|work(s)).count()==5));
        p.pattern=Some(0);
        assert_eq!(evaluate(&plan)[0],15);
        data["input"]["demands"].as_array_mut().unwrap().remove(0);
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        plan.employees[0].pattern=Some(0);
        assert_eq!(evaluate(&plan)[0],0);
        data["input"]["shifts"][0]["segments"][4]["end"]=json!(1500);
        assert!(matches!(read(&data,Instant::now()+Duration::from_secs(5)),Err("CLOCK_GEOMETRY")));
    }

    #[test]
    fn private_comparison_caps_bind_every_civil_band_and_default_to_zero(){
        let mut data=fixture();
        data["input"]["employees"][0]["history"]=json!([]);
        data["input"]["demands"]=json!([{"id":"estimate","date":"2026-11-04","sector":"S","role":"Repositor","start":480,"end":540,"minimum":1,"estimated":true}]);
        data["input"]["_coverageComparison"]=json!({"sectors":[{"sector":"S","horizon":60,"month":60,"sundays":0,"monthSundays":0,"closing":0,"peak":1}],"bands":[]});
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        let p=&mut plan.employees[0];let good=p.catalog.iter().position(|p|work(p.states[3])).unwrap();
        let bad=p.catalog.iter().position(|p|p.states[3]==OFF).unwrap();
        p.pattern=Some(good);assert_eq!(evaluate(&plan)[0],0);
        plan.employees[0].pattern=Some(bad);assert!(evaluate(&plan)[0]>0);
        // General and role scopes each require explicit permission.
        data["input"]["_coverageComparison"]["bands"]=V::Array([None,Some("Repositor")].into_iter().flat_map(|role|
            ["HORIZON","MONTH"].into_iter().map(move |scope|json!({"scope":scope,"sector":"S","role":role,"start":480,"end":540,"maximum":1,"peak":1}))
        ).collect());
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        plan.employees[0].pattern=Some(bad);
        assert_eq!(evaluate(&plan)[0],0);
        let mut acc=TemporalAccumulator::default();let row=plan.employees[0].member();acc.accumulate(row.clone());
        assert_eq!(acc.finish(),sector_cost(std::iter::once(&row)));
        data["input"]["_coverageProtection"]=json!([{"date":"2026-11-04","sector":"S","role":"Repositor","start":480,"end":540,"minimum":1}]);
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        plan.employees[0].pattern=Some(bad);
        assert!(evaluate(&plan)[0]>0);
        data["input"]["_coverageComparison"]["advisoryEstimateDates"]=json!(["2026-11-01"]);
        assert!(matches!(read(&data,Instant::now()+Duration::from_secs(5)),Err("COMPARISON_FIELDS")));
    }

    #[test]
    fn private_initial_roster_is_a_legal_hint_not_a_lock(){
        let mut data=fixture();
        let plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        let p=&plan.employees[0];let pat=&p.catalog[1];
        data["input"]["_initialAssignments"]=V::Array(pat.states[..7].iter().enumerate().map(|(d,&s)|{
            let mut row=json!({"employeeId":"person-0","date":p.facts.dates[d],"kind":if s==OFF{"OFF"}else{"WORK"}});
            if let Some(c)=clock(&p.facts.clocks,s){row["shiftId"]=json!(c.id);}
            row
        }).collect());
        let hinted=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        assert_eq!(hinted.employees[0].pattern,Some(1));
        assert!(!hinted.employees[0].pinned&&hinted.employees[0].allowed.len()>1);
        assert!(hinted.employees[0].lock_flags.iter().all(Option::is_none));
        data["input"]["_initialAssignments"].as_array_mut().unwrap().pop();
        let incomplete=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        assert_eq!(incomplete.employees[0].pattern,None);
    }

    #[test]
    fn overnight_civil_service_and_rest_are_isolated_from_product_closing(){
        let mut data=fixture();
        data["input"]["defaultWeeklyHours"]=json!(40);data["input"]["mixed42Sectors"]=json!([]);
        data["input"]["storeClosingMinutes"]=json!(1440);
        data["input"]["employees"][0]["weeklyHours"]=json!(40);
        data["input"]["employees"][0]["history"]=json!([]);
        data["input"]["employees"][0]["shiftIds"]=json!(["day","night","late"]);
        let shift=|id:&str,start:i32|json!({"id":id,"segments":[
            {"kind":"WORK","start":start,"end":start+240},
            {"kind":"BREAK","start":start+240,"end":start+300},
            {"kind":"WORK","start":start+300,"end":start+540}]});
        data["input"]["shifts"]=json!([shift("day",420),shift("night",1140),shift("late",900)]);
        data["input"]["assignments"]=json!([{"employeeId":"person-0","date":"2026-11-04","kind":"WORK","shiftId":"night","locked":true}]);
        data["input"]["demands"]=json!([{"id":"spill","date":"2026-11-05","sector":"S","role":"Repositor","start":0,"end":240,"minimum":1,"estimated":false}]);
        assert!(matches!(read(&data,Instant::now()+Duration::from_secs(5)),Err("CLOCK_GEOMETRY")));
        let mut plan=read_mode(&data,Instant::now()+Duration::from_secs(5),true).unwrap();
        let p=&mut plan.employees[0];
        assert!(p.catalog.iter().all(|pat|pat.states[3]==4&&work(pat.states[4])&&pat.states[4]!=3&&pat.civil_work&(1<<4)!=0));
        p.pattern=Some(0);
        assert_eq!(evaluate(&plan)[0],0);
        let mut acc=TemporalAccumulator::default();acc.accumulate(plan.employees[0].member());
        assert_eq!(acc.finish(),sector_cost(std::iter::once(&plan.employees[0].member())));
        data["input"]["assignments"].as_array_mut().unwrap().push(json!({"employeeId":"person-0","date":"2026-11-05","kind":"OFF","locked":true}));
        assert!(matches!(read_mode(&data,Instant::now()+Duration::from_secs(5),true),Err("NO_PERSONAL_PATTERN")));
    }

    #[test]
    fn partial_employment_uses_only_active_days_and_exact_complete_weeks(){
        let mut data=fixture();
        data["input"]["endDate"]=json!("2026-11-21");
        data["input"]["employees"][0]["activeFrom"]=json!("2026-11-04");
        data["input"]["employees"][0]["activeUntil"]=json!("2026-11-17");
        data["input"]["employees"][0]["history"]=json!([]);
        let plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        for pat in plan.employees[0].catalog.iter(){
            assert!(pat.states[..3].iter().chain(&pat.states[17..21]).all(|&s|s==INACTIVE));
            assert!(pat.states[3..17].iter().all(|&s|s!=INACTIVE));
            assert_eq!(pat.states[7..14].iter().filter(|&&s|work(s)).count(),5);
            assert_eq!(pat.states[7..14].iter().filter(|&&s|s==4).count(),2);
        }
        data["input"]["assignments"]=json!([{"employeeId":"person-0","date":"2026-11-02","kind":"OFF","locked":true}]);
        assert!(matches!(read(&data,Instant::now()+Duration::from_secs(5)),Err("OUTSIDE_EMPLOYMENT")));
    }

    #[test]
    fn cached_tie_cost_matches_original_hash_for_every_path(){
        let plan=read(&fixture(),Instant::now()+Duration::from_secs(5)).unwrap();
        let p=&plan.employees[0];
        for (i,pattern) in p.catalog.iter().enumerate(){
            let expected:i64=pattern.states[..p.facts.days].iter().enumerate()
                .filter(|(_,s)|**s==OFF).map(|(d,_)|tie_rank::rank(&p.name_id,&p.facts.dates[d])).sum();
            assert_eq!(p.pattern_cost(i)[16],expected);
        }
    }

    #[test]
    fn temporal_reversible_coverage_matches_full_oracle_at_scale(){
        for people in [115,250]{
            let mut data=fixture();
            data["input"]["endDate"]=json!("2026-12-12");
            let template=data["input"]["employees"][0].clone();
            data["input"]["employees"]=V::Array((0..people).map(|i|{
                let mut p=template.clone();
                p["id"]=json!(format!("person-{i}"));p["name"]=json!(format!("Synthetic person {i}"));
                p["history"]=json!([{"date":"2026-10-25","kind":"WORK","shiftId":"eight"}]);
                if i%3==0{p["role"]=json!("Caixa");}
                p
            }).collect());
            data["input"]["movementPriorities"]=json!([{"startDate":"2026-11-04","endDate":"2026-11-04","level":"HIGH"}]);
            data["input"]["demands"]=json!([
                {"id":"sun-a","date":"2026-11-01","sector":"S","start":480,"end":540,"minimum":30,"estimated":true},
                {"id":"sun-b","date":"2026-11-08","sector":"S","start":480,"end":540,"minimum":40,"role":"Caixa","estimated":true},
                {"id":"hard","date":"2026-11-04","sector":"S","start":1050,"end":1140,"minimum":20,"role":"Repositor","estimated":false},
                {"id":"close","date":"2026-12-06","sector":"S","start":1140,"end":1200,"minimum":10,"estimated":true}
            ]);
            data["input"]["_coverageServiceProtection"]=json!({
                "days":[{"sector":"S","date":"2026-11-04"}],
                "bands":[{"sector":"S","role":"Repositor","start":1050,"end":1140,"scope":"HORIZON","minimum":2}]
            });
            let mut plan=read(&data,Instant::now()+Duration::from_secs(10)).unwrap();
            let mut acc=TemporalAccumulator::default();
            let mut rows=BTreeMap::new();
            for p in &mut plan.employees{
                p.pattern=Some(p.id%p.catalog.len());
                let row=p.member();acc.accumulate(row.clone());rows.insert(p.id,row);
                if p.id.is_multiple_of(16){assert_eq!(acc.finish(),sector_cost(rows.values()));}
            }
            assert_eq!(acc.finish(),sector_cost(rows.values()));
            for id in [0,63,64,people-1]{
                acc.retract(id);rows.remove(&id);
                assert_eq!(acc.finish(),sector_cost(rows.values()));
                let p=&mut plan.employees[id];
                p.pattern=Some((id+17)%p.catalog.len());
                let row=p.member();acc.accumulate(row.clone());rows.insert(id,row);
                assert_eq!(acc.finish(),sector_cost(rows.values()));
                acc.retract(id);rows.remove(&id);
                p.pattern=None;
                let row=p.member();acc.accumulate(row.clone());rows.insert(id,row);
                assert_eq!(acc.finish(),sector_cost(rows.values()));
            }
            for id in 0..people{acc.retract(id);}
            assert_eq!(acc.finish(),[0;17]);
            acc.accumulate(plan.employees[1].member());acc.reset();
            assert_eq!(acc.finish(),[0;17]);
        }
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

    #[test]
    fn service_keeps_original_identifiers_and_does_not_require_synthetic_names(){
        let mut data=fixture();data["input"]["branchCode"]=json!("branch-02");
        data["input"]["simulation"]=json!(false);
        // Identity success requires a legally authorized non-simulation 42h profile.
        data["input"]["policy"]["compensationAuthorized"]=json!(true);
        data["input"]["employees"][0]["id"]=json!("employee:abc-ç");
        data["input"]["employees"][0]["name"]=json!("Contract test employee");
        data["input"]["employees"][0]["history"][0]["employeeId"]=json!("employee:abc-ç");
        let original=data.clone();let bytes=serde_json::to_vec(&data).unwrap();
        let result=solve_service(&bytes,Instant::now(),Duration::from_secs(4));
        assert_eq!(result["httpStatus"],200,"{result}");
        assert_eq!(result["body"]["status"],"FEASIBLE","{result}");
        let rows=result["body"]["assignments"].as_array().unwrap();assert_eq!(rows.len(),7);
        assert!(rows.iter().all(|row|row["employeeId"]=="employee:abc-ç"));
        assert_eq!(data,original);assert!(read(&data,Instant::now()+Duration::from_secs(1)).is_err());
    }
    #[test]
    fn service_rejects_unsupported_policy_and_duplicate_identity_without_rewriting(){
        let mut data=fixture();data["input"]["policy"]["normativeProfile"]=json!("UNMODELED_POLICY");
        let rejected=solve_service(&serde_json::to_vec(&data).unwrap(),Instant::now(),Duration::from_secs(3));
        assert_eq!(rejected["httpStatus"],400);assert!(rejected["body"].get("assignments").is_none());
        let mut data=fixture();let duplicate=data["input"]["employees"][0].clone();
        data["input"]["employees"].as_array_mut().unwrap().push(duplicate);
        let rejected=solve_service(&serde_json::to_vec(&data).unwrap(),Instant::now(),Duration::from_secs(3));
        assert_eq!(rejected["httpStatus"],400);
    }
}

#[cfg(test)]
mod service_contract_tests;
