//! Civil dates for isolated synthetic CUSTOM/MANUAL simulations in 2026/27.
//! Gregorian ordinal arithmetic; São Paulo has a constant UTC offset here.
//! No local calendar or production policy is inferred from the dates.
use super::{MAX_DAYS,Result,check,civil_date};
const MONTHS:[i32;12]=[31,28,31,30,31,30,31,31,30,31,30,31];
fn leap(y:i32)->bool{y%4==0&&(y%100!=0||y%400==0)}
fn ordinal(date:&str)->Result<i32>{
    check(civil_date(date),"DATE")?;
    let y=date[..4].parse::<i32>().map_err(|_|"DATE")?;
    let m=date[5..7].parse::<usize>().map_err(|_|"DATE")?;
    let d=date[8..].parse::<i32>().map_err(|_|"DATE")?;
    let before=y-1;
    Ok(365*before+before/4-before/100+before/400+MONTHS[..m-1].iter().sum::<i32>()
        +i32::from(leap(y)&&m>2)+d)
}
fn month_days(year:i32,month:usize)->i32{MONTHS[month-1]+i32::from(month==2&&leap(year))}
pub(super) fn weekly_ceiling(date:&str)->i32{
    if date<"2026-12-16"{44}else if date<"2027-12-16"{42}else{40}
}
pub(super) fn daily_ceiling(date:&str)->i32{
    if date<"2026-12-16"{600}else if date<"2027-12-16"{504}else{480}
}
#[derive(Debug,Clone,PartialEq,Eq,Hash)]
pub(super) struct Calendar{
    start:i32,pub labels:Vec<String>,pub weeks:Vec<(usize,usize)>,
    pub visible:[bool;MAX_DAYS],pub offset:usize,pub cutover:bool,
}
impl Calendar{
    pub fn new(first:&str,last:&str,month:Option<&str>)->Result<Self>{
        Self::aligned(first,last,month,0)
    }
    // Week grouping changes; civil weekday numbers and input dates never do.
    pub fn aligned(first:&str,last:&str,month:Option<&str>,week_start:usize)->Result<Self>{
        check(week_start<=1,"PLANNING_WEEK")?;
        let start=ordinal(first)?;let end=ordinal(last)?;
        let days=end-start+1;
        let cutover=week_start==0&&first=="2026-12-01"&&last=="2026-12-31";
        check(first>="2026-01-01"&&last<="2027-12-31"&&(7..=MAX_DAYS as i32).contains(&days)
            &&(cutover||start.rem_euclid(7)==week_start as i32&&days%7==0),"TEMPORAL_HORIZON")?;
        let mut year=first[..4].parse::<i32>().map_err(|_|"DATE")?;
        let mut january=ordinal(&format!("{year}-01-01"))?;
        let mut labels=Vec::with_capacity(days as usize);
        for date in start..=end{
            if date>=january+365+i32::from(leap(year)){
                january+=365+i32::from(leap(year));year+=1;
            }
            let mut day=date-january+1;let mut month=1;
            while day>month_days(year,month){day-=month_days(year,month);month+=1;}
            labels.push(format!("{year}-{month:02}-{day:02}"));
        }
        let offset=start.rem_euclid(7) as usize;
        let mut weeks=Vec::new();
        let mut a=0;
        while a<labels.len(){
            let b=(a+7-(offset+a+7-week_start)%7).min(labels.len());
            weeks.push((a,b));a=b;
        }
        check(weeks.len()<=6,"TEMPORAL_WEEK_COUNT")?;
        let mut visible=[false;MAX_DAYS];
        let month_range=|value:&str|->Result<(i32,i32)>{
            check(value.len()==7,"VISIBLE_MONTH")?;
            let first=format!("{value}-01");let begin=ordinal(&first)?;
            let year=first[..4].parse::<i32>().map_err(|_|"DATE")?;
            let m=first[5..7].parse::<usize>().map_err(|_|"DATE")?;
            Ok((begin,begin+month_days(year,m)-1))
        };
        let scope=if let Some(value)=month{
            let (a,b)=month_range(value)?;
            check(a>=start&&b<=end,"VISIBLE_MONTH")?;Some((a,b))
        }else{
            let (a,b)=month_range(&labels[labels.len()/2][..7])?;
            let technical_start=a-(a-week_start as i32).rem_euclid(7);
            let technical_end=b+6-(b-week_start as i32).rem_euclid(7);
            if start==technical_start&&end==technical_end{Some((a,b))}else{None}
        };
        for (i,flag) in visible.iter_mut().enumerate().take(labels.len()){
            *flag=scope.is_none_or(|(a,b)|(a..=b).contains(&(start+i as i32)));
        }
        Ok(Self{start,labels,weeks,visible,offset,cutover})
    }
    pub fn relative(&self,date:&str)->Result<i32>{Ok(ordinal(date)?-self.start)}
    pub fn weekday(&self,day:usize)->usize{(self.offset+day)%7}
    pub fn week(&self,day:usize)->usize{self.weeks.partition_point(|&(_,end)|end<=day)}
}
pub(super) fn paid_date(date:&str)->bool{
    civil_date(date)&&matches!(&date[5..],"01-01"|"05-01"|"12-25")
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn preserves_sunday_weeks_and_civil_boundaries(){
        let c=Calendar::new("2026-04-05","2026-05-16",None).unwrap();
        assert_eq!(c.labels.len(),42);assert_eq!(c.labels[26],"2026-05-01");
        assert_eq!(c.relative("2026-03-29").unwrap(),-7);
        assert_eq!(c.relative("2026-05-17").unwrap(),42);
        assert!(Calendar::new("2026-04-06","2026-05-17",None).is_err());
        assert!(Calendar::new("2026-12-13","2026-12-19",None).is_ok());
        let c=Calendar::new("2026-11-01","2026-12-05",None).unwrap();
        assert_eq!(c.visible.iter().filter(|&&x|x).count(),30);
        let cut=Calendar::new("2026-12-01","2026-12-31",Some("2026-12")).unwrap();
        assert_eq!(cut.weeks,[(0,5),(5,12),(12,19),(19,26),(26,31)]);
        assert_eq!(cut.weekday(0),2);assert_eq!(cut.weekday(5),0);
        assert_eq!(cut.week(30),4);assert_eq!(cut.visible.iter().filter(|&&x|x).count(),31);
        let c=Calendar::new("2026-12-27","2027-01-09",None).unwrap();
        assert_eq!(c.labels[5],"2027-01-01");
        assert_eq!(weekly_ceiling("2026-12-15"),44);assert_eq!(weekly_ceiling("2026-12-16"),42);
        assert_eq!(weekly_ceiling("2027-12-16"),40);assert_eq!(daily_ceiling("2027-12-16"),480);
        assert!(paid_date("2026-05-01"));assert!(!paid_date("2026-11-20"));
    }
}
