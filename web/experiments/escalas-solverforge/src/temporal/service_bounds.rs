//! Strict read-only admission for the original private service-floor wire.
//! Actual timed WORK only; do not infer protection from DUTY, breaks or a
//! saved foreign solver. The hard score is zero iff all supplied floors hold.
use std::collections::{BTreeMap,BTreeSet};
use serde_json::Value as V;
use crate::model::Presence;
use super::{Calendar,MAX_DAYS,TemporalFacts,Result,array,check,civil_presence,clock_masks,number,range,text};
#[derive(Clone,Debug,PartialEq,Eq,Hash)]
pub(super) struct Bound{
    role:usize,scope:u8,mask:u16,previous_mask:u16,minimum:i64,minutes:i64,
}
fn fields(row:&V,names:&[&str])->bool{
    row.as_object().is_some_and(|o|o.len()==names.len()&&names.iter().all(|k|o.contains_key(*k)))
}
fn scope(value:&str)->Result<u8>{
    match value{"HORIZON"=>Ok(0),"MONTH"=>Ok(1),"SUNDAYS"=>Ok(2),"MONTH_SUNDAYS"=>Ok(3),_=>Err("SERVICE_SCOPE")}
}
pub(super) fn read(input:&V,calendar:&Calendar,sectors:&BTreeMap<String,usize>,roles:&BTreeMap<String,usize>,
                   facts:&mut [TemporalFacts])->Result<()>{
    let Some(service)=input.get("_coverageServiceProtection")else{return Ok(());};
    check(fields(service,&["days","bands"]),"SERVICE_FIELDS")?;
    let days=array(service,"days")?;
    check(days.len()<=10500,"SERVICE_DAY_LIMIT")?;
    let mut known=BTreeSet::new();
    for p in array(input,"employees")?{
        known.insert((text(p,"sector")?,text(p,"role")?));
    }
    for row in days{
        check(fields(row,&["date","sector"]),"SERVICE_DAY_FIELDS")?;
        let day=calendar.relative(text(row,"date")?)?;
        check((0..calendar.labels.len() as i32).contains(&day),"SERVICE_DAY")?;
        let sector=*sectors.get(text(row,"sector")?).ok_or("SERVICE_SECTOR")?;
        facts[sector].protected_days|=1u64<<day;
    }
    let mut total=0usize;
    for row in array(service,"bands")?{
        check(fields(row,&["sector","role","start","end","scope","minimum"]),"SERVICE_BAND_FIELDS")?;
        let name=text(row,"sector")?;let role_name=text(row,"role")?;
        check(known.contains(&(name,role_name)),"SERVICE_ROLE")?;
        let sector=sectors[name];let role=roles[role_name];let scope=scope(text(row,"scope")?)?;
        let start=number(row,"start")?;let end=number(row,"end")?;let minimum=number(row,"minimum")?;
        check(range(start,0,1439)&&range(end,1,1440)&&start<end&&range(minimum,1,10500),"SERVICE_INTERVAL")?;
        let f=&mut facts[sector];
        let mut edges=BTreeSet::from([start,end]);
        for c in f.clocks.iter(){for (_,a,b) in c.civil_parts(){
            if start<a&&a<end{edges.insert(a);}
            if start<b&&b<end{edges.insert(b);}
        }}
        let edges:Vec<_>=edges.into_iter().collect();
        for bounds in edges.windows(2){
            let (mask,previous_mask)=clock_masks(&f.clocks,bounds[0],bounds[1]);
            total+=1;check(total<=120000,"SERVICE_SPLIT_LIMIT")?;
            f.protected_bands.push(Bound{role,scope,mask,previous_mask,minimum:i64::from(minimum),minutes:i64::from(bounds[1]-bounds[0])});
        }
    }
    Ok(())
}
pub(super) fn deficit(facts:&TemporalFacts,attendance:&[[Presence;16];MAX_DAYS],role_members:&BTreeMap<usize,Presence>)->i64{
    if facts.protected_days==0&&facts.protected_bands.is_empty(){return 0;}
    let mut missing=0i64;
    let masks=facts.clocks.iter().enumerate().fold((0u16,0u16),|(mut current,mut previous),(i,c)|{
        if c.civil_parts().any(|(offset,_,_)|offset==0){current|=1u16<<(i+3);}
        if c.civil_parts().any(|(offset,_,_)|offset==1){previous|=1u16<<(i+3);}
        (current,previous)
    });
    for d in 0..facts.days{
        if facts.protected_days&(1u64<<d)!=0&&civil_presence(attendance,d,masks.0,masks.1).is_empty(){missing+=1;}
    }
    for b in &facts.protected_bands{
        let members=role_members.get(&b.role).copied().unwrap_or_default();
        let mut count=0;
        for d in 0..facts.days{
            if b.scope&1!=0&&!facts.visible[d]||b.scope&2!=0&&facts.weekday(d)!=0{continue;}
            let present=civil_presence(attendance,d,b.mask,b.previous_mask);
            count+=i64::from((present&members).count_ones());
        }
        missing+=(b.minimum-count).max(0)*b.minutes;
    }
    missing
}
