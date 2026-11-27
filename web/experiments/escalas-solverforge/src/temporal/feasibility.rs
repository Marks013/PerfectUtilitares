//! Necessary coverage conditions over a relaxation of the ORIGINAL domains.
//! A sampled catalogue is never used to certify that a request is infeasible.
use std::collections::BTreeMap;
use std::time::Instant;
use super::{Calendar,MAX_DAYS,Presence,Result,TemporalEmployee,TemporalFacts,
    check,civil_presence,clock,comparison,service_bounds};

type Attendance=super::Attendance;
pub(super) struct BandConflict{pub(super) date:String,pub(super) start:i32,pub(super) end:i32}

struct Sector{
    attendance:Box<Attendance>,roles:BTreeMap<usize,Presence>,days:Vec<(usize,u64)>,
}
impl Default for Sector{
    fn default()->Self{Self{attendance:Box::new([[Presence::EMPTY;16];MAX_DAYS+1]),roles:BTreeMap::new(),days:Vec::new()}}
}
#[derive(Default)]
pub(super) struct Upper{sectors:BTreeMap<usize,Sector>}
impl Upper{
    pub(super) fn observe(&mut self,p:&TemporalEmployee,raw:&[Vec<u8>],deadline:Instant)->Result<()>{
        check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
        let mut masks=[0u16;MAX_DAYS];
        if p.facts.days==7{
            // One-week enumeration is exhaustive and enrichment never prunes it.
            for &i in p.allowed.iter(){
                check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
                for (d,&state) in p.catalog[i].states.iter().enumerate().take(7){
                    if clock(&p.facts.clocks,state).is_some(){masks[d]|=1u16<<state;}
                }
            }
        }else{
            // This intentionally overestimates: incompatible clocks/days may coexist.
            // Keeping pre-sampling options prevents false negative certificates.
            for (d,states) in raw.iter().enumerate(){for &state in states{
                if clock(&p.facts.clocks,state).is_some(){masks[d]|=1u16<<state;}
            }}
        }
        let sector=self.sectors.entry(p.sector).or_default();let bit=Presence::one(p.id);
        *sector.roles.entry(p.role).or_default()|=bit;
        if let Some(state)=p.carry_in{sector.attendance[MAX_DAYS][usize::from(state)]|=bit;}
        let mut days=0u64;
        for (day,&mask) in masks.iter().enumerate().take(p.facts.days){
            if mask!=0{days|=1u64<<day;}
            for (state,present) in sector.attendance[day].iter_mut().enumerate().take(15).skip(3){
                if mask&(1u16<<state)!=0{*present|=bit;}
            }
        }
        sector.days.push((p.role,days));Ok(())
    }
    pub(super) fn verify(&self,facts:&[std::sync::Arc<TemporalFacts>],calendar:&Calendar,deadline:Instant,detail:&mut Option<BandConflict>)->Result<()>{
        for (id,f) in facts.iter().enumerate(){
            check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
            let empty=Sector::default();
            let s=self.sectors.get(&id).unwrap_or(&empty);
            let mut required=[0i64;MAX_DAYS];let mut role_required=BTreeMap::<usize,[i64;MAX_DAYS]>::new();
            for b in &f.bands{
                check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
                if b.estimated{continue;}
                let present=civil_presence(&s.attendance,b.day,b.clock_mask,b.previous_mask);
                if i64::from(present.count_ones())<b.general{
                    *detail=Some(BandConflict{date:f.dates[b.day].clone(),start:b.start,end:b.end});
                    return Err("INFEASIBLE_COVERAGE_BOUND");
                }
                for &(role,minimum) in &b.roles{
                    let available=(present&s.roles.get(&role).copied().unwrap_or_default()).count_ones();
                    if i64::from(available)<minimum{
                        *detail=Some(BandConflict{date:f.dates[b.day].clone(),start:b.start,end:b.end});
                        return Err("INFEASIBLE_COVERAGE_BOUND");
                    }
                    let row=role_required.entry(role).or_insert([0;MAX_DAYS]);row[b.day]=row[b.day].max(minimum);
                }
                required[b.day]=required[b.day].max(b.general.max(b.roles.iter().map(|(_,n)|n).sum()));
            }
            check(service_bounds::deficit(f,&s.attendance,&s.roles)==0,"INFEASIBLE_COVERAGE_BOUND")?;
            check(comparison::deficit(f,&s.attendance,&s.roles)==0,"INFEASIBLE_COMPARISON_BOUND")?;
            // Five shifts can occupy more than five civil dates overnight. In that
            // model this person-day inequality does not apply and must be omitted.
            if f.clocks.iter().any(|c|c.overnight()){continue;}
            for (day,minimum) in required.iter_mut().enumerate().take(f.days){
                if f.protected_days&(1u64<<day)!=0{*minimum=(*minimum).max(1);}
            }
            for &(a,b) in &calendar.weeks{
                check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
                let mask=((1u64<<(b-a))-1)<<a;
                let capacity=|role:Option<usize>|s.days.iter().filter(|(r,_)|role.is_none_or(|x|x==*r))
                    .map(|(_,d)|i64::from((d&mask).count_ones().min(5))).sum::<i64>();
                check(required[a..b].iter().sum::<i64>()<=capacity(None),"INFEASIBLE_COVERAGE_BOUND")?;
                for (&role,row) in &role_required{
                    check(row[a..b].iter().sum::<i64>()<=capacity(Some(role)),"INFEASIBLE_COVERAGE_BOUND")?;
                }
            }
        }
        check(Instant::now()<deadline,"MAPPING_TIMEOUT")
    }
}
