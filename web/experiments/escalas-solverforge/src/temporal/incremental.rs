//! Reversible temporal attendance and per-civil-day coverage cache.
//! Keep the full sector oracle separate; no objective or guard is relaxed.
use std::collections::BTreeMap;
use std::sync::Arc;
use solverforge::stream::collector::Accumulator;
use crate::model::Presence;
use super::{Attendance,Cost,MAX_DAYS,Member,TemporalFacts,add_fairness,civil_presence,clock,comparison,service_bounds};

#[derive(Clone,Copy,Default)]
struct Daily{
    hard:i64,estimated:i64,sunday:i64,movement:i64,closing:i64,
    sunday_units:i64,sunday_reference:bool,
}
pub(crate) struct TemporalAccumulator{
    rows:BTreeMap<usize,Member>,
    facts:Option<Arc<TemporalFacts>>,
    bands_by_day:[Vec<usize>;MAX_DAYS],
    attendance:super::Attendance,
    role_members:BTreeMap<usize,Presence>,
    daily:[Daily;MAX_DAYS],
    personal:Cost,
}
impl Default for TemporalAccumulator{
    fn default()->Self{
        Self{rows:BTreeMap::new(),facts:None,bands_by_day:std::array::from_fn(|_|Vec::new()),
            attendance:Attendance::default(),role_members:BTreeMap::new(),
            daily:[Daily::default();MAX_DAYS],personal:[0;17]}
    }
}
impl TemporalAccumulator{
    fn refresh(&mut self,day:usize){
        let f=self.facts.as_ref().expect("temporal facts");
        let mut daily=Daily::default();
        for &index in &self.bands_by_day[day]{
            let b=&f.bands[index];
            let present=civil_presence(&self.attendance,day,b.clock_mask,b.previous_mask);
            let roles:i64=b.roles.iter().map(|(role,n)|{
                let members=self.role_members.get(role).copied().unwrap_or_default();
                (*n-i64::from((present&members).count_ones())).max(0)
            }).sum();
            let gap=(b.general-i64::from(present.count_ones())).max(0).max(roles);
            let cost=gap*i64::from(b.end-b.start);
            if b.estimated{
                daily.estimated+=cost;
                if f.weekday(day)==0{
                    daily.sunday+=cost;daily.sunday_units+=cost/f.peak_quantum;
                    daily.sunday_reference=true;
                }
                if f.movement_enabled{daily.movement+=cost*f.priority[day].unwrap_or(2);}
                let close=(b.end.min(f.closing)-b.start.max(f.closing-60)).max(0);
                daily.closing+=gap*i64::from(close);
            }else{daily.hard+=cost;}
        }
        self.daily[day]=daily;
    }
    fn apply(&mut self,row:&Member,insert:bool){
        let bit=Presence::one(row.id);
        let sign=if insert{1}else{-1};
        let role=self.role_members.entry(row.role).or_default();
        if insert{*role|=bit;}else{*role&=!bit;}
        if role.is_empty(){self.role_members.remove(&row.role);}
        if let Some(state)=row.carry_in{
            let cell=&mut self.attendance[MAX_DAYS][usize::from(state)];
            if insert{*cell|=bit;}else{*cell&=!bit;}
            self.refresh(0);
        }
        let Some(p)=row.pattern else{return;};
        for (day,&state) in p.states.iter().enumerate().take(row.facts.days){
            let Some(c)=clock(&row.facts.clocks,state) else{continue;};
            let cell=&mut self.attendance[day][usize::from(state)];
            if insert{*cell|=bit;}else{*cell&=!bit;}
            self.refresh(day);
            if day+1<row.facts.days&&c.overnight(){self.refresh(day+1);}
        }
        for (total,value) in self.personal.iter_mut().zip(p.personal){*total+=sign*value;}
    }
    fn cost(&self)->Cost{
        let Some(f)=&self.facts else{return [0;17];};
        let mut total=self.personal;
        total[0]+=service_bounds::deficit(f,&self.attendance,&self.role_members);
        total[0]+=comparison::deficit(f,&self.attendance,&self.role_members);
        let mut sunday=[0i64;6];
        let mut references=0;
        for (day,d) in self.daily.iter().enumerate().take(f.days){
            total[0]+=d.hard;total[1]+=d.estimated;total[2]+=d.sunday;
            total[4]+=d.movement;total[5]+=d.closing;
            if d.sunday_reference{references+=1;sunday[f.week(day)]+=d.sunday_units;}
        }
        if references>=2{
            total[3]=sunday.iter().max().copied().unwrap_or(0)*f.peak_weight
                +sunday.iter().map(|n|n*n).sum::<i64>();
        }
        let rows:Vec<_>=self.rows.values().collect();
        add_fairness(&rows,f,&mut total);
        total
    }
}
impl Accumulator<Member,Cost> for TemporalAccumulator{
    type Retraction=usize;
    fn accumulate(&mut self,row:Member)->usize{
        let id=row.id;
        assert!(!self.rows.contains_key(&id),"duplicate temporal row");
        if let Some(f)=&self.facts{assert!(Arc::ptr_eq(f,&row.facts),"temporal facts drift");}
        else{
            self.facts=Some(Arc::clone(&row.facts));
            self.attendance=Attendance::new(row.facts.clocks.len());
            for (i,b) in row.facts.bands.iter().enumerate(){self.bands_by_day[b.day].push(i);}
            for day in 0..row.facts.days{self.refresh(day);}
        }
        self.apply(&row,true);
        self.rows.insert(id,row);
        id
    }
    fn retract(&mut self,id:usize){
        let row=self.rows.remove(&id).expect("missing temporal row");
        if self.rows.is_empty(){*self=Self::default();}
        else{self.apply(&row,false);}
    }
    fn with_result<T>(&self,f:impl FnOnce(&Cost)->T)->T{f(&self.cost())}
    fn reset(&mut self){*self=Self::default();}
}
