//! SF68: bounded private estimated-deficit limits. Independent of a foreign
//! engine roster. All supplied caps and the implicit zero outside them
//! are hard constraints; a timeout is never proof of infeasibility.
use std::collections::{BTreeMap,BTreeSet};
use std::time::Instant;
use serde_json::Value as V;
use crate::model::Presence;
use super::{Calendar,TemporalFacts,Result,array,check,civil_presence,number,range,text};

const MAX_PEAK:i64=12_000*250;
const MAX_MINUTES:i64=MAX_PEAK*42*1440;
const MAX_TERMS:usize=300_000;
const MAX_CHECKS:usize=120_000;
#[derive(Clone,Debug,PartialEq,Eq,Hash)]
struct Term{band:usize,role:Option<usize>}
#[derive(Clone,Debug,PartialEq,Eq,Hash)]
struct Limit{terms:Vec<Term>,maximum:i64,peak:i64}
#[derive(Clone,Debug,PartialEq,Eq,Hash)]
pub(super) struct Bounds{totals:[i64;6],limits:Vec<Limit>,advisory:u64}
impl Bounds{
    pub(super) fn advisory(&self,day:usize)->bool{self.advisory&(1u64<<day)!=0}
}
fn exact(row:&V,fields:&[&str])->bool{
    row.as_object().is_some_and(|m|m.len()==fields.len()&&fields.iter().all(|k|m.contains_key(*k)))
}
fn integer(row:&V,key:&str,max:i64)->Result<i64>{
    row.get(key).and_then(V::as_i64).filter(|&n|(0..=max).contains(&n)).ok_or("COMPARISON_INTEGER")
}
fn scope(name:&str)->Result<usize>{
    match name{"HORIZON"=>Ok(0),"MONTH"=>Ok(1),"SUNDAYS"=>Ok(2),"MONTH_SUNDAYS"=>Ok(3),_=>Err("COMPARISON_SCOPE")}
}
fn in_scope(f:&TemporalFacts,day:usize,scope:usize)->bool{
    (scope&1==0||f.visible[day])&&(scope&2==0||f.weekday(day)==0)
}
type Key=(usize,Option<usize>);
type Caps=BTreeMap<Key,Vec<(i32,i32,i64,i64)>>;
type Terms=BTreeMap<Key,Vec<(i32,i32,Term)>>;
pub(super) fn read(input:&V,calendar:&Calendar,sectors:&BTreeMap<String,usize>,roles:&BTreeMap<String,usize>,
                   facts:&mut [TemporalFacts],deadline:Instant)->Result<()>{
    let Some(raw)=input.get("_coverageComparison")else{return Ok(());};
    let has_daily=raw.get("dailyBands").is_some();
    let has_advisory=raw.get("advisoryEstimateDates").is_some();
    let mut fields=vec!["sectors","bands"];
    if has_daily{fields.push("dailyBands");}
    if has_advisory{fields.push("advisoryEstimateDates");}
    check(exact(raw,&fields)&&(!has_daily&&!has_advisory||calendar.cutover),"COMPARISON_FIELDS")?;
    let mut advisory=0u64;
    if has_advisory{
        let days=array(raw,"advisoryEstimateDates")?;
        check(days.len()==5,"COMPARISON_ADVISORY")?;
        for d in days{
            let d=calendar.relative(d.as_str().ok_or("COMPARISON_ADVISORY")?)?;
            check((0..5).contains(&d)&&advisory&(1u64<<d)==0,"COMPARISON_ADVISORY")?;
            advisory|=1u64<<d;
        }
        check(advisory==31,"COMPARISON_ADVISORY")?;
    }
    let mut known=BTreeSet::new();
    for p in array(input,"employees")?{
        known.insert((text(p,"sector")?,text(p,"role")?));
    }
    for d in array(input,"demands")?{
        if let Some(role)=d.get("role").and_then(V::as_str){known.insert((text(d,"sector")?,role));}
    }
    let mut totals=vec![[0i64;6];facts.len()];
    let mut seen=BTreeSet::new();
    let keys=["horizon","month","sundays","monthSundays","closing","peak"];
    for row in array(raw,"sectors")?{
        check(exact(row,&["sector","horizon","month","sundays","monthSundays","closing","peak"]),"COMPARISON_SECTOR_FIELDS")?;
        let sector=*sectors.get(text(row,"sector")?).ok_or("COMPARISON_SECTOR")?;
        check(seen.insert(sector),"COMPARISON_DUPLICATE_SECTOR")?;
        for (i,key) in keys.into_iter().enumerate(){
            totals[sector][i]=integer(row,key,if i==5{MAX_PEAK}else{MAX_MINUTES})?;
        }
    }
    let mut caps:Vec<Caps>=(0..facts.len()).map(|_|Caps::new()).collect();
    for daily in [false,true]{
        if daily&&!has_daily{continue;}
        for row in array(raw,if daily{"dailyBands"}else{"bands"})?{
            check(exact(row,if daily{&["date","sector","role","start","end","maximum"]}else{
                &["scope","sector","role","start","end","maximum","peak"]}),"COMPARISON_BAND_FIELDS")?;
            let sector_name=text(row,"sector")?;
            let sector=*sectors.get(sector_name).ok_or("COMPARISON_SECTOR")?;
            let role=if row["role"].is_null(){None}else{
                let name=text(row,"role")?;
                check(known.contains(&(sector_name,name)),"COMPARISON_ROLE")?;
                Some(*roles.get(name).ok_or("COMPARISON_ROLE")?)
            };
            let scope=if daily{
                let day=calendar.relative(text(row,"date")?)?;
                check((0..calendar.labels.len() as i32).contains(&day)&&advisory&(1u64<<day)==0,"COMPARISON_DATE")?;
                4+day as usize
            }else{scope(text(row,"scope")?)?};
            let start=number(row,"start")?;let end=number(row,"end")?;
            check(range(start,0,1439)&&range(end,1,1440)&&start<end,"COMPARISON_INTERVAL")?;
            let maximum=integer(row,"maximum",if daily{MAX_PEAK}else{MAX_PEAK*42})?;
            let peak=if daily{maximum}else{integer(row,"peak",MAX_PEAK)?};
            caps[sector].entry((scope,role)).or_default().push((start,end,maximum,peak));
        }
    }
    let mut compiled=0usize;
    let mut term_count=0usize;
    for (id,f) in facts.iter_mut().enumerate(){
        let mut terms=Terms::new();
        for (index,b) in f.bands.iter().enumerate(){
            if !b.estimated||advisory&(1u64<<b.day)!=0{continue;}
            for (role,position) in std::iter::once((None,None)).chain(b.roles.iter().enumerate().map(|(i,(r,_))|(Some(*r),Some(i)))){
                for scope in 0..4{
                    if in_scope(f,b.day,scope){
                        terms.entry((scope,role)).or_default().push((b.start,b.end,Term{band:index,role:position}));
                    }
                }
                if has_daily{terms.entry((4+b.day,role)).or_default().push((b.start,b.end,Term{band:index,role:position}));}
            }
        }
        let mut limits=Vec::new();
        for (key,terms) in terms{
            check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
            let bounds=caps[id].get(&key).map(Vec::as_slice).unwrap_or(&[]);
            let mut edges=BTreeSet::new();
            for (a,b,_) in &terms{edges.insert(*a);edges.insert(*b);}
            for (a,b,_,_) in bounds{edges.insert(*a);edges.insert(*b);}
            let edges:Vec<_>=edges.into_iter().collect();
            for interval in edges.windows(2){
                check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
                let a=interval[0];let b=interval[1];
                let active:Vec<_>=terms.iter().filter(|(s,e,_)|*s<=a&&*e>=b).map(|(_,_,t)|t.clone()).collect();
                if active.is_empty(){continue;}
                let allowed=bounds.iter().filter(|(s,e,_,_)|*s<=a&&*e>=b);
                let maximum=allowed.clone().map(|(_,_,n,_)|*n).min().unwrap_or(0);
                let peak=allowed.map(|(_,_,_,n)|*n).min().unwrap_or(0);
                term_count+=active.len();compiled+=1;
                check(term_count<=MAX_TERMS&&compiled<=MAX_CHECKS,"COMPARISON_COMPLEXITY")?;
                limits.push(Limit{terms:active,maximum,peak});
            }
        }
        f.comparison=Some(Bounds{totals:totals[id],limits,advisory});
    }
    Ok(())
}
pub(super) fn deficit(f:&TemporalFacts,attendance:&super::Attendance,members:&BTreeMap<usize,Presence>)->i64{
    let Some(bounds)=&f.comparison else{return 0;};
    let mut totals=[0i64;6];
    let gaps:Vec<_>=f.bands.iter().map(|b|{
        if !b.estimated||bounds.advisory(b.day){return (0,Vec::new());}
        let present=civil_presence(attendance,b.day,b.clock_mask,b.previous_mask);
        let roles:Vec<_>=b.roles.iter().map(|(r,n)|(*n-i64::from((present&members.get(r).copied().unwrap_or_default()).count_ones())).max(0)).collect();
        let general=(b.general-i64::from(present.count_ones())).max(0).max(roles.iter().sum());
        let cost=general*i64::from(b.end-b.start);
        for (scope,total) in totals[..4].iter_mut().enumerate(){
            if in_scope(f,b.day,scope){*total+=cost;}
        }
        totals[4]+=general*i64::from((b.end.min(f.closing)-b.start.max(f.closing-60)).max(0));
        totals[5]=totals[5].max(general);
        (general,roles)
    }).collect();
    let mut hard:i64=totals.iter().zip(bounds.totals).map(|(n,cap)|(*n-cap).max(0)).sum();
    for limit in &bounds.limits{
        let mut total=0;let mut peak=0;
        for term in &limit.terms{
            let (general,roles)=&gaps[term.band];
            let n=term.role.map_or(*general,|i|roles[i]);
            total+=n;peak=peak.max(n);
        }
        hard+=(total-limit.maximum).max(0)+(peak-limit.peak).max(0);
    }
    hard
}
