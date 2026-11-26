/** Three engines, one frozen envelope and original product evaluator.
 * A separate Rust PR, never import the Timefold implementation into its source.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { newInput,newEmployee } from "../../../src/components/escalas/workspace-model";
import { escalaInputSchema } from "../../../src/lib/escalas/schema";
import { generationScenarioBasis } from "../../../src/lib/escalas/hours-reference";
import { restPairSummary } from "../../../src/lib/escalas/rest-quality";
import { dateRange, dayOfWeek, visibleDates } from "../../../src/lib/escalas/dates";
import type { EscalaInput } from "../../../src/lib/escalas/types";
import { arch } from "node:os";
import { makeScenario, type ScenarioId, type Scenario } from "./fixtures";
import { captureEnvelope, digest, envelopeProfile, runTrial, type Adapter } from "./core";
import { baselineRevision, dockerAdapter, inspectImage, resources, solverforgeAdapter, temporalForgeAdapter, validateBaselineEnvelope, type ForgeTelemetry } from "./docker";
import { compareRosterCoverage, coverageQuality, selectVerifiedRoster, type RosterSelectionReason } from "../../../src/lib/escalas/roster-quality";

const CONTROL = "71945cd6e73c48b424dab1297fbc3bf8a15ae585";
const CASES = ["team-10-week", "branch-50-four-weeks", "team-10-week-repair"] as const;
const ORDERS = [
  ["ortools","timefold","solverforge"], ["ortools","solverforge","timefold"],
  ["timefold","ortools","solverforge"], ["timefold","solverforge","ortools"],
  ["solverforge","ortools","timefold"], ["solverforge","timefold","ortools"],
] as const;
type Engine = typeof ORDERS[number][number];
type Trial = Awaited<ReturnType<typeof runTrial>>;

function git(args: string[]) {
  const result = spawnSync("git", ["-C", "..", ...args], {encoding:"utf8", timeout:5000, killSignal:"SIGKILL"});
  if (result.error || result.status !== 0) throw Error("FORGE_GIT_IDENTITY");
  return result.stdout.trim();
}
function source() {
  if (git(["status","--porcelain","--untracked-files=normal"])) throw Error("FORGE_DIRTY_SOURCE");
  git(["diff","--quiet",baselineRevision,"--","web/src","web/ops/escalas","web/package-lock.json",
    "web/scripts/escalas/benchmark-metrics.ts","web/scripts/escalas/benchmark-synthetic.ts",
    ":(exclude)web/src/lib/escalas/cross-engine.test.ts"]);
  git(["diff","--quiet",CONTROL,"--","web/scripts/escalas/cross-engine/core.ts","web/scripts/escalas/cross-engine/fixtures.ts"]);
  return {revision:git(["rev-parse","HEAD"]),evaluatorTree:git(["rev-parse",baselineRevision+":web/src/lib/escalas"]),
    comparatorBlob:git(["rev-parse",CONTROL+":web/scripts/escalas/cross-engine/core.ts"])};
}
function valid(trial: Trial) {
  return trial.engineNew && trial.timely && trial.rawAssessment?.valid === true && trial.rawAssessment.complete
    && trial.finalAssessment?.valid === true && trial.finalAssessment.complete && trial.proposal !== undefined
    && trial.processSeconds !== null && trial.processSeconds <= 12.1 && trial.cgroup !== null;
}
function compare(before:Trial,after:Trial) {
  if (!valid(before)||!valid(after)||!before.proposal||!after.proposal)
    return {comparable:false,regressed:null,improved:null,retained:null,reason:"NOT_COMPARABLE",productReason:null};
  const coverage=compareRosterCoverage(before.proposal,after.proposal,before.proposal);
  let reason:RosterSelectionReason|undefined;
  const selected=selectVerifiedRoster(before.proposal,after.proposal,r=>{reason=r;});
  if (!reason) throw Error("FORGE_SELECTION_MISSING");
  const loss=coverage.regression;
  return {comparable:coverage.comparable,regressed:coverage.regressed,improved:coverage.improved,
    retained:selected.retainedReference,reason:coverage.reason,productReason:reason,
    ...(loss?{regression:{metric:loss.metric,scope:loss.scope,before:loss.before,after:loss.after,delta:loss.delta}}:{})};
}

// Independent client-path qualification for the *admitted* E3a subset.
// The historical Timefold control deliberately lacks these personal settings;
// do not weaken its frozen input or claim a three-engine E3 comparison.
const PERSONAL_MODES=["DAYS_AND_HOURS","REST_ONLY","HOURS_ONLY"] as const;
function personalScenario(mode:typeof PERSONAL_MODES[number]):Scenario {
  const corpus=JSON.parse(readFileSync("experiments/escalas-solverforge/src/e3a-fixed-clock-contract.json","utf8"));
  if(corpus.version!=="E3A-FIXED-CLOCK-1")throw Error("FORGE_PERSONAL_CORPUS");
  const raw=corpus.base.input as EscalaInput;
  const defaults=newInput("SYNTH","Synthetic personal settings","2026-11",42);
  const input:EscalaInput={...defaults,...raw,visibleMonth:undefined,generationMode:mode,
    policy:{...defaults.policy,...raw.policy,validFrom:raw.startDate,validUntil:raw.endDate},
    shifts:raw.shifts.map(shift=>({...shift,name:shift.id})),
    employees:raw.employees.map((person,i)=>({...newEmployee(person.weeklyHours,person.shiftIds),
      ...person,registration:String(i)})),
    demands:dateRange(raw.startDate,raw.endDate).map((date,i)=>({
      id:"personal-floor-"+i,date,sector:"S",start:480,end:540,minimum:1,estimated:false
    }))};
  if(mode==="HOURS_ONLY"){
    const days=dateRange(input.startDate,input.endDate);
    const off=[[0,1],[2,5],[0,3]];
    input.assignments=input.employees.flatMap((person,i)=>days.map((date,d)=>{
      const locked=d===6;
      return {employeeId:person.id,date,locked,...(off[i].includes(d)?{kind:"OFF" as const}:
        {kind:"WORK" as const,shiftId:i===0&&!locked?"clock-42":"clock-"+person.weeklyHours})};
    }));
  }
  const parsed=escalaInputSchema.parse(input);
  // Already-prepared synthetic profile, with the actual client contract and
  // immutable original evaluator; never forge a response or copy a solver.
  const prepared={...parsed,needsRegeneration:false,generationBasis:generationScenarioBasis(parsed)};
  return {id:"team-10-week",prepared};
}
function personalChecks(scenario:Scenario,trial:Trial){
  if(!valid(trial)||!trial.proposal) return false;
  const rows=trial.proposal.assignments;
  for(const [i,p] of scenario.prepared.employees.entries()){
    const days=rows.filter(row=>row.employeeId===p.id).sort((a,b)=>a.date.localeCompare(b.date));
    if(days.length!==7||days.filter(row=>row.kind==="WORK").length!==5||days[6].kind!=="WORK")return false;
    if(days.some(row=>row.kind==="WORK"&&row.shiftId!=="clock-"+p.weeklyHours))return false;
    if(i===0&&(days[1].kind!=="OFF"||days[0].kind!=="OFF"&&days[2].kind!=="OFF"))return false;
    if(i===1&&(days[2].kind!=="OFF"||days[5].kind!=="OFF"))return false;
  }
  if(scenario.prepared.generationMode==="HOURS_ONLY"){
    const before=new Map(scenario.prepared.assignments.map(row=>[row.employeeId+"\\0"+row.date,row]));
    if(rows.some(row=>{
      const old=before.get(row.employeeId+"\\0"+row.date);
      return !old||old.kind!==row.kind||old.locked!==row.locked||old.locked&&old.shiftId!==row.shiftId;
    }))return false;
  }
  return true;
}

// The frozen E2 evaluator exports coverageAudit only for 7/28 days.
// Reconstruct the same independent aggregate on the validated 42-day proposal,
// without changing the pinned core or fabricating raw measurements.
function scaleCoverageAudit(trial:Trial,comparison=false){
  if(!valid(trial)||!trial.proposal)return null;
  const input=trial.proposal,days=dateRange(input.startDate,input.endDate),visible=new Set(visibleDates(input));
  const cutover=input.startDate==="2026-12-01"&&input.endDate==="2026-12-31"&&input.planningWeekStartsOn==="SUNDAY";
  const quality=coverageQuality(input,comparison&&cutover?days.slice(5):days);
  const sectors=[...new Set([...input.employees.map(p=>p.sector),...input.demands.map(d=>d.sector)])].sort();
  return sectors.map(sector=>{
    let horizon=0,month=0,sundays=0,monthSundays=0,closing=0;
    const presence:number[]=[];
    for(const [i,day] of days.entries()){
      const key=sector+"\0"+day,gap=quality.daily.get(key)??0;
      horizon+=gap;if(visible.has(day))month+=gap;
      if(dayOfWeek(day)===6){sundays+=gap;if(visible.has(day))monthSundays+=gap;}
      closing+=quality.closing.get(key)??0;
      if(quality.present.has(day+"\0"+sector))presence.push(i);
    }
    return {horizon,month,sundays,monthSundays,closing,peak:quality.peaks.get(sector)??0,presence};
  });
}

function scaleRestAudit(trial:Trial){
  if(!valid(trial)||!trial.proposal)return null;
  const r=restPairSummary(trial.proposal);
  return {adjustablePairs:r.adjustablePairs,correctableExcess:r.correctableExcess,
    concentration:r.concentration,weeklyRepetitions:r.weeklyRepetitions};
}

const TEMPORAL_CASES=["mixed-variable","holiday-absence-history","hours-only","rest-only","combined-115-six-weeks","combined-250-six-weeks",
  "night-same-day","weekly-transition-42","weekly-transition-40","monthly-cutover-december","cross-sector-leadership"] as const;
type TemporalCase=typeof TEMPORAL_CASES[number];
function combinedSize(name:TemporalCase){return name==="combined-115-six-weeks"?115:name==="combined-250-six-weeks"?250:0;}
function temporalScenario(name:TemporalCase):Scenario{
  const size=combinedSize(name);
  if(size)return combinedTemporalScenario(size);
  if(name==="night-same-day"||name==="weekly-transition-42"||name==="weekly-transition-40"||name==="monthly-cutover-december"||name==="cross-sector-leadership")return extendedTemporalScenario(name);
  const input=newInput("SYNTH","Synthetic temporal settings","2026-11",42);
  Object.assign(input,{startDate:"2026-11-01",endDate:"2026-11-07",visibleMonth:undefined,
    simulation:true,restRulesVersion:3,storeClosingMinutes:1200,generationMode:name==="hours-only"?"HOURS_ONLY":name==="rest-only"?"REST_ONLY":"DAYS_AND_HOURS",
    mixed42Sectors:["S"]});
  Object.assign(input.policy,{calendarMode:"MANUAL",validFrom:input.startDate,validUntil:input.endDate});
  const shift=(id:string,start:number,block:number,meal:number):EscalaInput["shifts"][number]=>({id,name:id,segments:[
    {kind:"WORK",start,end:start+block},{kind:"BREAK",start:start+block,end:start+block+meal},
    {kind:"WORK",start:start+block+meal,end:start+2*block+meal}]});
  input.shifts=[shift("eight",420,240,60),shift("nine",420,270,180),shift("late",480,240,60)];
  input.employees=Array.from({length:3},(_,i)=>({...newEmployee(42,["eight","nine","late"]),
    id:"person-"+i,name:"Synthetic person "+i,registration:String(i),sector:"S",role:"Repositor",scheduleMode:"TIMED" as const}));
  input.demands=[{id:"late-demand",date:"2026-11-04",sector:"S",start:1050,end:1140,minimum:1,estimated:false}];
  if(name==="holiday-absence-history"){
    // The frozen product admits paid closed holidays only on Jan 1, May 1
    // and Dec 25. May 1 keeps this fixture before the weekly-law transition.
    input.startDate="2026-04-26";input.endDate="2026-05-02";
    Object.assign(input.policy,{validFrom:input.startDate,validUntil:input.endDate,
      holidayDates:["2026-05-01"],closedDates:["2026-05-01"],paidHolidayDates:["2026-05-01"]});
    input.demands[0].date="2026-04-29";
    input.employees[0].historyKnown=true;
    input.employees[0].history=[{employeeId:"person-0",date:"2026-04-19",kind:"WORK",shiftId:"eight"}];
    input.assignments=[{employeeId:"person-0",date:"2026-04-30",kind:"ABSENCE",locked:true,absenceSource:"MANUAL"}];
  }
  if(name==="hours-only"){
    const off=[[0,2],[1,4],[0,3]];
    input.assignments=input.employees.flatMap((p,i)=>dateRange(input.startDate,input.endDate).map((date,d)=>
      ({employeeId:p.id,date,locked:d===6,...(off[i].includes(d)?{kind:"OFF" as const}:{kind:"WORK" as const,shiftId:d===2||d===5?"nine":"eight"})})));
    // Ensure every original grid has exactly two long workdays.
    for(const p of input.employees){
      const work=input.assignments.filter(a=>a.employeeId===p.id&&a.kind==="WORK");
      work.forEach((a,i)=>{a.shiftId=i<2?"nine":"eight";});
    }
  }
  const parsed=escalaInputSchema.parse(input);
  return {id:"team-10-week",prepared:{...parsed,needsRegeneration:false,generationBasis:generationScenarioBasis(parsed)}};
}

type ExtendedCase="night-same-day"|"weekly-transition-42"|"weekly-transition-40"|"monthly-cutover-december"|"cross-sector-leadership";
function extendedTemporalScenario(name:ExtendedCase):Scenario{
  const hours=name==="night-same-day"||name==="cross-sector-leadership"?40:name==="weekly-transition-40"?42:44;
  const input=newInput("SYNTH","Synthetic dated and protected temporal settings","2026-11",hours);
  Object.assign(input,{startDate:"2026-11-01",endDate:"2026-11-07",visibleMonth:undefined,
    simulation:true,restRulesVersion:3,storeClosingMinutes:name==="night-same-day"?1380:1200,
    generationMode:"DAYS_AND_HOURS"});
  const shift=(id:string,start:number,block:number):EscalaInput["shifts"][number]=>({id,name:id,segments:[
    {kind:"WORK",start,end:start+block},{kind:"BREAK",start:start+block,end:start+block+60},
    {kind:"WORK",start:start+block+60,end:start+2*block+60}]});
  if(name==="night-same-day")input.shifts=[shift("night",840,240)];
  else if(name==="cross-sector-leadership")input.shifts=[shift("day",420,240)];
  else if(name==="weekly-transition-40"){
    input.startDate="2027-12-12";input.endDate="2027-12-18";
    input.shifts=[shift("before",420,252),shift("after",420,240)];
  }else{
    input.startDate=name==="monthly-cutover-december"?"2026-12-01":"2026-12-13";
    input.endDate=name==="monthly-cutover-december"?"2026-12-31":"2026-12-19";
    if(name==="monthly-cutover-december"){
      input.visibleMonth="2026-12";
      input.policy.closedDates=["2026-12-25"];input.policy.holidayDates=["2026-12-25"];
      input.policy.paidHolidayDates=["2026-12-25"];
    }
    input.shifts=[shift("before",420,264),shift("after",420,252)];
  }
  Object.assign(input.policy,{calendarMode:"MANUAL",validFrom:input.startDate,validUntil:input.endDate,transitionWeekAccepted:true});
  input.employees=Array.from({length:3},(_,i)=>({...newEmployee(hours,input.shifts.map(s=>s.id)),
    id:"person-"+i,name:"Synthetic person "+i,registration:String(i),sector:"S",role:"Repositor",scheduleMode:"TIMED" as const}));
  const day=name==="weekly-transition-42"||name==="monthly-cutover-december"?"2026-12-16":
    name==="weekly-transition-40"?"2027-12-16":"2026-11-04";
  input.demands=[{id:"d",date:day,sector:"S",start:name==="night-same-day"?1320:480,
    end:name==="night-same-day"?1380:540,minimum:1,estimated:false}];
  if(name==="cross-sector-leadership"){
    Object.assign(input.employees[0],{scheduleMode:"UNTIMED",shiftIds:[],role:"Gerente",
      leadership:{role:"BRANCH",source:"MANUAL",sectors:["S","T"]}});
    input.employees[2].sector="T";
    input.assignments=[{employeeId:"person-0",date:day,kind:"DUTY",locked:true}];
    input.movementPriorities=[{startDate:day,endDate:day,level:"HIGH"}];
    input.demands.push({id:"d-t",date:day,sector:"T",role:"Repositor",start:480,end:540,minimum:1,estimated:false});
  }
  const parsed=escalaInputSchema.parse(input);
  return {id:"team-10-week",prepared:{...parsed,needsRegeneration:false,generationBasis:generationScenarioBasis(parsed)}};
}
function combinedTemporalScenario(size:number):Scenario{
  const input=newInput("SYNTH","Synthetic six-week combined temporal","2026-11",42);
  Object.assign(input,{startDate:"2026-04-05",endDate:"2026-05-16",visibleMonth:undefined,
    simulation:true,restRulesVersion:3,storeClosingMinutes:1200,generationMode:"DAYS_AND_HOURS"});
  const holiday="2026-05-01";
  Object.assign(input.policy,{calendarMode:"MANUAL",validFrom:input.startDate,validUntil:input.endDate,
    closedDates:[holiday],holidayDates:[holiday],paidHolidayDates:[holiday]});
  const shift=(id:string,start:number,block:number,meal:number):EscalaInput["shifts"][number]=>({id,name:id,segments:[
    {kind:"WORK",start,end:start+block},{kind:"BREAK",start:start+block,end:start+block+meal},
    {kind:"WORK",start:start+block+meal,end:start+2*block+meal}]});
  input.shifts=[shift("eight",420,240,60),shift("nine",420,270,180),shift("late",480,240,60),
    shift("fortyfour",420,264,60),shift("fortyfour-late",480,264,60)];
  input.employees=Array.from({length:size},(_,i)=>{
    const sector="Sector "+(Math.floor(i/12)+1),untimed=i%12===0;
    const hours=i%3===1?40:i%3===2?44:42;
    const clocks=untimed?[]:hours===40?["eight","late"]:hours===44?["fortyfour","fortyfour-late"]:["eight","nine","late"];
    const id="person-"+i;
    const person:EscalaInput["employees"][number]={...newEmployee(hours,clocks),id,registration:String(i),
      name:"Synthetic person "+i,sector,role:untimed?"Encarregado":"Repositor",scheduleMode:untimed?"UNTIMED":"TIMED",
      ...(untimed?{leadership:{role:"SECTOR",source:"MANUAL",sectors:[sector]}}:{})};
    if(i%12===0||i%12===3){
      person.historyKnown=true;
      person.history=[untimed?{employeeId:id,date:"2026-03-29",kind:"DUTY"}:
        {employeeId:id,date:"2026-03-29",kind:"WORK",shiftId:clocks[0]}];
    }
    return person;
  });
  const sectors=[...new Set(input.employees.map(p=>p.sector))];
  input.mixed42Sectors=sectors;
  input.movementPriorities=[{startDate:"2026-04-08",endDate:"2026-04-08",level:"HIGH"}];
  input.assignments=input.employees.filter((_,i)=>i%12===1).map(p=>({employeeId:p.id,date:"2026-04-16",
    kind:"ABSENCE" as const,locked:true,absenceSource:"MANUAL" as const}));
  // Explicitly retain one timed clock and one duty in each sector.
  for(const p of input.employees.filter((_,i)=>i%12===0||i%12===2)){
    input.assignments.push(p.scheduleMode==="UNTIMED"?{employeeId:p.id,date:"2026-04-08",kind:"DUTY",locked:true}:
      {employeeId:p.id,date:"2026-04-08",kind:"WORK",shiftId:p.shiftIds[0],locked:true});
  }
  const days=dateRange(input.startDate,input.endDate);
  input.demands=sectors.flatMap((sector,s)=>days.flatMap((date,d)=>{
    if(date===holiday)return [];
    const base:EscalaInput["demands"]=[{id:"coverage-"+s+"-"+d,date,sector,start:480,end:540,minimum:3,estimated:true}];
    if(dayOfWeek(date)===6)base.push({id:"sunday-"+s+"-"+d,date,sector,start:1050,end:1140,minimum:1,estimated:true});
    if(date==="2026-04-08")base.push({id:"confirmed-"+s,date,sector,role:"Repositor",start:480,end:540,minimum:1,estimated:false});
    return base;
  }));
  const parsed=escalaInputSchema.parse(input);
  return {id:size===115?"branch-115-six-weeks":"stress-250-six-weeks",
    prepared:{...parsed,needsRegeneration:false,generationBasis:generationScenarioBasis(parsed)}};
}
function combinedChecks(scenario:Scenario,trial:Trial){
  if(!valid(trial)||!trial.proposal)return false;
  const input=scenario.prepared,rows=trial.proposal.assignments,days=dateRange(input.startDate,input.endDate);
  const byPerson=new Map<string,EscalaInput["assignments"]>();
  for(const a of rows){const list=byPerson.get(a.employeeId)??[];list.push(a);byPerson.set(a.employeeId,list);}
  const lookup=new Map(rows.map(a=>[a.employeeId+"\0"+a.date,a]));
  for(const old of input.assignments){
    const next=lookup.get(old.employeeId+"\0"+old.date);
    if(!next||next.kind!==old.kind||next.shiftId!==old.shiftId||next.locked!==old.locked)return false;
    if(old.absenceSource&&next.absenceSource!==old.absenceSource)return false;
  }
  const paid=input.policy.paidHolidayDates??[];
  for(const p of input.employees){
    const roster=byPerson.get(p.id);
    if(!roster||roster.length!==days.length)return false;
    const ordered=days.map(day=>lookup.get(p.id+"\0"+day)!);
    if(ordered.some(a=>!a))return false;
    if(ordered.some(a=>paid.includes(a.date)&&a.kind!=="HOLIDAY"))return false;
    if(p.history.length&&["WORK","DUTY"].includes(ordered[0].kind))return false;
    if(p.scheduleMode==="UNTIMED"){
      if(ordered.some(a=>a.kind==="WORK"||a.shiftId!==undefined))return false;
    }else if(ordered.some(a=>a.kind==="DUTY"||a.kind==="WORK"&&!p.shiftIds.includes(a.shiftId??"")))return false;
    for(let w=0;w<days.length;w+=7){
      const week=ordered.slice(w,w+7);
      if(week.some(a=>["ABSENCE","HOLIDAY"].includes(a.kind)))continue;
      if(p.scheduleMode==="UNTIMED"){
        if(week.filter(a=>a.kind==="DUTY").length!==5)return false;
      }else{
        const work=week.filter(a=>a.kind==="WORK");
        if(work.length!==5||p.weeklyHours===42&&work.filter(a=>a.shiftId==="nine").length!==2)return false;
        const minutes=work.reduce((n,a)=>n+(input.shifts.find(s=>s.id===a.shiftId)?.segments
          .filter(s=>s.kind==="WORK").reduce((sum,s)=>sum+s.end-s.start,0)??0),0);
        if(minutes!==p.weeklyHours*60)return false;
      }
    }
  }
  return true;
}
function temporalTieAudit(trial:Trial){
  if(!valid(trial)||!trial.proposal)return null;
  return trial.proposal.assignments.reduce((sum,a)=>sum+(a.kind==="OFF"?parseInt(digest(a.employeeId+":"+a.date).slice(0,6),16)%97:0),0);
}
function temporalChecks(name:TemporalCase,scenario:Scenario,trial:Trial){
  if(combinedSize(name))return combinedChecks(scenario,trial);
  if(name==="night-same-day"||name==="weekly-transition-42"||name==="weekly-transition-40"||name==="monthly-cutover-december"||name==="cross-sector-leadership"){
    if(!valid(trial)||!trial.proposal)return false;
    const rows=trial.proposal.assignments,input=scenario.prepared;
    if(name==="cross-sector-leadership")return rows.some(a=>a.employeeId==="person-0"&&a.date==="2026-11-04"&&a.kind==="DUTY"&&a.locked)
      &&!rows.some(a=>a.employeeId==="person-0"&&a.kind==="WORK")
      &&["person-1","person-2"].every(id=>rows.some(a=>a.employeeId===id&&a.date==="2026-11-04"&&a.kind==="WORK"));
    const paid=(own:EscalaInput["assignments"])=>own.reduce((sum,a)=>sum+
      (input.shifts.find(s=>s.id===a.shiftId)?.segments.filter(s=>s.kind==="WORK").reduce((n,s)=>n+s.end-s.start,0)??0),0);
    for(const p of input.employees){
      const own=rows.filter(a=>a.employeeId===p.id);
      if(name==="monthly-cutover-december"){
        if(own.length!==31||own.filter(a=>a.date<="2026-12-05"&&a.kind==="WORK").length!==3
          ||own.filter(a=>a.date<="2026-12-05"&&a.kind==="OFF").length!==2
          ||paid(own.filter(a=>a.date>="2026-12-06"&&a.date<="2026-12-12"))!==2640
          ||paid(own.filter(a=>a.date>="2026-12-13"&&a.date<="2026-12-19"))!==2520
          ||own.some(a=>a.date>="2026-12-16"&&a.shiftId==="before")
          ||!own.some(a=>a.date==="2026-12-25"&&a.kind==="HOLIDAY"))return false;
      }else{
        const required=name==="weekly-transition-42"?2520:2400;
        if(own.length!==7||own.filter(a=>a.kind==="WORK").length!==5||paid(own)!==required
          ||own.some(a=>a.kind==="WORK"&&a.shiftId!==(name==="night-same-day"?"night":"after")))return false;
      }
    }
    return true;
  }
  if(!valid(trial)||!trial.proposal)return false;
  const rows=trial.proposal.assignments,old=scenario.prepared.assignments;
  const lookup=new Map(rows.map(a=>[a.employeeId+"\0"+a.date,a]));
  if(name==="hours-only"&&old.some(a=>{const b=lookup.get(a.employeeId+"\0"+a.date);return !b||a.kind!==b.kind||a.locked&&a.shiftId!==b.shiftId;}))return false;
  if(name==="holiday-absence-history"){
    if(rows.filter(a=>a.date==="2026-05-01"&&a.kind==="HOLIDAY").length!==3)return false;
    const absent=lookup.get("person-0\0"+"2026-04-30");
    if(absent?.kind!=="ABSENCE"||lookup.get("person-0\0"+"2026-04-26")?.kind==="WORK")return false;
  }else{
    for(const p of scenario.prepared.employees){
      const own=rows.filter(a=>a.employeeId===p.id&&a.kind==="WORK");
      if(own.length!==5||own.filter(a=>a.shiftId==="nine").length!==2)return false;
    }
  }
  if(name==="rest-only"&&rows.some(a=>a.shiftId==="late"))return false;
  return rows.some(a=>a.date===scenario.prepared.demands[0].date&&a.shiftId==="nine");
}

async function main() {
  if (arch()!=="arm64"||process.env.ESCALAS_CROSS_ENGINE_ISOLATED!=="1") throw Error("FORGE_ISOLATED_ARM64_REQUIRED");
  const [baseline,timefold,forge,mode,...extra]=process.argv.slice(2);
  if (!baseline||!timefold||!forge||extra.length||(mode!=="smoke"&&mode!=="paired"&&mode!=="curve"&&mode!=="tail"&&mode!=="personal"&&mode!=="scale"&&mode!=="temporal")) throw Error("FORGE_ARGS");
  const snapshot=source();
  const images={ortools:inspectImage(baseline,"ortools"),timefold:inspectImage(timefold,"timefold"),solverforge:inspectImage(forge,"solverforge")};
  if (images.ortools.revision!==baselineRevision||images.timefold.revision!==CONTROL||images.solverforge.revision!==snapshot.revision
    ||Object.values(images).some(x=>x.architecture!=="arm64")) throw Error("FORGE_IMAGE_IDENTITY");
  if(mode==="temporal"){
    let failures=0;
    for(const name of TEMPORAL_CASES){
      let stage="SCHEMA";
      try{
      const scenario=temporalScenario(name);
      stage="CAPTURE";
      const frozen=await captureEnvelope(scenario);
      stage="PREFLIGHT";
      validateBaselineEnvelope(baseline,frozen);
      stage="MEASURE";
      const cutover=name==="monthly-cutover-december";
      const profile={...envelopeProfile(frozen),visibleDays:visibleDates(scenario.prepared).length,cutover};
      const size=combinedSize(name)||3,days=combinedSize(name)?42:cutover?31:7;
      if(profile.includedOnWire!==size||profile.days!==days||profile.activePositions!==size*days
        ||(days===42&&(!profile.untimedPositions||profile.paidHolidayCount!==1))
        ||(cutover&&(profile.visibleDays!==31||profile.paidHolidayCount!==1)))throw Error("FORGE_TEMPORAL_PROFILE");
      const shared={...snapshot,scenario:name,inputHash:digest(frozen),baselineRevision,timefoldRevision:CONTROL,
        arch:arch(),resources,profile,sampleKind:"cold-container",hostCapacityMeasured:false,liveHttpMeasured:false};
      for(let repetition=0;repetition<2;repetition++){
        const names=repetition===0?["ortools","temporal"] as const:["temporal","ortools"] as const;
        const round:{variant:typeof names[number];trial:Trial;record:Record<string,unknown>}[]=[];
        for(const [position,variant] of names.entries()){
          const adapter=variant==="temporal"?temporalForgeAdapter(forge):null;
          const trial=await runTrial(scenario,frozen,adapter?adapter.adapter:dockerAdapter(baseline,"ortools"));
          if(trial.inputHash!==shared.inputHash)throw Error("FORGE_INPUT_DRIFT");
          const {proposal:_proposal,...record}=trial;
          round.push({variant,trial,record:{kind:"temporal",...shared,repetition,position,variant,
            identity:images[variant==="ortools"?"ortools":"solverforge"],temporal:adapter?.telemetry()??null,
            featureChecks:temporalChecks(name,scenario,trial),tieBreakAudit:temporalTieAudit(trial),
            scaleCoverageAudit:scaleCoverageAudit(trial),scaleRestAudit:scaleRestAudit(trial),
            comparisonCoverageAudit:cutover?scaleCoverageAudit(trial,true):null,...record}});
        }
        const control=round.find(x=>x.variant==="ortools")!.trial;
        for(const item of round)console.log(JSON.stringify({...item.record,againstOrtools:compare(control,item.trial)}));
      }
      }catch(error){
        failures++;
        // Every fixture is synthetic, but still log only known stage and
        // schema paths/codes, not messages, IDs or assignment contents.
        const issues=error&&typeof error==="object"&&"issues" in error&&Array.isArray(error.issues)
          ?error.issues.slice(0,12).map((issue:{path?:unknown;code?:unknown})=>({
            path:Array.isArray(issue.path)?issue.path.map(x=>typeof x==="number"?"[]":typeof x==="string"&&/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/.test(x)?x:"?").join("."):"",
            code:typeof issue.code==="string"&&/^[a-z_]+$/.test(issue.code)?issue.code:"unknown"})):[];
        const code=error instanceof Error&&/^(FORGE|CROSS_ENGINE)_[A-Z_]+$/.test(error.message)?error.message:"TEMPORAL_CASE_ERROR";
        console.error(JSON.stringify({event:"temporal-case-failed",scenario:name,stage,code,issues}));
      }
    }
    if(source().revision!==snapshot.revision)throw Error("FORGE_SOURCE_DRIFT");
    if(failures)throw Error("FORGE_TEMPORAL_CASE_FAILED");
    return;
  }
  if(mode==="scale"){
    // Frozen six-week fixtures. Historical Timefold E2 lacks this horizon.
    const variants=["ortools","native-12","adaptive"] as const;
    for(const id of ["branch-115-six-weeks","stress-250-six-weeks"] as const){
      const scenario=makeScenario(id),frozen=await captureEnvelope(scenario);
      validateBaselineEnvelope(baseline,frozen);
      const profile=envelopeProfile(frozen);
      const expected=id==="branch-115-six-weeks"?115:250;
      if(profile.days!==42||profile.includedOnWire!==expected||profile.activePositions!==expected*42)
        throw Error("FORGE_SCALE_PROFILE");
      const shared={...snapshot,scenario:id,inputHash:digest(frozen),baselineRevision,timefoldRevision:CONTROL,
        arch:arch(),resources,profile,sampleKind:"cold-container",hostCapacityMeasured:false,liveHttpMeasured:false};
      for(let repetition=0;repetition<3;repetition++){
        const round:{variant:typeof variants[number];trial:Trial;record:Record<string,unknown>}[]=[];
        for(let position=0;position<3;position++){
          const variant=variants[(repetition+position)%3];
          const rust=variant==="ortools"?null:solverforgeAdapter(forge,false,12,variant==="adaptive");
          const trial=await runTrial(scenario,frozen,rust?rust.adapter:dockerAdapter(baseline,"ortools"));
          if(trial.inputHash!==shared.inputHash)throw Error("FORGE_INPUT_DRIFT");
          const native=rust?.telemetry()??null;
          if(rust&&valid(trial)&&(!native||native.domainMode!=="BOUNDED_42"||native.entities!==expected
            ||native.positions!==profile.activePositions||native.finalCost[3]!==trial.finalAssessment?.metrics?.normalizedEstimatedShortage))
            throw Error("FORGE_SCALE_SCORE_DRIFT");
          const {proposal:_proposal,...record}=trial;
          round.push({variant,trial,record:{kind:"scale",...shared,repetition,position,variant,
            identity:images[variant==="ortools"?"ortools":"solverforge"],forge:native,scaleCoverageAudit:scaleCoverageAudit(trial),scaleRestAudit:scaleRestAudit(trial),...record}});
        }
        const cp=round.find(x=>x.variant==="ortools")!.trial;
        const full=round.find(x=>x.variant==="native-12")!.trial;
        for(const item of round)console.log(JSON.stringify({...item.record,againstOrtools:compare(cp,item.trial),
          againstNative12:compare(full,item.trial)}));
      }
    }
    if(source().revision!==snapshot.revision)throw Error("FORGE_SOURCE_DRIFT");
    return;
  }
  if(mode==="personal"){
    const variants=["ortools","native-12","adaptive"] as const;
    for(const personalMode of PERSONAL_MODES){
      const scenario=personalScenario(personalMode),frozen=await captureEnvelope(scenario);
      validateBaselineEnvelope(baseline,frozen);
      const profile=envelopeProfile(frozen);
      if(profile.includedOnWire!==3||profile.activePositions!==21||profile.mode!==personalMode)
        throw Error("FORGE_PERSONAL_PROFILE");
      const shared={...snapshot,scenario:"personal-"+personalMode,inputHash:digest(frozen),
        baselineRevision,timefoldRevision:CONTROL,arch:arch(),resources,profile,
        sampleKind:"cold-container",hostCapacityMeasured:false,liveHttpMeasured:false};
      for(let repetition=0;repetition<3;repetition++){
        const round:{variant:typeof variants[number];trial:Trial;record:Record<string,unknown>}[]=[];
        for(let position=0;position<3;position++){
          const variant=variants[(repetition+position)%3];
          const rust=variant==="ortools"?null:solverforgeAdapter(forge,false,12,variant==="adaptive");
          const trial=await runTrial(scenario,frozen,rust?rust.adapter:dockerAdapter(baseline,"ortools"));
          if(trial.inputHash!==shared.inputHash)throw Error("FORGE_INPUT_DRIFT");
          const {proposal:_proposal,...record}=trial;
          round.push({variant,trial,record:{kind:"personal",...shared,repetition,position,variant,
            identity:images[variant==="ortools"?"ortools":"solverforge"],forge:rust?.telemetry()??null,
            personalRulesPreserved:personalChecks(scenario,trial),...record}});
        }
        const cp=round.find(x=>x.variant==="ortools")!.trial;
        const native=round.find(x=>x.variant==="native-12")!.trial;
        for(const item of round)console.log(JSON.stringify({...item.record,againstOrtools:compare(cp,item.trial),
          againstNative12:compare(native,item.trial)}));
      }
    }
    if(source().revision!==snapshot.revision)throw Error("FORGE_SOURCE_DRIFT");
    return;
  }
  if (mode === "tail") {
    const scenario=makeScenario("branch-50-four-weeks");
    const frozen=await captureEnvelope(scenario);
    validateBaselineEnvelope(baseline,frozen);
    const profile=envelopeProfile(frozen);
    const shared={...snapshot,scenario:scenario.id,inputHash:digest(frozen),baselineRevision,timefoldRevision:CONTROL,
      arch:arch(),resources,profile,sampleKind:"cold-container",hostCapacityMeasured:false,liveHttpMeasured:false};
    const variants=["ortools","timefold","native-12","adaptive"] as const;
    for(let repetition=0;repetition<32;repetition++){
      const round:{variant:typeof variants[number];trial:Trial;record:Record<string,unknown>}[]=[];
      for(let position=0;position<variants.length;position++){
        const variant=variants[(repetition+position)%variants.length];
        const rust=variant==="native-12"||variant==="adaptive";
        const adapter=rust?solverforgeAdapter(forge,false,12,variant==="adaptive"):null;
        const engine=variant==="ortools"?"ortools":variant==="timefold"?"timefold":"solverforge";
        const trial=await runTrial(scenario,frozen,adapter?adapter.adapter:dockerAdapter(engine==="ortools"?baseline:timefold,engine,engine==="timefold"));
        if(trial.inputHash!==shared.inputHash) throw Error("FORGE_INPUT_DRIFT");
        const native=adapter?.telemetry()??null;
        if(rust&&valid(trial)&&(!native||native.finalCost[3]!==trial.finalAssessment?.metrics?.normalizedEstimatedShortage))
          throw Error("FORGE_INDEPENDENT_SCORE_DRIFT");
        const {proposal:_proposal,...record}=trial;
        round.push({variant,trial,record:{kind:"tail",...shared,repetition,position,variant,
          identity:images[engine],forge:native,...record}});
      }
      const cp=round.find(x=>x.variant==="ortools")!.trial;
      const java=round.find(x=>x.variant==="timefold")!.trial;
      const full=round.find(x=>x.variant==="native-12")!.trial;
      for(const item of round) console.log(JSON.stringify({...item.record,againstOrtools:compare(cp,item.trial),
        againstTimefold:compare(java,item.trial),againstNative12:compare(full,item.trial)}));
    }
    if(source().revision!==snapshot.revision) throw Error("FORGE_SOURCE_DRIFT");
    return;
  }
  if (mode === "curve") {
    const scenario = makeScenario("branch-50-four-weeks");
    const frozen = await captureEnvelope(scenario);
    validateBaselineEnvelope(baseline, frozen);
    const profile = envelopeProfile(frozen);
    const shared = {...snapshot,scenario:scenario.id,inputHash:digest(frozen),baselineRevision,timefoldRevision:CONTROL,
      arch:arch(),resources,profile,sampleKind:"cold-container",hostCapacityMeasured:false,liveHttpMeasured:false};
    const variants = [
      {id:"seed-only",seedOnly:true,budget:12,adaptive:false},
      ...[2,4,8,12].map(budget=>({id:"native-"+budget,seedOnly:false,budget,adaptive:false})),
      {id:"adaptive",seedOnly:false,budget:12,adaptive:true},
    ];
    // Every variant appears once in each position. This is an internal Rust
    // ablation, not a claim of equal-budget comparison with other engines.
    for (let repetition=0;repetition<variants.length;repetition++) {
      const round: {trial: Trial; record: Record<string,unknown>}[] = [];
      for (let position=0;position<variants.length;position++) {
        const variant=variants[(repetition+position)%variants.length];
        const adapter=solverforgeAdapter(forge,variant.seedOnly,variant.budget,variant.adaptive);
        const trial=await runTrial(scenario,frozen,adapter.adapter);
        const native=adapter.telemetry();
        if(trial.inputHash!==shared.inputHash) throw Error("FORGE_INPUT_DRIFT");
        if(valid(trial)&&(!native||native.budgetSeconds!==variant.budget||native.entities!==profile.includedOnWire
          ||native.positions!==profile.activePositions||native.finalCost[3]!==trial.finalAssessment?.metrics?.normalizedEstimatedShortage))
          throw Error("FORGE_INDEPENDENT_SCORE_DRIFT");
        const {proposal:_proposal,...record}=trial;
        round.push({trial,record:{kind:"curve",...shared,repetition,position,variant:variant.id,
          requestedBudgetSeconds:variant.budget,identity:images.solverforge,forge:native,...record}});
      }
      const seed=round.find(x=>x.record.variant==="seed-only")!.trial;
      const full=round.find(x=>x.record.variant==="native-12")!.trial;
      for (const item of round) console.log(JSON.stringify({...item.record,againstSeed:compare(seed,item.trial),againstNative12:compare(full,item.trial)}));
    }
    if(source().revision!==snapshot.revision) throw Error("FORGE_SOURCE_DRIFT");
    return;
  }
  const cases:readonly ScenarioId[]=mode==="smoke"?["team-10-week"]:CASES;
  for (const id of cases) {
    const scenario=makeScenario(id), frozen=await captureEnvelope(scenario);
    validateBaselineEnvelope(baseline,frozen);
    const profile=envelopeProfile(frozen);
    const shared={...snapshot,scenario:id,inputHash:digest(frozen),baselineRevision,timefoldRevision:CONTROL,
      arch:arch(),resources,profile,sampleKind:"cold-container",hostCapacityMeasured:false,liveHttpMeasured:false};
    const rust=solverforgeAdapter(forge), seed=solverforgeAdapter(forge,true);
    const adapters:Record<Engine,Adapter>={ortools:dockerAdapter(baseline,"ortools"),
      timefold:dockerAdapter(timefold,"timefold",id==="branch-50-four-weeks"),solverforge:rust.adapter};
    const rounds=mode==="smoke"?1:ORDERS.length;
    for(let repetition=0;repetition<rounds;repetition++) {
      const results=new Map<Engine,Trial>();
      for(const [position,engine] of ORDERS[repetition].entries()) {
        const trial=await runTrial(scenario,frozen,adapters[engine]);
        if(trial.inputHash!==shared.inputHash) throw Error("FORGE_INPUT_DRIFT");
        const native:ForgeTelemetry|null=engine==="solverforge"?rust.telemetry():null;
        if(engine==="solverforge"&&valid(trial)&&(!native||native.entities!==profile.includedOnWire
          ||native.positions!==profile.activePositions||native.finalCost[3]!==trial.finalAssessment?.metrics?.normalizedEstimatedShortage))
          throw Error("FORGE_INDEPENDENT_SCORE_DRIFT");
        const {proposal:_proposal,...record}=trial;
        console.log(JSON.stringify({kind:"measurement",...shared,engine,repetition,position,
          identity:images[engine],forge:native,...record}));
        results.set(engine,trial);
      }
      for(const [before,after] of [["ortools","timefold"],["ortools","solverforge"],["timefold","solverforge"]] as const) {
        console.log(JSON.stringify({kind:"comparison",...shared,before,after,repetition,
          ...compare(results.get(before)!,results.get(after)!)}));
      }
      if(id==="branch-50-four-weeks"&&mode==="paired") {
        const trial=await runTrial(scenario,frozen,seed.adapter);
        const native=seed.telemetry();
        if(valid(trial)&&(!native||native.entities!==profile.includedOnWire||native.positions!==profile.activePositions
          ||native.finalCost[3]!==trial.finalAssessment?.metrics?.normalizedEstimatedShortage)) throw Error("FORGE_SEED_SCORE_DRIFT");
        const {proposal:_proposal,...record}=trial;
        console.log(JSON.stringify({kind:"seed-control",...shared,repetition,identity:images.solverforge,
          forge:native,...record,againstNative:compare(trial,results.get("solverforge")!)}));
      }
    }
  }
  if(source().revision!==snapshot.revision) throw Error("FORGE_SOURCE_DRIFT");
}

main().catch((error:unknown)=>{
  console.error(error instanceof Error&&/^FORGE_[A-Z_]+$/.test(error.message)?error.message:"FORGE_COMPARISON_FAILED");
  process.exitCode=1;
});
