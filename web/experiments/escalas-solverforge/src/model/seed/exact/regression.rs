//! Exact compact reconstruction of the synthetic sector input and our own
//! constructor masks; no control-engine roster is used.
use serde_json::{json,Value};
pub(super) fn sector()->Value{
    let mut input:Value=serde_json::from_str(r#"{"planningWeekStartsOn":"SUNDAY","simulation":true,"coverageBasis":"coverage-v2:b776bbef224d351f","schemaVersion":1,"branchCode":"SYNTH","branchName":"Synthetic benchmark","startDate":"2026-11-01","endDate":"2026-12-12","restRulesVersion":3,"defaultWeeklyHours":42,"timeZone":"America/Sao_Paulo","policy":{"source":"","validFrom":"2026-11-01","validUntil":"2026-12-05","reviewed":false,"reviewedBy":"","weeklyLimit":44,"dailyLimitMinutes":528,"compensationAuthorized":false,"normativeProfile":"CUSTOM","transitionWeekAccepted":false,"coverageReview":"SUGGESTED","minInterShiftMinutes":660,"minWeeklyRestMinutes":2100,"minMealMinutes":60,"maxConsecutiveWorkDays":5,"allowShortMealSimulation":false,"limitContinuousWorkBlocks":true,"closedDates":[],"holidayDates":[],"calendarMode":"MANUAL","authorizedHolidayDates":[],"holidayRestAllowed":false,"nightWorkReviewed":false},"shifts":[{"id":"prep-53379ce8","name":"Proposta 8h24 · entrada mantida","segments":[{"start":420,"end":660,"kind":"WORK"},{"start":660,"end":780,"kind":"BREAK"},{"start":780,"end":1044,"kind":"WORK"}]}],"assignments":[],"storeClosingMinutes":1200}"#).unwrap();
    let template:Value=serde_json::from_str(r#"{"id":"person-24","registration":"24","name":"Synthetic person 24","sector":"Sector 3","role":"Encarregado","weeklyHours":42,"weeklyHoursMode":"INDIVIDUAL","shiftIds":["prep-53379ce8"],"activeFrom":"","fixedImportedShiftId":"prep-53379ce8","planningEnabled":true,"scheduleMode":"TIMED","sourceSchedule":{"report":"FPRE136","code":"SYNTHETIC","description":"Synthetic imported reference","weekday":"07:00-11:00 / 13:00-17:48","saturday":"07:00-11:00 / 00:00-00:00"},"offMode":"VARIABLE","fixedOffDays":[],"offPattern":"ANY","maxConsecutiveSundays":1,"preferredOffDays":[],"sundayRestRule":"PROTECTIVE","historyKnown":false,"history":[]}"#).unwrap();
    input["employees"]=Value::Array((24..36).map(|id|{
        let mut p=template.clone();p["id"]=json!(format!("person-{id}"));
        p["registration"]=json!(id.to_string());p["name"]=json!(format!("Synthetic person {id}"));
        p["role"]=json!(if id==24{"Encarregado"}else{"Repositor"});p
    }).collect());
    let floors:[[i32;42];2]=[[0,1,0,1,1,1,1,1,0,1,0,1,1,1,0,1,1,1,0,1,1,1,1,1,0,1,0,1,0,1,1,1,1,1,0,1,1,1,0,1,0,1],[6,8,8,8,8,9,8,5,9,8,8,8,8,9,6,8,9,8,8,8,8,5,9,8,9,8,8,8,6,8,9,8,8,8,8,5,8,8,9,8,9,8]];
    let mut demands=Vec::new();
    for (role,(name,values)) in ["Encarregado","Repositor"].iter().zip(floors).enumerate(){
        for (start,end) in [(420,660),(780,1044)]{
            for (day,minimum) in values.into_iter().enumerate(){
                let date=crate::wire::date(day);
                demands.push(json!({"id":format!("auto-{date}-{}-{start}",role+6),
                    "date":date,"sector":"Sector 3","role":name,"start":start,"end":end,
                    "minimum":minimum,"estimated":true}));
            }
        }
    }
    let order=[0,1,2,3,4,5,6,42,43,44,45,46,47,48,84,85,86,87,88,89,90,126,127,128,129,130,131,132,7,8,9,10,11,12,13,49,50,51,52,53,54,55,91,92,93,94,95,96,97,133,134,135,136,137,138,139,14,15,16,17,18,19,20,56,57,58,59,60,61,62,98,99,100,101,102,103,104,140,141,142,143,144,145,146,21,22,23,24,25,26,27,63,64,65,66,67,68,69,105,106,107,108,109,110,111,147,148,149,150,151,152,153,28,29,30,31,32,33,34,70,71,72,73,74,75,76,112,113,114,115,116,117,118,154,155,156,157,158,159,160,35,36,37,38,39,40,41,77,78,79,80,81,82,83,119,120,121,122,123,124,125,161,162,163,164,165,166,167];
    input["demands"]=Value::Array(order.into_iter().map(|i|demands[i].clone()).collect());
    json!({"input":input,"constructorMasks":[3152153393886u64,3811235952491u64,3019055672822u64,4078035201885u64,3778207529845u64,4221346609003u64,3228451974646u64,4083965949787u64,3770636810974u64,3261454842733u64,3706267282934u64,4222957106910u64]})
}
