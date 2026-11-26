//! Legal full-horizon paths assembled from weekly domains. A bounded sample
//! is never a proof of infeasibility or of complete search over six weeks.
use std::collections::{BTreeMap,BTreeSet};
use std::time::Instant;
use crate::model::PersonalRules;
use super::{ABS,Clock,HOL,INACTIVE,MAX_DAYS,OFF,Pattern,Record,Result,check,clock,work};

const MAX_WEEK:usize=30_000;
pub(super) const PATH_LIMIT:usize=384;
const PATH_ATTEMPTS:usize=2048;
const WEEK_TRIES:usize=64;

#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord)]
pub(super) struct Rules{
    pub days:usize,pub personal:PersonalRules,pub fixed:u8,pub cap:i32,
    pub weeks:Vec<(usize,usize)>,pub targets:[i32;6],pub mixed:[bool;6],pub offset:usize,pub cutover:bool,
    pub weekly_limit:i32,pub inter:i32,pub weekly_rest:i32,pub untimed:bool,
    pub active_start:i32,pub active_end:i32,
    pub hours_only:bool,pub closed:[bool;MAX_DAYS],pub holiday:[bool;MAX_DAYS],
    pub old:[Option<Record>;MAX_DAYS],pub context:BTreeMap<i32,u8>,pub visible:[bool;MAX_DAYS],
}
impl Rules{
    fn employed(&self,d:i32)->bool{(self.active_start..=self.active_end).contains(&d)}
    fn weekday(&self,d:i32)->usize{(d+self.offset as i32).rem_euclid(7) as usize}
    fn week_legal(&self,week:usize,states:&[u8],clocks:&[Clock])->bool{
        let count=states.iter().filter(|&&s|work(s)).count() as i32;
        let off=states.iter().filter(|&&s|s==OFF).count() as i32;
        let absent=states.contains(&ABS);
        let a=self.weeks[week].0;
        let weekdays=states.iter().enumerate().filter(|(d,s)|**s==HOL&&self.weekday((a+*d) as i32)!=0).count() as i32;
        let sunday=states.iter().enumerate().filter(|(d,s)|**s==HOL&&self.weekday((a+*d) as i32)==0).count() as i32;
        let minutes:i32=states.iter().filter_map(|&s|clock(clocks,s)).map(|c|c.paid).sum();
        let complete=states.len()==7&&!states.contains(&INACTIVE);
        let first_partial=self.cutover&&week==0&&!states.contains(&INACTIVE);
        let target=self.targets[week];
        if count>5||!self.untimed&&minutes>target.min(self.weekly_limit){return false;}
        if !absent&&(complete||first_partial){
            if count!=((if first_partial{3}else{5})-weekdays).max(0)||off!=(2-sunday).max(0){return false;}
            if complete&&!self.untimed&&weekdays==0&&minutes!=target{return false;}
        }
        !(self.mixed[week]&&states.iter().filter_map(|&s|clock(clocks,s)).filter(|c|c.paid==540).count()>2)
    }
    fn mutable(&self,d:usize)->bool{
        self.employed(d as i32)&&!self.closed[d]&&self.fixed&(1<<self.weekday(d as i32))==0&&self.old[d].is_none_or(|r|r.locked!=Some(true)&&r.state!=ABS&&r.state!=HOL)
    }
    pub fn legal_prefix(&self,states:&[u8],clocks:&[Clock])->bool{
        let len=states.len() as i32;let horizon=self.days as i32;
        if len==0||len>horizon||!self.weeks.iter().any(|&(_,b)|b==states.len())
            ||!self.weeks.iter().enumerate().filter(|(_,(_,b))|*b<=states.len()).all(|(i,&(a,b))|self.week_legal(i,&states[a..b],clocks)){return false;}
        let full=len==horizon;
        let state=|d:i32|if !self.employed(d){None}
            else if (0..len).contains(&d){Some(states[d as usize])}
            else if d<0||full&&d>=horizon{self.context.get(&d).copied()}else{None};
        let max=i32::from(self.personal.max_run);
        for start in -max..len{
            if (start..=start+max).all(|d|state(d).is_some_and(work)){return false;}
        }
        let occupied=|d:i32|state(d).is_some_and(work)
            ||state(d-1).and_then(|s|clock(clocks,s)).is_some_and(Clock::overnight);
        for d in 0..len{
            if state(d).and_then(|s|clock(clocks,s)).is_some_and(Clock::overnight)
                &&(d+1<len||full)&&!state(d+1).is_some_and(work){return false;}
        }
        let sunday=-(self.offset as i32);
        for start in (sunday-self.cap*7..len).step_by(7){
            if (start..=start+self.cap*7).step_by(7).all(occupied){return false;}
        }
        if self.personal.variable{
            for start in -2..len{
                let mutable=(start..start+3).any(|d|(0..len).contains(&d)&&self.mutable(d as usize));
                if mutable&&(start..start+3).all(|d|state(d)==Some(OFF)){return false;}
            }
        }
        if self.personal.consecutive{
            let rest=|d:i32|state(d)==Some(OFF)||self.weekday(d)==0&&state(d)==Some(HOL);
            for d in 0..len{
                if d==len-1&&!full{continue;}
                let fixed_next=full&&d==len-1&&self.fixed&(1<<self.weekday(len))!=0&&state(len).is_none();
                if rest(d)&&!rest(d-1)&&!rest(d+1)&&!fixed_next{return false;}
            }
            if full&&state(len)==Some(OFF)&&state(len+1).is_some_and(|s|work(s)||s==ABS)&&state(len-1)!=Some(OFF){return false;}
        }
        for a in -5..len{
            let Some(ca)=state(a).and_then(|s|clock(clocks,s)) else{continue;};
            for b in a+1..=a+5{
                if b<0{continue;}
                let Some(cb)=state(b).and_then(|s|clock(clocks,s)) else{continue;};
                let gap=(b-a)*1440+cb.start()-ca.end();
                if gap<self.inter{return false;}
                if (a+1..b).any(|d|matches!(state(d),Some(OFF|HOL)))&&gap<self.weekly_rest{return false;}
            }
        }
        if full&&!self.hours_only&&!self.personal.consecutive&&self.fixed.count_ones()<2{
            let mut groups=BTreeMap::<u8,(usize,u8)>::new();
            for &(a,b) in &self.weeks{
                if b-a!=7||states[a..b].contains(&INACTIVE){continue;}
                let part=&states[a..b];
                if self.holiday[a..b].iter().any(|&x|x)||self.old[a..b].iter().flatten().any(|r|r.locked==Some(true)||matches!(r.state,ABS|HOL)){continue;}
                let imposed=self.closed[a..b].iter().enumerate().fold(self.fixed,|m,(d,c)|if *c{m|1<<d}else{m});
                if imposed.count_ones()>=2{continue;}
                let off=part.iter().enumerate().fold(0u8,|m,(d,s)|if *s==OFF{m|1<<d}else{m});
                let entry=groups.entry(imposed).or_insert((0,127));entry.0+=1;entry.1&=off;
            }
            if groups.values().any(|&(n,off)|n>=2&&off.count_ones()>=2){return false;}
        }
        true
    }
    pub fn pair_terms(&self)->i64{
        if !self.personal.adjustable(){return 0;}
        (0..self.days).filter(|&d|self.visible[d]&&(self.mutable(d)||d>0&&self.mutable(d-1))).count() as i64
    }
    fn pattern(&self,states:[u8;MAX_DAYS],clocks:&[Clock])->Pattern{
        let active=&states[..self.days];let mut cost=[0;17];
        let changes=active.iter().enumerate().filter(|(d,s)|self.old[*d].is_some_and(|r|r.state!=ABS&&r.state!=**s)).count() as i64;
        cost[13]=i64::from(changes>0);cost[14]=changes;
        cost[15]=active.iter().enumerate().filter(|(d,s)|work(**s)&&self.personal.preferred&(1<<self.weekday(*d as i32))!=0).count() as i64;
        if self.personal.prefer_consecutive{
            let opportunities=active.windows(2).filter(|w|!w.contains(&INACTIVE)).count();
            cost[15]+=opportunities as i64-active.windows(2).filter(|w|*w==[OFF,OFF]).count() as i64;
        }
        // Rest quality follows the original second-OFF month ownership.
        // [monthly excess, monthly adjustable, horizon adjustable,
        //  padding before visible month, padding after visible month].
        let mut rest=[0i64;5];
        if self.personal.adjustable(){
            let mut imposed=0;
            let first_visible=self.visible.iter().position(|&v|v).unwrap_or(0);
            let state=|d:i32|if !self.employed(d){None}else if (0..self.days as i32).contains(&d){Some(active[d as usize])}else{self.context.get(&d).copied()};
            for d in 0..=self.days{
                if state(d as i32-1)!=Some(OFF)||state(d as i32)!=Some(OFF){continue;}
                let mutable=d<self.days&&self.mutable(d)||d>0&&self.mutable(d-1);
                let visible=d<self.days&&self.visible[d];
                if mutable{
                    rest[2]+=1;
                    if visible{rest[1]+=1;}else{rest[if d<first_visible{3}else{4}]+=1;}
                }else if visible{imposed+=1;}
            }
            rest[0]=(rest[1]+imposed-2).max(0)-(imposed-2).max(0);
        }
        let civil_work=active.iter().enumerate().fold(0u64,|mask,(day,&s)|{
            if !work(s){return mask;}
            let mask=mask|1u64<<day;
            if clock(clocks,s).is_some_and(Clock::overnight)&&day+1<self.days{mask|1u64<<(day+1)}else{mask}
        });
        let mut rates=[None;2];let mut sunday_opportunities=0u64;
        for weekday in 0..7{
            let prior:Vec<_>=self.context.iter().filter(|(d,s)|(-21..0).contains(*d)&&self.weekday(**d)==weekday&&(work(**s)||**s==OFF)).map(|(_,s)|*s).collect();
            let actual=(0..self.days).filter(|&d|self.employed(d as i32)&&self.weekday(d as i32)==weekday);
            let opportunities=prior.len() as i64+actual.clone().filter(|&d|active[d]!=ABS).count() as i64;
            let rests=prior.iter().filter(|&&s|s==OFF).count() as i64+actual.clone().filter(|&d|active[d]==OFF).count() as i64;
            let deviation=(7*rests-2*opportunities).abs();
            cost[12]+=deviation;
            if self.untimed{cost[6]+=deviation*deviation;}
            if weekday==0||weekday==6{
                let eligible:Vec<_>=actual.filter(|&d|!self.closed[d]&&active[d]!=ABS&&self.fixed&(1<<weekday)==0
                    &&!self.old[d].is_some_and(|r|r.locked==Some(true)&&r.state==OFF)).collect();
                if !eligible.is_empty(){
                    let used=prior.iter().filter(|&&s|work(s)).count()+eligible.iter().filter(|&&d|civil_work&(1u64<<d)!=0).count();
                    rates[usize::from(weekday==6)]=Some(used as i64*10_000/(prior.len()+eligible.len()) as i64);
                    if weekday==0{for d in eligible{sunday_opportunities|=1u64<<d;}}
                }
            }
        }
        Pattern{states,personal:cost,rates,sunday_opportunities,civil_work,rest}
    }
}

