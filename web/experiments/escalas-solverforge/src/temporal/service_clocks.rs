//! Public clock syntax is separate from date/person admissibility.
//! Illegal alternatives stay represented for identity and history, but never
//! enter a legal daily domain. Paid pauses are not meals or timed service.
use super::{Clock,V,Result,array,check,identifier,number,range,text};
#[derive(Clone,Debug)]
pub(super) struct Admission{meal:i32,block:i32,long:bool}
impl Admission{
    pub(super) fn allowed(&self,c:&Clock,policy:Policy,mixed:bool)->bool{
        let long=mixed&&self.long;
        if c.end>policy.closing||c.end>1440||mixed&&c.paid!=480&&!long{return false;}
        if !long&&c.paid>policy.daily{return false;}
        if c.paid>480&&!policy.simulation&&!policy.compensation{return false;}
        if policy.limit_blocks&&self.block>270{return false;}
        if c.paid>360&&self.meal>policy.max_meal&&!policy.simulation&&!long{return false;}
        let required=if c.paid>360{policy.meal}else if c.paid>240&&!(policy.simulation&&policy.short_pause){15}else{0};
        self.meal>=required
    }
}
#[derive(Clone,Copy)]
pub(super) struct Policy{
    pub(super) closing:i32,pub(super) daily:i32,pub(super) meal:i32,pub(super) max_meal:i32,
    pub(super) simulation:bool,pub(super) compensation:bool,
    pub(super) short_pause:bool,pub(super) limit_blocks:bool,
}
pub(super) fn read(row:&V)->Result<(Clock,Admission)>{
    let raw=array(row,"segments")?;check((1..=12).contains(&raw.len()),"CLOCK_KIND")?;
    check(text(&raw[0],"kind")?!="BREAK"&&text(raw.last().unwrap(),"kind")?!="BREAK","CLOCK_KIND")?;
    let start=number(&raw[0],"start")?;check(range(start,0,1439),"CLOCK_GEOMETRY")?;
    let(mut end,mut paid,mut meal,mut block,mut longest)=(start,0,0,0,0);
    let mut segments=Vec::<(i32,i32)>::new();
    for raw in raw{
        let a=number(raw,"start")?;let b=number(raw,"end")?;
        check(range(a,0,2879)&&range(b,1,2880)&&a==end&&a<b,"CLOCK_GEOMETRY")?;
        match text(raw,"kind")?{
            "WORK"=>{
                paid+=b-a;block+=b-a;
                if let Some(last)=segments.last_mut().filter(|last|last.1==a){last.1=b;}
                else{segments.push((a,b));}
            },
            "PAID_BREAK"=>{paid+=b-a;block+=b-a;},
            "BREAK"=>{meal=meal.max(b-a);longest=longest.max(block);block=0;},
            _=>return Err("CLOCK_KIND")
        }
        end=b;
    }
    longest=longest.max(block);
    check(range(paid,1,600)&&end-start<=1080,"CLOCK_GEOMETRY")?;
    // Overnight carry-in/out remains a separate unsupported contract.
    check(end<=1440,"OVERNIGHT_CONTEXT_PENDING")?;
    let long=raw.len()==3&&text(&raw[0],"kind")?=="WORK"&&text(&raw[1],"kind")?=="BREAK"
        &&text(&raw[2],"kind")?=="WORK"&&number(&raw[0],"end")?-start==270
        &&number(&raw[1],"end")?-number(&raw[1],"start")?==180
        &&end-number(&raw[2],"start")?==270;
    Ok((Clock{id:identifier(row,"id")?.to_owned(),segments,paid,start,end},Admission{meal,block:longest,long}))
}
