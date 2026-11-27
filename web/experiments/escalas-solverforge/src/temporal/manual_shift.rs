//! Validate optional period provenance without expanding the normal clock domain.
use std::collections::{BTreeMap,BTreeSet};
use super::{Clock,Result,V,array,check,clock,empty,identifier,number,range,text};

fn marking(value:&V)->Result<i32>{
    let s=value.as_str().ok_or("MANUAL_SHIFT_GEOMETRY")?.as_bytes();
    check(s.len()==5&&s[2]==b':'&&[s[0],s[1],s[3],s[4]].iter().all(u8::is_ascii_digit),"MANUAL_SHIFT_GEOMETRY")?;
    let hour=i32::from((s[0]-b'0')*10+s[1]-b'0');
    let minute=i32::from((s[3]-b'0')*10+s[4]-b'0');
    check(hour<24&&minute<60,"MANUAL_SHIFT_GEOMETRY")?;
    Ok(hour*60+minute)
}

fn same_geometry(selection:&V,clock:&Clock)->Result<()>{
    let marks=array(selection,"markings")?;
    check(marks.len()==4,"MANUAL_SHIFT_GEOMETRY")?;
    let (a,b,c,d)=(marking(&marks[0])?,marking(&marks[1])?,marking(&marks[2])?,marking(&marks[3])?);
    check(a<b&&((c==0&&d==0)||(b<=c&&c<d)),"MANUAL_SHIFT_GEOMETRY")?;
    let (expected,paid,end)=if c==0&&d==0{(vec![(a,b)],b-a,b)}
        else if b==c{(vec![(a,d)],d-a,d)}
        else{(vec![(a,b),(c,d)],b-a+d-c,d)};
    check(clock.segments==expected&&clock.start==a&&clock.end==end&&clock.paid==paid,"MANUAL_SHIFT_GEOMETRY")
}

pub(super) fn read(
    person:&V,ids:&BTreeMap<String,u8>,clocks:&[Clock],days:usize,
    employment:(i32,i32),calendar_offset:impl Fn(&str)->Result<i32>,
) -> Result<BTreeMap<i32,u8>>{
    let started=|day:i32|(0..days as i32).contains(&day)&&(employment.0..=employment.1).contains(&day);
    let lookup=|id:&str|ids.get(id).copied().ok_or("CLOCK_REFERENCE");
    let mut by_date=BTreeMap::new();
    if !empty(person,"manualShiftByDate"){
        let entries=person["manualShiftByDate"].as_object().ok_or("DATED_OVERRIDE")?;
        check(person["scheduleMode"].as_str().is_none_or(|s|s=="TIMED"),"DATED_OVERRIDE_UNTIMED")?;
        for (date,sid) in entries{
            let day=calendar_offset(date)?;check(started(day),"DATED_OVERRIDE_DATE")?;
            by_date.insert(day,lookup(sid.as_str().ok_or("DATED_OVERRIDE")?)?);
        }
    }
    let Some(_) = person.get("manualShiftOverrides") else{
        check(person.get("manualShiftBaseIds").is_none(),"MANUAL_SHIFT_PROVENANCE")?;
        // The older service contract also accepts a dated map on its own.
        return Ok(by_date);
    };
    check(person["scheduleMode"].as_str()==Some("TIMED"),"DATED_OVERRIDE_UNTIMED")?;
    let intervals=array(person,"manualShiftOverrides")?;
    check((1..=12).contains(&intervals.len()),"MANUAL_SHIFT_PROVENANCE")?;
    if person.get("manualShiftBaseIds").is_some(){
        let raw=array(person,"manualShiftBaseIds")?;
        check((1..=12).contains(&raw.len()),"MANUAL_SHIFT_BASE")?;
        let states=|rows:&[V]|rows.iter().map(|id|lookup(id.as_str().ok_or("MANUAL_SHIFT_BASE")?)).collect::<Result<BTreeSet<_>>>();
        let base=states(raw)?;
        check(base.len()==raw.len()&&base==states(array(person,"shiftIds")?)?,"MANUAL_SHIFT_BASE")?;
    }
    let mut expected=BTreeMap::new();
    for period in intervals{
        const KEYS:[&str;5]=["catalogCode","shiftId","markings","effectiveFrom","effectiveUntil"];
        check(period.as_object().is_some_and(|o|o.len()==KEYS.len()&&KEYS.iter().all(|k|o.contains_key(*k))),"MANUAL_SHIFT_PROVENANCE")?;
        check(range(number(period,"catalogCode")?,1500,2_000_000_000),"MANUAL_SHIFT_PROVENANCE")?;
        let start=calendar_offset(text(period,"effectiveFrom")?)?;
        let end=calendar_offset(text(period,"effectiveUntil")?)?;
        check(start<=end&&started(start)&&started(end),"DATED_OVERRIDE_DATE")?;
        let state=lookup(identifier(period,"shiftId")?)?;
        same_geometry(period,clock(clocks,state).ok_or("CLOCK_REFERENCE")?)?;
        for day in start..=end{
            check(expected.insert(day,state).is_none(),"MANUAL_SHIFT_OVERLAP")?;
        }
    }
    if let Some(map)=person.get("manualShiftByDate"){
        check(map.is_object()&&by_date==expected,"MANUAL_SHIFT_PROJECTION")?;
    }
    Ok(expected)
}
