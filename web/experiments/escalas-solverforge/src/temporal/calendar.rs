//! Civil dates for the isolated pre-transition 2026 temporal prototype.
//! Gregorian ordinal arithmetic; no external timezone or calendar dependency.
//! The supported São Paulo civil horizon does not cross a UTC-offset change.
use super::{MAX_DAYS,Result,check,civil_date};
const MONTHS:[i32;12]=[31,28,31,30,31,30,31,31,30,31,30,31];
fn ordinal(date:&str)->Result<i32>{
    check(civil_date(date),"DATE")?;
    let y=date[..4].parse::<i32>().map_err(|_|"DATE")?;
    let m=date[5..7].parse::<usize>().map_err(|_|"DATE")?;
    let d=date[8..].parse::<i32>().map_err(|_|"DATE")?;
    let before=y-1;
    let leap=y%4==0&&(y%100!=0||y%400==0);
    Ok(365*before+before/4-before/100+before/400+MONTHS[..m-1].iter().sum::<i32>()
        +i32::from(leap&&m>2)+d)
}
#[derive(Debug)]
pub(super) struct Calendar{
    start:i32,pub labels:Vec<String>,
}
impl Calendar{
    pub fn new(first:&str,last:&str)->Result<Self>{
        let start=ordinal(first)?;let end=ordinal(last)?;
        let days=end-start+1;
        check(first.starts_with("2026-")&&last.starts_with("2026-")&&last<"2026-12-16"
            &&start.rem_euclid(7)==0&&(7..=MAX_DAYS as i32).contains(&days)&&days%7==0,
            "TEMPORAL_HORIZON")?;
        let january=ordinal("2026-01-01")?;
        let labels=(start..=end).map(|date|{
            let mut day=date-january+1;let mut month=1;
            for len in MONTHS{
                if day<=len{break;}
                day-=len;month+=1;
            }
            format!("2026-{month:02}-{day:02}")
        }).collect::<Vec<_>>();
        // The original visibleDates infers a month for exact monthly horizons.
        // Exclude padded inferred months until visible-month scoring is ported.
        let middle=&labels[labels.len()/2];let month=middle[5..7].parse::<usize>().unwrap();
        let mstart=ordinal(&format!("2026-{month:02}-01"))?;
        let mend=mstart+MONTHS[month-1]-1;
        let technical_start=mstart-mstart.rem_euclid(7);
        let technical_end=mend+(6-mend.rem_euclid(7));
        check(start!=technical_start||end!=technical_end||(start==mstart&&end==mend),"TEMPORAL_MONTH_PADDING_PENDING")?;
        Ok(Self{start,labels})
    }
    pub fn relative(&self,date:&str)->Result<i32>{Ok(ordinal(date)?-self.start)}
}
pub(super) fn paid_date(date:&str)->bool{
    civil_date(date)&&matches!(&date[5..],"01-01"|"05-01"|"12-25")
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn preserves_sunday_weeks_and_civil_boundaries(){
        let c=Calendar::new("2026-04-05","2026-05-16").unwrap();
        assert_eq!(c.labels.len(),42);assert_eq!(c.labels[26],"2026-05-01");
        assert_eq!(c.relative("2026-03-29").unwrap(),-7);
        assert_eq!(c.relative("2026-05-17").unwrap(),42);
        assert!(Calendar::new("2026-04-06","2026-05-17").is_err());
        assert!(Calendar::new("2026-12-13","2026-12-19").is_err());
        assert!(Calendar::new("2026-11-01","2026-12-05").is_err()); // monthly padding
        assert!(paid_date("2026-05-01"));assert!(!paid_date("2026-11-20"));
    }
}