fn weekly(options:&[Vec<u8>],rules:&Rules,clocks:&[Clock],week:usize,deadline:Instant)->Result<Vec<[u8;7]>>{
    fn visit(day:usize,states:&mut [u8;7],options:&[Vec<u8>],profile:(&Rules,usize),clocks:&[Clock],deadline:Instant,out:&mut Vec<[u8;7]>)->Result<()>{
        check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
        if day==options.len(){
            if profile.0.week_legal(profile.1,&states[..day],clocks){
                check(out.len()<MAX_WEEK,"TEMPORAL_DOMAIN_LIMIT")?;out.push(*states);
            }
        }else{
            for &state in &options[day]{states[day]=state;visit(day+1,states,options,profile,clocks,deadline,out)?;}
        }
        Ok(())
    }
    let mut out=Vec::new();visit(0,&mut [OFF;7],options,(rules,week),clocks,deadline,&mut out)?;
    Ok(out)
}
fn mix(mut n:u64)->u64{
    n=(n^(n>>30)).wrapping_mul(0xbf58476d1ce4e5b9);
    n=(n^(n>>27)).wrapping_mul(0x94d049bb133111eb);n^(n>>31)
}
pub(super) fn enumerate(options:&[Vec<u8>],rules:&Rules,clocks:&[Clock],deadline:Instant)->Result<Vec<Pattern>>{
    type WeeklyKey=(Vec<Vec<u8>>,i32,bool,bool,usize);
    let mut cache=BTreeMap::<WeeklyKey,Vec<[u8;7]>>::new();
    let mut weeks=Vec::new();
    for (week,&(a,b)) in rules.weeks.iter().enumerate(){
        let part=&options[a..b];
        let key=(part.to_vec(),rules.targets[week],rules.mixed[week],rules.cutover&&week==0,rules.weekday(a as i32));
        let values=if let Some(v)=cache.get(&key){v.clone()}else{
            let v=weekly(part,rules,clocks,week,deadline)?;cache.insert(key,v.clone());v
        };
        check(!values.is_empty(),"NO_PERSONAL_PATTERN")?;weeks.push(values);
    }
    let mut paths=BTreeSet::new();
    if rules.days==7{
        for week in &weeks[0]{
            check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
            if rules.legal_prefix(week,clocks){
                let mut path=[OFF;MAX_DAYS];path[..7].copy_from_slice(week);paths.insert(path);
            }
        }
    }else{
        // Bounded deterministic independent paths; no external engine seed.
        // Never enumerate the Cartesian product of temporal weekly patterns.
        for attempt in 0..PATH_ATTEMPTS{
            check(Instant::now()<deadline,"MAPPING_TIMEOUT")?;
            let mut path=[OFF;MAX_DAYS];let mut complete=true;
            for (week,values) in weeks.iter().enumerate(){
                let len=values.len();let (a,b)=rules.weeks[week];
                let start=(mix((attempt as u64+1)*67+week as u64)%(len as u64)) as usize;
                let mut found=false;
                for offset in 0..len.min(WEEK_TRIES){
                    path[a..b].copy_from_slice(&values[(start+offset)%len][..b-a]);
                    if rules.legal_prefix(&path[..b],clocks){found=true;break;}
                }
                if !found{complete=false;break;}
            }
            if complete{paths.insert(path);if paths.len()>=PATH_LIMIT{break;}}
        }
    }
    check(!paths.is_empty(),"NO_PERSONAL_PATTERN")?;
    Ok(paths.into_iter().map(|p|rules.pattern(p,clocks)).collect())
}
