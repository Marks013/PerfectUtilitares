//! Bounded two-person Sunday trajectories from the selected legal domains.
//! Intermediate losses are never accepted; evaluate the full compound move.
use super::*;
const PER_SIGNATURE:usize=16;
type Buckets=BTreeMap<u8,Vec<u64>>;
fn signature(mask:u64)->u8{(0..6).fold(0,|s,w|s|(u8::from(worked(mask,w*7))<<w))}
fn options(p:&Employee,deadline:Instant)->Option<Buckets>{
    let old=p.mask()?;let mut out=Buckets::new();
    for (n,&index) in p.allowed.iter().enumerate(){
        if n.is_multiple_of(64)&&Instant::now()>=deadline{return None;}
        let mask=p.catalog[index];if !personal(p,old,mask){continue;}
        let rank=|m:u64|((old^m).count_ones(),p.rules.rest_quality(m,p.locked_off,42)[1],m);
        let bucket=out.entry(signature(mask)).or_default();
        let at=bucket.partition_point(|&m|rank(m)<=rank(mask));
        if at<PER_SIGNATURE{bucket.insert(at,mask);bucket.truncate(PER_SIGNATURE);}
    }
    Some(out)
}
fn projected(facts:&Sector,att:&Attendance,a:&Employee,sa:u8,b:&Employee,sb:u8)->bool{
    let bit_a=Presence::one(a.id);let bit_b=Presence::one(b.id);let mut gain=0;
    for band in facts.bands.iter().filter(|b|b.day.is_multiple_of(7)){
        let w=band.day/7;let old=att[band.day];let mut next=old&!bit_a&!bit_b;
        if sa&(1<<w)!=0{next|=bit_a;}
        if sb&(1<<w)!=0{next|=bit_b;}
        if band.gap_components(next).iter().zip(band.gap_components(old)).any(|(x,y)|*x>y){return false;}
        if band.estimated{gain+=(band.gap(old)-band.gap(next))*band.minutes;}
    }
    gain>0
}
pub(super) fn improve(plan:&mut Plan,group:&[usize],att:&mut Attendance,deadline:Instant,trials:&mut usize)->usize{
    let mut accepted=0;
    for _ in 0..2{
        if Instant::now()>=deadline||*trials>=MAX_TRIALS{break;}
        let rows:Vec<_>=group.iter().map(|&i|plan.employees[i].member()).collect();
        let before=group_cost(rows.iter());if before[1]==0{break;}
        let mut choices=Vec::with_capacity(group.len());
        for &i in group{
            if Instant::now()>=deadline{return accepted;}
            if plan.employees[i].pinned{choices.push(Buckets::new());continue;}
            let Some(value)=options(&plan.employees[i],deadline) else{return accepted;};choices.push(value);
        }
        let mut best=None;
        'pairs: for (a,&i) in group.iter().enumerate(){
            let p=&plan.employees[i];if p.pinned{continue;}
            for (b,&j) in group.iter().enumerate().skip(a+1){
                let peer=&plan.employees[j];
                if peer.pinned||peer.cohort!=p.cohort||peer.rest_group!=p.rest_group{continue;}
                for (&sa,left) in &choices[a]{for (&sb,right) in &choices[b]{
                    if Instant::now()>=deadline||*trials>=MAX_TRIALS{break 'pairs;}
                    if !projected(&p.facts,att,p,sa,peer,sb){continue;}
                    for &ma in left{for &mb in right{
                        if Instant::now()>=deadline||*trials>=MAX_TRIALS{break 'pairs;}
                        *trials+=1;
                        let mut trial=*att;apply(&mut trial,p,p.mask().unwrap(),ma);apply(&mut trial,peer,peer.mask().unwrap(),mb);
                        if !coverage_preserved(&p.facts,att,&trial){continue;}
                        let after=changed_cost(&rows,(a,ma),Some((b,mb)));
                        if acceptable(before,after)&&best.as_ref().is_none_or(|(cost,_,_,_,_)|after<*cost){best=Some((after,i,ma,j,mb));}
                    }}
                }}
            }
        }
        let Some((_,i,ma,j,mb))=best else{break;};
        for (id,mask) in [(i,ma),(j,mb)]{
            let old=plan.employees[id].mask().unwrap();apply(att,&plan.employees[id],old,mask);admit(&mut plan.employees[id],mask);
        }
        plan.score=None;accepted+=1;
    }
    accepted
}
