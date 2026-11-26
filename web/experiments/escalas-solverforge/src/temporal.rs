//! SF54b: isolated one-week temporal prototype; not a production adapter.
//! OFF, ABSENCE and HOLIDAY are separate states; work is a concrete clock.
//! Only admitted, synthetic, same-civil-day shifts before the transition date.
use std::collections::{BTreeMap,BTreeSet};
use std::sync::Arc;
use std::time::{Duration,Instant};
use serde_json::{json,Value as V};
use solverforge::{MoveThreadCount,SolverConfig};
use solverforge::stream::collector::Accumulator;
use crate::model::PersonalRules;
use crate::temporal_domain::{TemporalEmployee,TemporalPlan};
use crate::temporal_score::TemporalScore;
use crate::wire::{array,boolean,check,civil_date,empty,empty_array,identifier,number,optional_text,personal_rules,range,text};

type Result<T>=std::result::Result<T,&'static str>;
pub type Cost=[i64;17];
const OFF:u8=0;
const ABS:u8=1;
const HOL:u8=2;
const MAX_PATTERNS:usize=30_000;
const OBJECTIVES:[(&str,&str);16]=[
    ("COVERAGE","SCOPED"),("SUNDAY_COVERAGE","SCOPED"),("SUNDAY_PEAK","NOT_APPLICABLE_ONE_WEEK"),
    ("MOVEMENT_COVERAGE","SCOPED"),("CLOSING_COVERAGE","SCOPED"),
    ("UNTIMED_ROTATION","NOT_APPLICABLE_TIMED_ONLY"),("SUNDAY_BALANCE","PARTIAL_COHORT"),
    ("REST_SPACING","PARTIAL_PAIR_SCORE"),("LEADERSHIP","PARTIAL_LOCAL_RESPONSIBILITY"),
    ("SATURDAY_BALANCE","PARTIAL_COHORT"),("REST_DISTRIBUTION","PARTIAL_SECTOR_ROLE"),
    ("REST_ROTATION","SCOPED"),("PEOPLE_CHANGED","SCOPED"),("STABILITY","SCOPED"),
    ("PREFERENCES","SCOPED"),("TIE_BREAK","PENDING"),
];
#[derive(Clone,Debug)]
struct Clock {id:String,segments:[(i32,i32);2],paid:i32}
impl Clock {
    fn start(&self)->i32{self.segments[0].0}
    fn end(&self)->i32{self.segments[1].1}
    fn covers(&self,a:i32,b:i32)->bool{self.segments.iter().any(|&(s,e)|s<=a&&b<=e)}
}
fn clock(clocks:&[Clock],state:u8)->Option<&Clock>{state.checked_sub(3).and_then(|i|clocks.get(i as usize))}
fn work(state:u8)->bool{state>=3}
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub struct Pattern{states:[u8;7],personal:Cost,rates:[Option<i64>;2]}
#[derive(Clone,Copy)]
struct Record{state:u8,locked:Option<bool>,manual_absence:bool}
#[derive(Clone,Debug)]
struct Band{day:usize,start:i32,end:i32,estimated:bool,general:i64,roles:Vec<(usize,i64)>}
#[derive(Debug)]
pub struct TemporalFacts{clocks:Arc<Vec<Clock>>,bands:Vec<Band>,closed:[bool;7],closing:i32,priority:[Option<i64>;7],movement_enabled:bool}
#[derive(Clone)]
pub struct Member{
    pub id:usize,pub role:usize,pub cohort:usize,pub leader:bool,pub facts:Arc<TemporalFacts>,pub pattern:Option<Pattern>,
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
    for row in &rows{
        if let Some(p)=row.pattern{add(&mut result,p.personal);}
    }
    for band in &facts.bands{
        let mut present=0i64;let mut role_counts=BTreeMap::<usize,i64>::new();
        for row in &rows{
            if row.pattern.and_then(|p|clock(&facts.clocks,p.states[band.day]))
                .is_some_and(|c|c.covers(band.start,band.end)){
                present+=1;*role_counts.entry(row.role).or_default()+=1;
            }
        }
        let role_gap:i64=band.roles.iter().map(|(r,n)|(*n-role_counts.get(r).copied().unwrap_or(0)).max(0)).sum();
        let gap=(band.general-present).max(0).max(role_gap);
        if band.estimated{
            let cost=gap*i64::from(band.end-band.start);
            result[1]+=cost;
            if band.day==0{result[2]+=cost;}
            if facts.movement_enabled{result[4]+=cost*facts.priority[band.day].unwrap_or(2);}
            let close=(band.end.min(facts.closing)-band.start.max(facts.closing-60)).max(0);
            result[5]+=gap*i64::from(close);
        }else{result[0]+=gap*i64::from(band.end-band.start);}
    }
    for (day,weight) in facts.priority.iter().enumerate(){
        if !facts.closed[day]&&weight.is_some()&&!rows.iter().any(|r|r.leader&&r.pattern.is_some_and(|p|work(p.states[day]))){
            result[9]+=weight.unwrap_or(0);
        }
    }
    let mut cohorts=BTreeMap::<(usize,usize),(i64,i64)>::new();
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
    // Unique sector + role groups; don't double-count a sector with one role.
    let mut groups=BTreeMap::<usize,Vec<&Member>>::new();
    for row in &rows{groups.entry(row.role).or_default().push(row);}
    let mut all_groups=vec![rows.clone()];
    if groups.len()>1{all_groups.extend(groups.into_values());}
    for group in all_groups{
        for day in 0..7{
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
fn expected(cost:Cost)->TemporalScore{TemporalScore::of([-cost[0]],std::array::from_fn(|i|-cost[i+1]))}
fn relative(date:&str)->Result<i32>{
    check(civil_date(date),"DATE")?;
    let n=date[8..].parse::<i32>().map_err(|_|"DATE")?;
    match &date[..7]{"2026-10"=>Ok(n-32),"2026-11"=>Ok(n-1),"2026-12"=>Ok(n+29),_=>Err("TEMPORAL_DATE")}
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
    let state=match kind{"OFF"=>OFF,"ABSENCE"=>ABS,"HOLIDAY"=>HOL,
        "WORK"=>*ids.get(text(row,"shiftId")?).ok_or("CLOCK_REFERENCE")?,_=>return Err("ASSIGNMENT_KIND")};
    check(work(state)||row.get("shiftId").is_none(),"ASSIGNMENT_CLOCK")?;
    let locked=row.get("locked").map(|v|v.as_bool().ok_or("LOCK_TYPE")).transpose()?;
    let manual_absence=match row.get("absenceSource"){None=>false,Some(v)=>{
        check(state==ABS&&v.as_str()==Some("MANUAL"),"ABSENCE_SOURCE")?;true
    }};
    Ok(Record{state,locked,manual_absence})
}
struct Rules{
    personal:PersonalRules, fixed:u8, cap:i32, target:i32, weekly_limit:i32, inter:i32, weekly_rest:i32,
    mixed:bool, closed:[bool;7], holiday:[bool;7], old:[Option<Record>;7],
    context:BTreeMap<i32,u8>,
}
impl Rules{
    fn legal(&self,states:[u8;7],clocks:&[Clock])->bool{
        let count=states.iter().filter(|&&s|work(s)).count() as i32;
        let off=states.iter().filter(|&&s|s==OFF).count() as i32;
        let absent=states.contains(&ABS);
        let weekdays=states[1..].iter().filter(|&&s|s==HOL).count() as i32;
        let sunday=i32::from(states[0]==HOL);
        let minutes:i32=states.iter().filter_map(|&s|clock(clocks,s)).map(|c|c.paid).sum();
        if count>5||minutes>self.target.min(self.weekly_limit){return false;}
        if !absent&&(count!=(5-weekdays).max(0)||off!=2-sunday||weekdays==0&&minutes!=self.target){return false;}
        if self.mixed&&states.iter().filter_map(|&s|clock(clocks,s)).filter(|c|c.paid==540).count()>2{return false;}
        let state=|d:i32|if (0..7).contains(&d){Some(states[d as usize])}else{self.context.get(&d).copied()};
        let max=i32::from(self.personal.max_run);
        for start in -max..7{
            if (start..=start+max).all(|d|state(d).is_some_and(work)){return false;}
        }
        for start in -self.cap..=0{
            if (start..=start+self.cap).all(|w|state(w*7).is_some_and(work)){return false;}
        }
        if self.personal.variable{
            for start in -2..7{
                let mutable=(start..start+3).any(|d|(0..7).contains(&d)&&!self.closed[d as usize]
                    &&self.old[d as usize].is_none_or(|r|r.locked!=Some(true)&&r.state!=ABS&&r.state!=HOL));
                if mutable&&(start..start+3).all(|d|state(d)==Some(OFF)){return false;}
            }
        }
        if self.personal.consecutive{
            let rest=|d:i32|state(d)==Some(OFF)||d.rem_euclid(7)==0&&state(d)==Some(HOL);
            for d in 0..7{
                if rest(d)&&!rest(d-1)&&!rest(d+1){return false;}
            }
            if state(7)==Some(OFF)&&state(8).is_some_and(|s|work(s)||s==ABS)&&state(6)!=Some(OFF){return false;}
        }
        for a in -5..7{
            let Some(ca)=state(a).and_then(|s|clock(clocks,s)) else{continue;};
            for b in a+1..=a+5{
                if b<0{continue;}
                let Some(cb)=state(b).and_then(|s|clock(clocks,s)) else{continue;};
                let gap=(b-a)*1440+cb.start()-ca.end();
                if gap<self.inter{return false;}
                if (a+1..b).any(|d|matches!(state(d),Some(OFF|HOL)))&&gap<self.weekly_rest{return false;}
            }
        }
        true
    }
    fn pattern(&self,states:[u8;7])->Pattern{
        let mut cost=[0;17];
        let changes=states.iter().enumerate().filter(|(d,s)|self.old[*d].is_some_and(|r|r.state!=ABS&&r.state!=**s)).count() as i64;
        cost[13]=i64::from(changes>0);cost[14]=changes;
        cost[15]=states.iter().enumerate().filter(|(d,s)|work(**s)&&self.personal.preferred&(1<<d)!=0).count() as i64;
        if self.personal.prefer_consecutive{cost[15]+=6-states.windows(2).filter(|w|w==&[OFF,OFF]).count() as i64;}
        if self.personal.adjustable(){
            let mut pairs=0;let mut imposed=0;
            for (d,&current) in states.iter().enumerate(){
                let prev=if d==0{self.context.get(&-1).copied()}else{Some(states[d-1])};
                if prev==Some(OFF)&&current==OFF{
                    let mutable=|i:usize|self.old[i].is_none_or(|r|r.locked!=Some(true))&&!self.closed[i];
                    if mutable(d)||d>0&&mutable(d-1){pairs+=1;}else{imposed+=1;}
                }
            }
            cost[8]=pairs+1000*((pairs+imposed-2i64).max(0)-(imposed-2i64).max(0));
        }
        let mut rates=[None;2];
        for (day,&state) in states.iter().enumerate(){
            let prior:Vec<_>=self.context.iter().filter(|(d,s)|**d<0&&d.rem_euclid(7)==day as i32&&(work(**s)||**s==OFF)).map(|(_,s)|*s).collect();
            let opportunities=prior.len() as i64+i64::from(state!=ABS);
            let rests=prior.iter().filter(|&&s|s==OFF).count() as i64+i64::from(state==OFF);
            cost[12]+=(7*rests-2*opportunities).abs();
            if (day==0||day==6)&&!self.closed[day]&&!self.holiday[day]
                &&state!=ABS&&self.fixed&(1<<day)==0&&!self.old[day].is_some_and(|r|r.locked==Some(true)&&r.state==OFF){
                let worked=prior.iter().filter(|&&s|work(s)).count() as i64+i64::from(work(state));
                rates[usize::from(day==6)]=Some(worked*10_000/(prior.len() as i64+1));
            }
        }
        Pattern{states,personal:cost,rates}
    }
}
fn enumerate(options:&[Vec<u8>;7],rules:&Rules,clocks:&[Clock],deadline:Instant)->Result<Vec<Pattern>>{
    fn visit(day:usize,states:&mut [u8;7],options:&[Vec<u8>;7],rules:&Rules,clocks:&[Clock],
             deadline:Instant,out:&mut Vec<Pattern>)->Result<()>{
        check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
        if day==7{
            if rules.legal(*states,clocks){
                check(out.len()<MAX_PATTERNS,"TEMPORAL_DOMAIN_LIMIT")?;
                out.push(rules.pattern(*states));
            }
        }else{
            for &state in &options[day]{
                states[day]=state;visit(day+1,states,options,rules,clocks,deadline,out)?;
            }
        }
        Ok(())
    }
    let mut out=Vec::new();visit(0,&mut [OFF;7],options,rules,clocks,deadline,&mut out)?;Ok(out)
}
fn read(root:&V,deadline:Instant)->Result<TemporalPlan>{
    check(root.as_object().is_some_and(|o|o.len()==1)&&root["input"].is_object(),"ENVELOPE")?;
    let input=&root["input"];let policy=&input["policy"];
    check(number(input,"schemaVersion")?==1&&text(input,"branchCode")?=="SYNTH"&&boolean(input,"simulation",false)?
        &&text(input,"timeZone")?=="America/Sao_Paulo"&&text(input,"planningWeekStartsOn")?=="SUNDAY"
        &&number(input,"restRulesVersion")?==3&&text(input,"startDate")?=="2026-11-01"
        &&text(input,"endDate")?=="2026-11-07"&&input.get("visibleMonth").is_none(),"TEMPORAL_HORIZON")?;
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
    let closed_days=std::array::from_fn(|d|closed.contains(&(d as i32)));
    let holiday_days=std::array::from_fn(|d|holidays.contains(&(d as i32)));
    let mut mixed_sectors=BTreeSet::new();
    if input.get("mixed42Sectors").is_some(){
        for s in array(input,"mixed42Sectors")?{check(default_hours==42&&mixed_sectors.insert(s.as_str().ok_or("MIXED_SECTOR")?),"MIXED_SECTOR")?;}
    }
    let clock_rows=array(input,"shifts")?;
    check(!clock_rows.is_empty()&&clock_rows.len()<=12,"CLOCK_LIMIT")?;
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
    check(!people.is_empty()&&people.len()<=12,"TEMPORAL_PEOPLE_LIMIT")?;
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
        check((0..7).contains(&day)&&a>=0&&a<b&&b<=1440&&range(n,0,250),"DEMAND")?;
        let sector=*sectors.get(text(d,"sector")?).ok_or("DEMAND_SECTOR")?;
        let role=match d.get("role"){None=>None,Some(v) if v.is_null()=>None,Some(v)=>{
            let r=v.as_str().ok_or("ROLE")?;
            let next=roles.len();Some(*roles.entry(r.to_string()).or_insert(next))
        }};
        let estimated=boolean(d,"estimated",false)?;
        demand_groups.entry((sector,day as usize,estimated)).or_default().push((a,b,i64::from(n),role));
    }
    let mut priorities=Vec::new();
    if input.get("movementPriorities").is_some(){
        for entry in array(input,"movementPriorities")?{
            let a=relative(text(entry,"startDate")?)?;let b=relative(text(entry,"endDate")?)?;
            check((0..7).contains(&a)&&(a..7).contains(&b),"MOVEMENT_DATES")?;
            let weight=match text(entry,"level")?{"LOW"=>1,"NORMAL"=>2,"HIGH"=>3,_=>return Err("MOVEMENT_LEVEL")};
            let name=optional_text(entry,"sector","")?;
            let sector=if name.is_empty(){None}else{Some(*sectors.get(name).ok_or("MOVEMENT_SECTOR")?)};
            priorities.push((a,b,weight,sector));
        }
    }
    let mut facts:Vec<_>=(0..sectors.len()).map(|sector|TemporalFacts{
        clocks:Arc::clone(&clocks),bands:Vec::new(),closed:closed_days,closing,movement_enabled:!priorities.is_empty(),
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
            if general>0{check(facts[sector].bands.len()<12000,"BAND_LIMIT")?;facts[sector].bands.push(Band{day,start:a,end:b,estimated,general,roles:floors.into_iter().collect()});}
        }
    }
    let facts:Vec<_>=facts.into_iter().map(Arc::new).collect();
    let mut employees=Vec::new();let mut seen=BTreeSet::new();
    type CohortKey=(usize,usize,Vec<u8>,i32,i32);
    let mut cohorts=BTreeMap::<CohortKey,usize>::new();
    let assignment_rows=array(input,"assignments")?;
    for p in people{
        check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
        let pid=identifier(p,"id")?;
        check(pid.strip_prefix("person-").is_some_and(|s|!s.is_empty()&&s.bytes().all(|b|b.is_ascii_digit()))
            &&text(p,"name")?.starts_with("Synthetic person ")&&seen.insert(pid),"SYNTHETIC_ID")?;
        let active=text(p,"activeFrom")?;
        check((active.is_empty()||civil_date(active)&&active<="2026-11-01")&&p.get("activeUntil").is_none()
            &&boolean(p,"planningEnabled",true)?&&text(p,"scheduleMode")?=="TIMED"&&p.get("simulationDailyMinutes").is_none(),"PERSON_PROFILE")?;
        for k in ["manualShiftOverrides","manualShiftBaseIds"]{check(empty_array(p,k),"MANUAL_PROVENANCE_UNSUPPORTED")?;}
        check(empty(p,"manualShiftByDate"),"DATED_OVERRIDE_PENDING")?;
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
        let mixed=mixed_sectors.contains(sector_name)&&hours==42;
        let (fixed,personal)=personal_rules(p,max_run.min(5) as u8)?;
        let cap=number(p,"maxConsecutiveSundays")?;let rule=optional_text(p,"sundayRestRule","PROTECTIVE")?;
        check(matches!(cap,1|2)&&["PROTECTIVE","UNREVIEWED","CLT_386","COMMERCE"].contains(&rule),"SUNDAY_RULE")?;
        let cap=if rule=="COMMERCE"{cap}else{1};
        let mut options=Vec::new();let mut unique=BTreeSet::new();
        for v in array(p,"shiftIds")?{
            let id=v.as_str().ok_or("CLOCK_REFERENCE")?;let s=*ids.get(id).ok_or("CLOCK_REFERENCE")?;
            check(unique.insert(s),"DUPLICATE_CLOCK")?;options.push(s);
        }
        check(!options.is_empty()&&options.len()<=4,"TEMPORAL_CLOCK_OPTIONS")?;
        let imported=optional_text(p,"fixedImportedShiftId","")?;
        if !imported.is_empty(){
            let s=*ids.get(imported).ok_or("CLOCK_REFERENCE")?;check(unique.contains(&s),"CLOCK_REFERENCE")?;options=vec![s];
        }else if mode=="REST_ONLY"{
            let mut durations=BTreeSet::new();options.retain(|&s|durations.insert(clock(&clocks,s).unwrap().paid));
        }
        let allowed_clock=|s:u8|clock(&clocks,s).is_some_and(|c|if mixed{matches!(c.paid,480|540)}else{c.paid!=540&&c.paid<=daily});
        let mut old=[None;7];
        for row in assignment_rows{
            if text(row,"employeeId")?!=pid{continue;}
            let d=relative(text(row,"date")?)?;check((0..7).contains(&d),"DATE")?;
            check(old[d as usize].replace(code(row,&ids,pid)?).is_none(),"DUPLICATE_ASSIGNMENT")?;
        }
        if mode=="HOURS_ONLY"{check(old.iter().all(Option::is_some),"HOURS_ONLY_GRID")?;}
        let mut context=BTreeMap::new();
        for key in ["planningHistory","history","planningFuture"]{
            if p.get(key).is_none(){continue;}
            let mut local=BTreeSet::new();
            for row in array(p,key)?{
                let d=relative(text(row,"date")?)?;
                check(if key=="planningFuture"{(7..28).contains(&d)}else{(-21..0).contains(&d)},"CONTEXT_DATE")?;
                check(local.insert(d),"DUPLICATE_CONTEXT")?;
                context.insert(d,code(row,&ids,pid)?.state);
            }
        }
        let mut daily_options:[Vec<u8>;7]=std::array::from_fn(|_|Vec::new());
        for (day,out) in daily_options.iter_mut().enumerate(){
            let saved=old[day];let date=day as i32;let absence=saved.is_some_and(|r|r.state==ABS);
            let holiday=paid.contains(&date)||saved.is_some_and(|r|r.state==HOL);
            if absence{out.push(ABS);}else if holiday{
                check(paid.contains(&date),"HOLIDAY_POLICY")?;
                check(saved.is_none_or(|r|r.locked!=Some(true)||r.state==HOL),"LOCKED_HOLIDAY")?;
                out.push(HOL);
            }else{
                let force_off=fixed&(1<<day)!=0;
                let off_allowed=day!=6&&(!holidays.contains(&date)||day==0||boolean(policy,"holidayRestAllowed",false)?);
                if off_allowed{out.push(OFF);}
                if !force_off&&!closed.contains(&date){
                    out.extend(options.iter().copied().filter(|&s|allowed_clock(s)));
                    if let Some(r)=saved{
                        if r.locked==Some(true)&&allowed_clock(r.state)&&!out.contains(&r.state){out.push(r.state);}
                    }
                }
                if force_off{out.retain(|&s|s==OFF);}
            }
            if let Some(r)=saved{
                if r.locked==Some(true){out.retain(|&s|s==r.state);}
                if mode=="HOURS_ONLY"{out.retain(|&s|if work(r.state){work(s)}else{s==r.state});}
            }
        }
        let rules=Rules{personal,fixed,cap,target:hours*60,weekly_limit:weekly*60,inter,weekly_rest,mixed,
            closed:closed_days,holiday:holiday_days,old,context};
        let catalog=Arc::new(enumerate(&daily_options,&rules,&clocks,deadline)?);
        check(!catalog.is_empty(),"NO_PERSONAL_PATTERN")?;
        let allowed:Arc<[usize]>=Arc::from((0..catalog.len()).collect::<Vec<_>>());
        let pinned=allowed.len()==1;
        let next=cohorts.len();let cohort=*cohorts.entry((sector,role,options,hours,cap)).or_insert(next);
        employees.push(TemporalEmployee{id:employees.len(),name_id:pid.to_string(),sector,role,cohort,facts:Arc::clone(&facts[sector]),
            catalog,allowed,pinned,leader,lock_flags:std::array::from_fn(|d|old[d].and_then(|r|r.locked)),
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
    // Complete a legal personal seed without claiming mandatory coverage.
    for person in &mut plan.employees{
        if person.pattern.is_none(){person.pattern=Some(person.catalog.iter().enumerate().min_by_key(|(_,p)|p.personal).unwrap().0);}
    }
    let initial=evaluate(&plan);
    // Preserve observed high-priority local leadership, independent of
    // the ordinal position of LEADERSHIP in the soft score.
    let critical=|plan:&TemporalPlan|->BTreeSet<(usize,usize)>{
        let mut out=BTreeSet::new();
        for p in &plan.employees{
            if !p.leader{continue;}
            if let Some(i)=p.pattern{
                for (day,&s) in p.catalog[i].states.iter().enumerate(){
                    if work(s)&&p.facts.priority[day]==Some(3)&&!p.facts.closed[day]{out.insert((p.sector,day));}
                }
            }
        }
        out
    };
    let protected=critical(&plan);
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
        if cost>initial||!protected.is_subset(&critical(&plan)){for (p,s) in plan.employees.iter_mut().zip(saved){p.pattern=s;}}
    }
    let cost=evaluate(&plan);
    if cost[0]!=0||start.elapsed()>budget||!plan.employees.iter().all(|p|p.pattern.is_some_and(|i|p.allowed.binary_search(&i).is_ok())){
        return unknown(start);
    }
    let mut assignments=Vec::new();
    for person in &plan.employees{
        let p=person.catalog[person.pattern.unwrap()];
        for (day,&s) in p.states.iter().enumerate(){
            let mut row=json!({"employeeId":person.name_id,"date":crate::wire::date(day),
                "kind":match s{OFF=>"OFF",ABS=>"ABSENCE",HOL=>"HOLIDAY",_=>"WORK"}});
            if let Some(c)=clock(&person.facts.clocks,s){row["shiftId"]=json!(c.id);}
            if let Some(lock)=person.lock_flags[day]{row["locked"]=json!(lock);}
            if s==ABS&&person.manual_absences[day]{row["absenceSource"]=json!("MANUAL");}
            assignments.push(row);
        }
    }
    let priorities=plan.employees.iter().any(|p|p.facts.movement_enabled);
    let objective_audit:Vec<_>=OBJECTIVES.iter().enumerate().map(|(i,(name,status))|{
        let status=if !priorities&&(*name=="MOVEMENT_COVERAGE"||*name=="LEADERSHIP"){"NOT_APPLICABLE_NO_PRIORITIES"}else{*status};
        json!({"name":name,"status":status,"cost":if status.starts_with("SCOPED")||status.starts_with("PARTIAL"){Some(cost[i+1])}else{None}})
    }).collect();
    json!({"httpStatus":200,"body":{"status":"FEASIBLE","message":"Synthetic one-week temporal candidate; independent validation required",
        "assignments":assignments,"wallTimeSeconds":start.elapsed().as_secs_f64()},"maxRssKiB":null,
        "temporal":{"version":1,"scope":"SYNTHETIC_ONE_WEEK_TIMED","partialModel":true,"mapSeconds":mapped,
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
