"""Common sector regression algebra from frozen E2.5 control; triple-engine evidence."""
import json
import math
import re
import sys
from itertools import permutations
from statistics import median

SCENARIOS = ("team-10-week", "branch-50-four-weeks", "team-10-week-repair")
ENGINES = ("ortools", "timefold", "solverforge")
BASE = "f78c691edbeaf16283f534bcacd8db1b4b7d5e66"
RESOURCES = {"cpus": 1, "memoryMiB": 1536, "pids": 64}


class EvidenceError(ValueError):
    pass


def check(ok, code):
    if not ok:
        raise EvidenceError(code)


def numeric(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def integer(value):
    return type(value) is int and value >= 0


def sha(value, size):
    return isinstance(value, str) and re.fullmatch("[0-9a-f]{%d}" % size, value) is not None


def p50(values):
    # Six exploratory repetitions have an even sample count: use the midpoint
    # of the two central observations, not the lower nearest-rank quantile.
    return median(values) if values else None

def paired_stats(before, after):
    """Signed paired deltas (candidate minus reference); no invented ratio at zero."""
    check(len(before) == len(after), "PAIRED_SAMPLE_COUNT")
    deltas = [b - a for a, b in zip(before, after)]
    reductions = [100 * (a - b) / a for a, b in zip(before, after) if a > 0]
    return {"samples": len(deltas), "deltaP50": p50(deltas),
            "reductionPercentP50": p50(reductions), "positiveBaselineSamples": len(reductions)}


def assessment_valid(value):
    return (isinstance(value, dict) and value.get("valid") is True
            and value.get("complete") is True and value.get("errors") == [])


def verify_cgroup(sample):
    if sample is None:
        return None
    check(isinstance(sample, dict) and sample.get("version") == 2
          and sample.get("scope") == "container-before-response", "CGROUP_SCOPE")
    check(integer(sample.get("cpuUsageUsec")) and integer(sample.get("memoryPeakBytes"))
          and sample["memoryPeakBytes"] > 0 and sample.get("memoryLimitBytes") == RESOURCES["memoryMiB"] * 1024 * 1024
          and sample.get("pidsLimit") == RESOURCES["pids"] and integer(sample.get("cpuQuotaUsec"))
          and integer(sample.get("cpuPeriodUsec")) and sample["cpuPeriodUsec"] > 0
          and sample["cpuQuotaUsec"] == sample["cpuPeriodUsec"], "CGROUP_LIMITS")
    return sample


SCOPES = {"HORIZON", "MONTH", "SUNDAYS", "MONTH_SUNDAYS"}
COVERAGE_METRICS = {
    "SECTOR_COVERAGE": {"DEFICIT_PERSON_MINUTES"},
    "CLOSING_COVERAGE": {"CLOSING_DEFICIT_PERSON_MINUTES"},
    "SECTOR_PEAK": {"PEAK_MISSING"},
    "DAILY_PRESENCE": {"DAILY_PRESENCE"},
    "ROLE_TIME_COVERAGE": {"DEFICIT_PERSON_MINUTES", "PEAK_MISSING"},
    "ROLE_TIME_PRESENCE": {"SERVICE_PERSON_MINUTES"},
}


def sector_vector(metrics, profile, reconcile_shortage=True):
    vector = metrics.get("coverageAudit")
    check(isinstance(vector, list) and 0 < len(vector) <= profile["includedOnWire"] + 250, "COVERAGE_VECTOR")
    fields = ("horizon", "month", "sundays", "monthSundays", "closing", "peak")
    for sector in vector:
        check(isinstance(sector, dict) and set(sector) == {*fields, "presence"}
              and all(integer(sector[k]) for k in fields), "COVERAGE_VECTOR")
        # E2 covers the complete visible horizon. Temporal monthly
        # padding is reported independently instead of equated to the month.
        full=profile.get("visibleDays",profile["days"])==profile["days"]
        check((not full or sector["month"]==sector["horizon"] and sector["monthSundays"]==sector["sundays"])
              and sector["month"]<=sector["horizon"] and sector["monthSundays"]<=min(sector["sundays"],sector["month"])
              and sector["sundays"] <= sector["horizon"] and sector["closing"] <= sector["horizon"],
              "COVERAGE_VECTOR_TOTALS")
        presence = sector["presence"]
        check(isinstance(presence, list) and all(integer(day) and day < profile["days"] for day in presence)
              and presence == sorted(set(presence)), "COVERAGE_VECTOR_PRESENCE")
    if reconcile_shortage and profile.get("confirmedDemands") == 0:
        check(sum(row["horizon"] for row in vector) == metrics["normalizedEstimatedShortage"],
              "COVERAGE_VECTOR_SHORTAGE")
    return vector


def first_sector_regression(before, after):
    check(len(before) == len(after), "SECTOR_VECTOR_COUNT")
    for field, scope, metric, reason in (
            ("horizon", "HORIZON", "DEFICIT_PERSON_MINUTES", "SECTOR_COVERAGE"),
            ("month", "MONTH", "DEFICIT_PERSON_MINUTES", "SECTOR_COVERAGE"),
            ("sundays", "SUNDAYS", "DEFICIT_PERSON_MINUTES", "SECTOR_COVERAGE"),
            ("monthSundays", "MONTH_SUNDAYS", "DEFICIT_PERSON_MINUTES", "SECTOR_COVERAGE"),
            ("closing", "HORIZON", "CLOSING_DEFICIT_PERSON_MINUTES", "CLOSING_COVERAGE"),
            ("peak", "HORIZON", "PEAK_MISSING", "SECTOR_PEAK")):
        # The vectors are sorted by the same sector key used by the TS tie-break.
        losses = [(new[field] - old[field], old[field], new[field])
                  for old, new in zip(before, after) if new[field] > old[field]]
        if losses:
            delta, prior, current = max(losses, key=lambda item: item[0])
            return reason, dict(metric=metric, scope=scope, before=prior, after=current, delta=delta)
    if any(set(old["presence"]) - set(new["presence"]) for old, new in zip(before, after)):
        return "DAILY_PRESENCE", dict(metric="DAILY_PRESENCE", scope="HORIZON", before=1, after=0, delta=-1)
    return None


CONTROL = "71945cd6e73c48b424dab1297fbc3bf8a15ae585"
ORDERS = list(permutations(ENGINES))
PAIRS = [("ortools", "timefold"), ("ortools", "solverforge"), ("timefold", "solverforge")]


def verify_rest_metrics(rest):
    check(isinstance(rest, dict) and set(rest) == {"adjustablePairs", "correctableExcess", "concentration", "weeklyRepetitions"}
          and all(integer(v) for v in rest.values()) and rest["correctableExcess"] <= rest["adjustablePairs"],
          "REST_METRICS")


def valid(row, profile):
    check(numeric(row.get("engineSeconds")) and numeric(row.get("productSeconds"))
          and row["engineSeconds"] <= row["productSeconds"], "TIME")
    check(row.get("timely") is (row["engineSeconds"] <= 20 and row["productSeconds"] <= 20), "TIMELY")
    feasible = row.get("rawStatus") in ("FEASIBLE", "OPTIMAL")
    check(not feasible or assessment_valid(row.get("rawAssessment")), "INVALID_RAW")
    final = row.get("finalAssessment")
    check(row.get("finalStatus") not in ("FEASIBLE", "OPTIMAL") or assessment_valid(final), "INVALID_FINAL")
    if feasible:
        check(row.get("httpStatus") == 200 and numeric(row.get("processSeconds"))
              and row["processSeconds"] <= 12.1, "PROCESS")
    for a in (row.get("rawAssessment"), final):
        if assessment_valid(a):
            metrics = a["metrics"]
            check(integer(metrics.get("normalizedEstimatedShortage")), "SHORTAGE")
            if profile["days"]!=42 and (row.get("kind")!="temporal" or "coverageAudit" in metrics):
                sector_vector(metrics, profile)
                verify_rest_metrics(metrics.get("restAudit"))
    accepted = (row.get("errorCode") is None and row["timely"] and row.get("outcome") == "NEW_PROPOSAL"
                and row.get("unchangedReference") is False and assessment_valid(final)
                and (final.get("comparison") or {}).get("regressed") is not True)
    engine_new = accepted and row.get("sameAsRaw") is True and feasible and assessment_valid(row.get("rawAssessment"))
    check(row.get("acceptedNew") is accepted and row.get("engineNew") is engine_new, "ATTRIBUTION")
    if engine_new:
        check(row["rawAssessment"]["metrics"] == final["metrics"], "RAW_FINAL_DRIFT")
        if profile["days"]==42 or row.get("kind")=="temporal":
            # Frozen core only exports both vectors at the November E2
            # horizons. Require supplements from the same original evaluators.
            vector=sector_vector({**final["metrics"],"coverageAudit":row.get("scaleCoverageAudit")},profile)
            rest=row.get("scaleRestAudit")
            verify_rest_metrics(rest)
            if "coverageAudit" in final["metrics"]:
                check(vector==final["metrics"]["coverageAudit"] and rest==final["metrics"]["restAudit"],"SUPPLEMENT_DRIFT")
    sample = verify_cgroup(row.get("cgroup"))
    return engine_new and sample is not None


def verify_search_rounds(t,seed,adaptive,budget):
    policy=t.get("searchPolicy")
    reason=t.get("searchStopReason")
    rounds=t.get("searchRounds")
    check(policy in ("CONSTRUCTOR_ONLY","BOUNDED_ROUNDS","FULL_BUDGET")
          and (policy=="CONSTRUCTOR_ONLY")==seed
          and (policy!="BOUNDED_ROUNDS" or adaptive and t["seedComplete"])
          and isinstance(rounds,list) and len(rounds)<=budget
          and bool(rounds)==t["nativeSearch"] and t.get("stagnationApplied") is False,"SEARCH_POLICY")
    current=t["initialCost"]
    best=None
    for i,r in enumerate(rounds):
        check(isinstance(r,dict) and integer(r.get("budgetSeconds")) and 1<=r["budgetSeconds"]<=budget
              and numeric(r.get("seconds")) and r["seconds"]>0
              and r.get("beforeCost")==current and isinstance(r.get("candidateCost"),list)
              and len(r["candidateCost"])==13 and all(integer(v) for v in r["candidateCost"])
              and type(r.get("guardPreserved")) is bool and type(r.get("accepted")) is bool,"SEARCH_ROUND")
        if policy=="BOUNDED_ROUNDS":
            check(r["budgetSeconds"]<=2 and r["accepted"]==(r["guardPreserved"] and r["candidateCost"]<current)
                  and (r["accepted"] or i==len(rounds)-1),"ADAPTIVE_ROUND")
        else:
            check(policy=="FULL_BUDGET" and len(rounds)==1 and r["accepted"],"FULL_SEARCH")
        if r["accepted"]:
            current=r["candidateCost"]
            best=current
    check(sum(r["budgetSeconds"] for r in rounds)<=budget
          and sum(r["seconds"] for r in rounds)<=t["searchSeconds"]+.01
          and t.get("lastNativeCost")== (rounds[-1]["candidateCost"] if rounds else None)
          and current==t["finalCost"],"SEARCH_TRACE")
    if not rounds:
        check(reason in (("CONSTRUCTOR_ONLY",) if seed else ("PINNED","BUDGET_EXHAUSTED"))
              and t.get("nativeCost") is None,"SEARCH_STOP")
    elif policy=="FULL_BUDGET":
        check(reason=="FULL_SEARCH" and t.get("nativeCost")==best,"SEARCH_STOP")
    else:
        expected=("BUDGET_EXHAUSTED" if rounds[-1]["accepted"] else
                  "NO_IMPROVEMENT" if rounds[-1]["guardPreserved"] else "GUARD_REJECTED")
        check(reason==expected and t.get("nativeCost")== (best if best is not None else rounds[-1]["candidateCost"])
              and t.get("resultSource")==("NATIVE" if best is not None else "SEED_RETAINED"),"SEARCH_STOP")


def native(row, profile, seed=False, budget=12, adaptive=False):
    t = row.get("forge")
    check(isinstance(t, dict) and t.get("version") == "0.31.2" and t.get("partialModel") is True
          and t.get("budgetSeconds") == budget
          and t.get("mode") == ("SEED_ONLY" if seed else "ADAPTIVE" if adaptive else "NATIVE")
          and type(t.get("nativeSearch")) is bool and (adaptive or t["nativeSearch"] is (not seed))
          and t.get("entities") == profile["includedOnWire"] and t.get("positions") == profile["activePositions"]
          and integer(t.get("initialized")) and t["initialized"] <= t["entities"]
          and integer(t.get("allowedPatterns")) and t["entities"] <= t["allowedPatterns"] <= t["entities"] * 50625
          and type(t.get("seedComplete")) is bool and all(numeric(t.get(k)) for k in ("mapSeconds", "seedSeconds", "searchSeconds")),
          "NATIVE_TELEMETRY")
    for name in ("initialCost", "finalCost"):
        check(isinstance(t.get(name), list) and len(t[name]) == 13 and all(integer(v) for v in t[name]), "COST_VECTOR")
    check(t["finalCost"][0] == 0 and t["finalCost"][3] == row["finalAssessment"]["metrics"]["normalizedEstimatedShortage"],
          "NATIVE_SCORE_DRIFT")
    check(t["mapSeconds"] + t["seedSeconds"] + t["searchSeconds"] <= row["processSeconds"] + .01, "NATIVE_TIMING")
    # Cross-check every represented rest-quality term with the independent
    # product evaluator. No candidate-internal metric can certify itself.
    metrics=row["finalAssessment"]["metrics"]
    rest=row.get("scaleRestAudit") if profile.get("days")==42 else metrics.get("restAudit")
    check(isinstance(rest,dict) and all(integer(rest.get(k)) for k in
          ("correctableExcess","adjustablePairs","concentration","weeklyRepetitions"))
          and t["finalCost"][5:9]==[rest[k] for k in
          ("correctableExcess","adjustablePairs","concentration","weeklyRepetitions")],"REST_QUALITY_DRIFT")
    repair=t.get("repair")
    check(isinstance(repair,dict) and all(integer(repair.get(k)) for k in ("sectors","projections","reconstructed","accepted","projectionLimitHits"))
          and type(repair.get("deadlineReached")) is bool and repair["accepted"]<=repair["sectors"]
          and repair["accepted"]<=repair["reconstructed"] and repair["projectionLimitHits"]<=repair["sectors"],
          "REPAIR_TELEMETRY")
    rr=repair.get("rest")
    check(isinstance(rr,dict) and all(integer(rr.get(k)) for k in
        ("attempted","acceptedSingle","acceptedPair","beforePairs","afterPairs"))
        and rr["attempted"]<=200000 and rr["acceptedSingle"]+rr["acceptedPair"]<=rr["attempted"]
        and rr["afterPairs"]<=rr["beforePairs"]
        and type(rr.get("deadlineReached")) is bool and type(rr.get("limitReached")) is bool,"REST_REPAIR_TELEMETRY")
    peak=repair.get("peak")
    check(isinstance(peak,dict) and all(integer(peak.get(k)) for k in
        ("attempted","accepted","beforePeakSum","afterPeakSum","beforePairs","afterPairs"))
        and peak["accepted"]<=peak["attempted"]<=100000 and peak["afterPeakSum"]<=peak["beforePeakSum"]
        and peak["beforePairs"]==rr["afterPairs"] and peak["afterPairs"]<=peak["beforePairs"]
        and (not t["seedComplete"] or (peak["afterPeakSum"]==t["initialCost"][4] and peak["afterPairs"]==t["initialCost"][6]))
        and type(peak.get("deadlineReached")) is bool and type(peak.get("limitReached")) is bool,"PEAK_REPAIR_TELEMETRY")
    attempted = t["nativeSearch"]
    source = t.get("resultSource")
    verify_search_rounds(t,seed,adaptive,budget)
    check(type(t.get("stagnationApplied")) is bool and (not t["stagnationApplied"] or adaptive and attempted),"STAGNATION")
    if attempted:
        cost=t.get("nativeCost")
        check(isinstance(cost,list) and len(cost)==13 and all(integer(v) for v in cost) and t["searchSeconds"]>0,"NATIVE_COST")
    else:
        check(t.get("nativeCost") is None and t["searchSeconds"]==0,"NATIVE_NOT_ATTEMPTED")
    if seed:
        check(source=="CONSTRUCTOR_ONLY" and t["seedComplete"] and t["initialized"]==t["entities"]
              and t["initialCost"]==t["finalCost"],"SEED_CONTROL")
    elif source=="SEED_RETAINED":
        check(adaptive and t["seedComplete"] and t["initialized"]==t["entities"]
              and t["initialCost"]==t["finalCost"],"SEED_RETAINED")
    else:
        check(source=="NATIVE" and attempted and t["nativeCost"]==t["finalCost"],"NATIVE_SOURCE")
    if t["seedComplete"]:
        check(t["finalCost"]<=t["initialCost"],"NATIVE_SCORE_REGRESSED")
    if profile.get("days")==42:
        check(t.get("domainMode")=="BOUNDED_42" and integer(t.get("fullDomainPatterns"))
              and t["entities"]<=t["allowedPatterns"]<=t["entities"]*2049
              and t["fullDomainPatterns"]>=t["allowedPatterns"],"BOUNDED_DOMAIN")
    elif "domainMode" in t:
        check(t["domainMode"]=="EXACT" and t.get("fullDomainPatterns")==t["allowedPatterns"],"EXACT_DOMAIN")


def pair_detail(pair, a, b, profile, comparable):
    check(pair.get("comparable") is comparable, "COMPARABILITY")
    if not comparable:
        check(pair.get("reason") == "NOT_COMPARABLE" and pair.get("regressed") is None
              and pair.get("improved") is None and pair.get("retained") is None, "NONCOMPARABLE")
        return
    check(all(type(pair.get(k)) is bool for k in ("regressed", "improved", "retained"))
          and not (pair["regressed"] and pair["improved"]), "PAIR_FLAGS")
    def vector(row):
        metrics=row["finalAssessment"]["metrics"]
        if profile.get("cutover") is True:
            vector=sector_vector({**metrics,"coverageAudit":row.get("comparisonCoverageAudit")},profile,False)
            full=sector_vector({**metrics,"coverageAudit":row.get("scaleCoverageAudit")},profile)
            check(len(vector)==len(full) and all(all(x[k]<=y[k] for k in ("horizon","month","sundays","monthSundays","closing","peak"))
                and set(x["presence"]).issubset(set(y["presence"])) and all(d>=5 for d in x["presence"])
                for x,y in zip(vector,full)),"CUTOVER_COMPARISON_SCOPE")
            return vector
        if profile["days"]==42 or row.get("kind")=="temporal":
            metrics={**metrics,"coverageAudit":row.get("scaleCoverageAudit")}
        return sector_vector(metrics,profile)
    expected = first_sector_regression(vector(a),vector(b))
    if expected:
        check(pair["regressed"] and (pair.get("reason"), pair.get("regression")) == expected, "SECTOR_REGRESSION")
    elif pair["regressed"]:
        check(pair.get("reason") in ("ROLE_TIME_COVERAGE", "ROLE_TIME_PRESENCE"), "ROLE_TIME_REASON")
    if pair["regressed"]:
        loss = pair.get("regression")
        check(isinstance(loss, dict) and set(loss) == {"metric", "scope", "before", "after", "delta"}
              and pair["reason"] in COVERAGE_METRICS and loss["metric"] in COVERAGE_METRICS[pair["reason"]]
              and loss["scope"] in SCOPES and integer(loss["before"]) and integer(loss["after"])
              and type(loss["delta"]) is int and loss["delta"] == loss["after"] - loss["before"]
              and (loss["delta"] < 0 if pair["reason"] in ("DAILY_PRESENCE","ROLE_TIME_PRESENCE") else loss["delta"] > 0)
              and pair["retained"] and pair["productReason"] == pair["reason"], "REGRESSION_DETAIL")
    else:
        check("regression" not in pair and pair.get("reason") == ("OPERATIONAL_IMPROVEMENT" if pair["improved"] else "ACCEPTED"), "PAIR_REASON")
        if pair["retained"]:
            check(pair.get("productReason") in {"PRIORITY_LEADERSHIP","REST_WINDOW","REST_DISTRIBUTION",
                 "SATURDAY_BALANCE","SUNDAY_BALANCE","PROTECTED_ASSIGNMENT"}, "PRODUCT_RETENTION")
        else:
            check(pair.get("productReason") in {"ACCEPTED","OPERATIONAL_IMPROVEMENT"}, "PRODUCT_REASON")


def verify(rows, mode):
    check(mode in ("smoke","paired"), "MODE")
    scenarios = SCENARIOS[:1] if mode == "smoke" else SCENARIOS
    rounds = 1 if mode == "smoke" else 6
    expected_count = rounds * (len(scenarios) * 6 + (1 if mode == "paired" else 0))
    check(isinstance(rows,list) and len(rows) == expected_count and all(isinstance(r,dict) for r in rows), "ROW_COUNT")
    check(all(r.get("scenario") in scenarios and r.get("kind") in ("measurement","comparison","seed-control") for r in rows), "ROW_KIND")
    reports, image_ids = [], {}
    source = None
    all_valid = True
    for case in scenarios:
        subset = [r for r in rows if r["scenario"] == case]
        first = subset[0]
        profile = first["profile"]
        persons, days = (50,28) if case == "branch-50-four-weeks" else (10,7)
        check(profile.get("includedOnWire") == persons and profile.get("days") == days
              and profile.get("activePositions") == persons*days and profile.get("mode") == "DAYS_AND_HOURS"
              and profile.get("searchBudgetSeconds") == 12 and profile.get("processBudgetSeconds") == 18
              and profile.get("transportBudgetSeconds") == 20
              and profile.get("savedAssignments") == (70 if case=="team-10-week-repair" else 0), "PROFILE")
        check(sha(first.get("inputHash"),64) and all(sha(first.get(k),40) for k in ("revision","evaluatorTree","comparatorBlob")), "SOURCE")
        current = tuple(first[k] for k in ("revision","evaluatorTree","comparatorBlob"))
        source = source or current
        check(current == source, "GLOBAL_SOURCE_DRIFT")
        for r in subset:
            for k in ("revision","evaluatorTree","comparatorBlob","inputHash","profile","baselineRevision","timefoldRevision","resources","arch"):
                check(r.get(k)==first.get(k),"IDENTITY_DRIFT")
            check(r.get("baselineRevision")==BASE and r.get("timefoldRevision")==CONTROL
                  and r.get("resources")==RESOURCES and r.get("arch")=="arm64"
                  and r.get("sampleKind")=="cold-container" and r.get("hostCapacityMeasured") is False
                  and r.get("liveHttpMeasured") is False, "ISOLATION")
        measurements = [r for r in subset if r["kind"]=="measurement"]
        comparisons = [r for r in subset if r["kind"]=="comparison"]
        seeds = [r for r in subset if r["kind"]=="seed-control"]
        check([(r.get("repetition"),r.get("position"),r.get("engine")) for r in measurements]
              ==[(rep,pos,e) for rep in range(rounds) for pos,e in enumerate(ORDERS[rep])],"ORDER")
        check([(r.get("repetition"),r.get("before"),r.get("after")) for r in comparisons]
              ==[(rep,a,b) for rep in range(rounds) for a,b in PAIRS],"PAIR_ORDER")
        check([r.get("repetition") for r in seeds] == (list(range(rounds)) if case=="branch-50-four-weeks" and mode=="paired" else []),"SEED_ORDER")
        indexed = {}
        good = {}
        def identity(row, engine):
            im = row["identity"]
            check(isinstance(im,dict) and im.get("architecture")=="arm64" and im.get("revision")==
                  (BASE if engine=="ortools" else CONTROL if engine=="timefold" else row["revision"])
                  and isinstance(im.get("image"),str) and im["image"].startswith("sha256:")
                  and sha(im["image"][7:],64),"IMAGE")
            check(image_ids.setdefault(engine,im)==im,"IMAGE_DRIFT")
        for r in measurements:
            engine = r["engine"]
            identity(r,engine)
            key = (r["repetition"],engine)
            indexed[key]=r
            good[key]=valid(r,profile)
            if engine!="ortools":
                check(r.get("rawStatus") not in ("OPTIMAL","INFEASIBLE"),"UNSUPPORTED_PROOF")
            if engine=="solverforge" and good[key]:
                native(r,profile)
            all_valid &= good[key]
        for r in comparisons:
            rep,a,b=r["repetition"],r["before"],r["after"]
            pair_detail(r,indexed[(rep,a)],indexed[(rep,b)],profile,good[(rep,a)] and good[(rep,b)])
        seed_valid = []
        for r in seeds:
            identity(r,"solverforge")
            ok = valid(r,profile)
            if ok:
                native(r,profile,True)
                seed_valid.append(r)
            ref=indexed[(r["repetition"],"solverforge")]
            pair_detail(r["againstNative"],r,ref,profile,ok and good[(r["repetition"],"solverforge")])
        def stats(values):
            if not values:
                return {"validNew":0,"shortageP50":None,"productP50Seconds":None,"cpuP50Seconds":None,
                        "peakMemoryBytes":None,"productMaxSeconds":None}
            return {"validNew":len(values),
                    "shortageP50":p50([r["finalAssessment"]["metrics"]["normalizedEstimatedShortage"] for r in values]),
                    "productP50Seconds":p50([r["productSeconds"] for r in values]),
                    "cpuP50Seconds":p50([r["cgroup"]["cpuUsageUsec"]/1e6 for r in values]),
                    "productMaxSeconds":max(r["productSeconds"] for r in values),
                    "peakMemoryBytes":max(r["cgroup"]["memoryPeakBytes"] for r in values)}
        report={"scenario":case,"samplesPerEngine":rounds,
                "engines":{e:stats([r for r in measurements if r["engine"]==e and good[(r["repetition"],e)]]) for e in ENGINES},
                "pairs":{a+"->"+b:{"comparable":sum(r["comparable"] for r in comparisons if (r["before"],r["after"])==(a,b)),
                     "regressions":sum(r["regressed"] is True for r in comparisons if (r["before"],r["after"])==(a,b)),
                     "productRetentions":sum(r["retained"] is True for r in comparisons if (r["before"],r["after"])==(a,b)),
                     "improvements":sum(r["improved"] is True for r in comparisons if (r["before"],r["after"])==(a,b))}
                     for a,b in PAIRS}}
        # Pair observations by repetition; unpaired feasible samples cannot
        # masquerade as evidence of a performance improvement.
        for a, b in PAIRS:
            pairs = [(indexed[(rep,a)], indexed[(rep,b)]) for rep in range(rounds)
                     if good[(rep,a)] and good[(rep,b)]]
            pair = report["pairs"][a+"->"+b]
            for name, metric in (
                ("shortage", lambda r: r["finalAssessment"]["metrics"]["normalizedEstimatedShortage"]),
                ("productSeconds", lambda r: r["productSeconds"]),
                ("cpuSeconds", lambda r: r["cgroup"]["cpuUsageUsec"]/1e6),
                ("memoryPeakBytes", lambda r: r["cgroup"]["memoryPeakBytes"]),
            ):
                pair[name] = paired_stats([metric(x) for x,y in pairs], [metric(y) for x,y in pairs])
            pair["allPairsValid"] = len(pairs) == rounds
        report["tailSampleSufficient"] = False
        if seeds:
            report["seedOnly"]=stats(seed_valid)
            report["seedVsNative"]={"samples":len(seeds),"comparable":sum(r["againstNative"]["comparable"] for r in seeds),
                                   "improved":sum(r["againstNative"]["improved"] is True for r in seeds),
                                   "regressed":sum(r["againstNative"]["regressed"] is True for r in seeds)}
        reports.append(report)
    return {"decision":"EXPLORATORY_VALID_TRIPLE" if all_valid else "EXPLORATORY_INCOMPLETE",
            "productionCertified":False,"qualityGatePassed":False,"scenarios":reports}


def e2_noninferiority(report):
    check(report.get("decision")=="EXPLORATORY_VALID_TRIPLE","E2_VALIDITY")
    scenarios=report.get("scenarios",[])
    check([s.get("scenario") for s in scenarios]==list(SCENARIOS),"E2_SCENARIOS")
    for scenario in scenarios:
        check(scenario["samplesPerEngine"]==6,"E2_SAMPLES")
        for name in ("ortools->solverforge","timefold->solverforge"):
            pair=scenario["pairs"][name]
            check(pair["comparable"]==6 and pair["regressions"]==0
                  and pair["productRetentions"]==0,"E2_PRODUCT_NONINFERIORITY")
    return {"decision":"E2_NONINFERIORITY_OBSERVED","productionCertified":False}


def verify_curve(rows):
    variants = [("seed-only", 12), ("native-2", 2), ("native-4", 4), ("native-8", 8), ("native-12", 12), ("adaptive", 12)]
    check(len(rows) == len(variants)**2 and all(isinstance(r,dict) for r in rows), "CURVE_COUNT")
    first = rows[0]
    profile = first["profile"]
    check(first["scenario"] == "branch-50-four-weeks" and profile["includedOnWire"] == 50
          and profile["days"] == 28 and profile["activePositions"] == 1400, "CURVE_PROFILE")
    check(sha(first["inputHash"],64) and all(sha(first[k],40) for k in ("revision","evaluatorTree","comparatorBlob")), "CURVE_SOURCE")
    reports = {name: [] for name,_ in variants}
    for index,r in enumerate(rows):
        repetition,position = divmod(index,len(variants))
        name,budget = variants[(repetition+position)%len(variants)]
        check(r.get("kind")=="curve" and r.get("repetition")==repetition and r.get("position")==position
              and r.get("variant")==name and r.get("requestedBudgetSeconds")==budget, "CURVE_ORDER")
        for key in ("scenario","inputHash","revision","evaluatorTree","comparatorBlob","profile","baselineRevision",
                    "timefoldRevision","resources","arch","identity","sampleKind","hostCapacityMeasured","liveHttpMeasured"):
            check(r.get(key)==first.get(key), "CURVE_DRIFT")
        check(r["baselineRevision"]==BASE and r["timefoldRevision"]==CONTROL and r["resources"]==RESOURCES
              and r["arch"]=="arm64" and r["sampleKind"]=="cold-container"
              and r["hostCapacityMeasured"] is False and r["liveHttpMeasured"] is False, "CURVE_ISOLATION")
        im=r["identity"]
        check(im.get("architecture")=="arm64" and im.get("revision")==r["revision"]
              and isinstance(im.get("image"),str) and im["image"].startswith("sha256:") and sha(im["image"][7:],64), "CURVE_IMAGE")
        check(r.get("rawStatus") not in ("OPTIMAL","INFEASIBLE"), "CURVE_PROOF")
        ok=valid(r,profile)
        if ok:
            check(r["processSeconds"]<=budget+.1,"CURVE_BUDGET")
            native(r,profile,name=="seed-only",budget,name=="adaptive")
        reports[name].append((r,ok))
    for name,_ in variants:
        for index,(row,ok) in enumerate(reports[name]):
            for control,field in (("seed-only","againstSeed"),("native-12","againstNative12")):
                other,other_ok=reports[control][index]
                pair_detail(row[field],other,row,profile,ok and other_ok)
    result={}
    for name,budget in variants:
        records=reports[name]
        accepted=[r for r,ok in records if ok]
        result[name]={"budgetSeconds":budget,"samples":len(records),"validNew":len(accepted),
            "shortageP50":p50([r["finalAssessment"]["metrics"]["normalizedEstimatedShortage"] for r in accepted]),
            "productP50Seconds":p50([r["productSeconds"] for r in accepted]),
            "cpuP50Seconds":p50([r["cgroup"]["cpuUsageUsec"]/1e6 for r in accepted]),
            "mappingP50Seconds":p50([r["forge"]["mapSeconds"] for r in accepted]),
            "seedP50Seconds":p50([r["forge"]["seedSeconds"] for r in accepted]),
            "searchP50Seconds":p50([r["forge"]["searchSeconds"] for r in accepted]),
            "nativeAttempts":sum(r["forge"]["nativeSearch"] for r in accepted),
            "repairAcceptedSectorsP50":p50([r["forge"]["repair"]["accepted"] for r in accepted]),
            "repairProjectionsP50":p50([r["forge"]["repair"]["projections"] for r in accepted]),
            "repairReconstructedP50":p50([r["forge"]["repair"]["reconstructed"] for r in accepted]),
            "repairDeadlineSamples":sum(r["forge"]["repair"]["deadlineReached"] for r in accepted),
            "seedRetained":sum(r["forge"]["resultSource"]=="SEED_RETAINED" for r in accepted),
            "regressionsAgainstSeed":sum(r["againstSeed"]["regressed"] is True for r,_ in records),
            "retentionsAgainstNative12":sum(r["againstNative12"]["retained"] is True for r,_ in records),
            "comparableAgainstNative12":sum(r["againstNative12"]["comparable"] is True for r,_ in records),
            "peakMemoryBytes":max((r["cgroup"]["memoryPeakBytes"] for r in accepted),default=None),
            "outcomes":{str(o):sum(r.get("outcome")==o for r,_ in records) for o in {r.get("outcome") for r,_ in records}}}
    return {"decision":"CANDIDATE_CURVE_DIAGNOSTIC_ONLY","productionCertified":False,
            "qualityGatePassed":False,"tailSampleSufficient":False,"variants":result}


def verify_personal(rows):
    modes=("DAYS_AND_HOURS","REST_ONLY","HOURS_ONLY")
    names=("ortools","native-12","adaptive")
    check(len(rows)==27 and all(isinstance(r,dict) for r in rows),"PERSONAL_COUNT")
    result={}
    source=None
    images={}
    for case_index,mode in enumerate(modes):
        subset=rows[case_index*9:(case_index+1)*9]
        first=subset[0]
        profile=first["profile"]
        check(profile["includedOnWire"]==3 and profile["activePositions"]==21 and profile["days"]==7
              and profile["mode"]==mode and profile["savedAssignments"]==(21 if mode=="HOURS_ONLY" else 0)
              and profile["confirmedDemands"]==7 and profile["searchBudgetSeconds"]==12
              and profile["processBudgetSeconds"]==18 and profile["transportBudgetSeconds"]==20,"PERSONAL_PROFILE")
        check(sha(first["inputHash"],64) and all(sha(first[k],40) for k in ("revision","evaluatorTree","comparatorBlob")),"PERSONAL_SOURCE")
        current=tuple(first[k] for k in ("revision","evaluatorTree","comparatorBlob"))
        source=source or current
        check(source==current,"PERSONAL_SOURCE_DRIFT")
        records={name:[] for name in names}
        for index,r in enumerate(subset):
            repetition,position=divmod(index,3)
            name=names[(repetition+position)%3]
            check(r["kind"]=="personal" and r["scenario"]=="personal-"+mode and r["variant"]==name
                and r["repetition"]==repetition and r["position"]==position,"PERSONAL_ORDER")
            for key in ("scenario","inputHash","revision","evaluatorTree","comparatorBlob","profile","baselineRevision",
                        "timefoldRevision","resources","arch","sampleKind","hostCapacityMeasured","liveHttpMeasured"):
                check(r.get(key)==first.get(key),"PERSONAL_DRIFT")
            check(r["baselineRevision"]==BASE and r["timefoldRevision"]==CONTROL and r["resources"]==RESOURCES
                and r["arch"]=="arm64" and r["sampleKind"]=="cold-container"
                and r["hostCapacityMeasured"] is False and r["liveHttpMeasured"] is False,"PERSONAL_ISOLATION")
            im=r["identity"];engine="ortools" if name=="ortools" else "solverforge"
            check(im.get("architecture")=="arm64" and im.get("revision")==(BASE if engine=="ortools" else r["revision"])
                and isinstance(im.get("image"),str) and im["image"].startswith("sha256:") and sha(im["image"][7:],64),"PERSONAL_IMAGE")
            check(images.setdefault(engine,im)==im,"PERSONAL_IMAGE_DRIFT")
            check(type(r.get("personalRulesPreserved")) is bool,"PERSONAL_RULES_FLAG")
            ok=valid(r,profile)
            if engine=="solverforge":
                check(r.get("rawStatus") not in ("OPTIMAL","INFEASIBLE"),"PERSONAL_PROOF")
                if ok:native(r,profile,adaptive=name=="adaptive")
            else:check(r.get("forge") is None,"PERSONAL_FORGE_TELEMETRY")
            records[name].append((r,ok))
        reports={}
        for name in names:
            accepted=[r for r,ok in records[name] if ok and r["personalRulesPreserved"]]
            comparisons={}
            for control,field in (("ortools","againstOrtools"),("native-12","againstNative12")):
                for i,(r,ok) in enumerate(records[name]):
                    other,other_ok=records[control][i]
                    pair_detail(r[field],other,r,profile,ok and other_ok)
                comparisons[control]={"comparable":sum(r[field]["comparable"] is True for r,_ in records[name]),
                    "regressions":sum(r[field]["regressed"] is True for r,_ in records[name]),
                    "retained":sum(r[field]["retained"] is True for r,_ in records[name])}
            reports[name]={"validPersonal":len(accepted),"samples":3,"comparisons":comparisons,
                "productP50Seconds":p50([r["productSeconds"] for r in accepted])}
        result[mode]=reports
    passed=all(reports[name]["validPersonal"]==3 for reports in result.values() for name in names)
    noninferior=passed and all(c["comparable"]==3 and c["regressions"]==0 and c["retained"]==0
        for reports in result.values() for name in ("native-12","adaptive")
        for control,c in reports[name]["comparisons"].items() if name=="adaptive" or control=="ortools")
    return {"decision":"E3A_FIXED_CLOCK_NONINFERIORITY_OBSERVED" if noninferior else "E3A_FIXED_CLOCK_REVIEW_REQUIRED",
        "modes":result,"fullE3Parity":False,"productionCertified":False}


def tail_percentile(values):
    return sorted(values)[math.ceil(.95*len(values))-1] if len(values)>=30 else None


def adaptive_gain(paired,comparisons):
    """Pre-registered proof: 32 valid pairs, no product veto, >=25% median
    paired product gain, >=25% p95 reduction and no median CPU increase.
    Report all outcomes; do not infer a production deployment decision."""
    check(len(paired)<=32,"ADAPTIVE_SAMPLE_COUNT")
    full=[a["productSeconds"] for a,b in paired]
    adaptive=[b["productSeconds"] for a,b in paired]
    latency=paired_stats(full,adaptive)
    cpu=paired_stats([a["cgroup"]["cpuUsageUsec"]/1e6 for a,b in paired],
                     [b["cgroup"]["cpuUsageUsec"]/1e6 for a,b in paired])
    p95_base=tail_percentile(full) if len(paired)==32 else None
    p95_candidate=tail_percentile(adaptive) if len(paired)==32 else None
    p95_reduction=100*(p95_base-p95_candidate)/p95_base if p95_base else None
    comparable=(len(paired)==32 and all(comparisons.get(name,{}).get("comparable")==32
        and comparisons[name]["regressions"]==0 and comparisons[name]["retained"]==0
        for name in ("ortools","timefold","native-12")))
    approved=(comparable and latency["reductionPercentP50"] is not None
        and latency["reductionPercentP50"]>=25 and p95_reduction is not None
        and p95_reduction>=25 and cpu["deltaP50"]<=0)
    return {"decision":"ADAPTIVE_GAIN_OBSERVED" if approved else "ADAPTIVE_GAIN_NOT_PROVEN",
        "pairedSamples":len(paired),"productNoninferior":comparable,"productLatency":latency,"cpu":cpu,
        "nativeP95Seconds":p95_base,"adaptiveP95Seconds":p95_candidate,"p95ReductionPercent":p95_reduction,
        "nativeAttempts":sum(b["forge"]["nativeSearch"] for a,b in paired),
        "seedRetained":sum(b["forge"]["resultSource"]=="SEED_RETAINED" for a,b in paired),
        "maxPeakMemoryBytes":max((b["cgroup"]["memoryPeakBytes"] for a,b in paired),default=None),
        "productionCertified":False}



TEMPORAL_CASES=("mixed-variable","holiday-absence-history","hours-only","rest-only","combined-115-six-weeks","combined-250-six-weeks",
    "night-same-day","weekly-transition-42","weekly-transition-40","monthly-cutover-december","cross-sector-leadership")
TEMPORAL_OBJECTIVES=("COVERAGE","SUNDAY_COVERAGE","SUNDAY_PEAK","MOVEMENT_COVERAGE","CLOSING_COVERAGE",
    "UNTIMED_ROTATION","SUNDAY_BALANCE","REST_SPACING","LEADERSHIP","SATURDAY_BALANCE","REST_DISTRIBUTION",
    "REST_ROTATION","PEOPLE_CHANGED","STABILITY","PREFERENCES","TIE_BREAK")

def verify_temporal_search(t):
    attempted=t.get("nativeSearch")
    accepted=t.get("nativeAccepted")
    guard=t.get("guardPreserved")
    candidate=t.get("nativeCandidateCost")
    check(type(attempted) is bool and type(accepted) is bool,"TEMPORAL_SEARCH_TRACE")
    initial=t["initialCost"];final=t["finalCost"]
    if attempted:
        check(isinstance(candidate,list) and len(candidate)==17 and all(integer(x) for x in candidate)
              and type(guard) is bool and t["searchSeconds"]>0,"TEMPORAL_NATIVE_TRACE")
        check(accepted==(guard and candidate<initial),"TEMPORAL_NATIVE_ACCEPTANCE")
    else:
        check(candidate is None and guard is None and not accepted and t["searchSeconds"]==0,"TEMPORAL_NATIVE_NOT_RUN")
    check(t.get("resultSource")==("NATIVE" if accepted else "SEED_RETAINED" if attempted else "CONSTRUCTOR_ONLY")
          and final==(candidate if accepted else initial),"TEMPORAL_RESULT_SOURCE")


def verify_temporal(rows):
    check(len(rows)==4*len(TEMPORAL_CASES) and all(isinstance(r,dict) for r in rows),"TEMPORAL_COUNT")
    reports={}
    for offset,case in enumerate(TEMPORAL_CASES):
        group=rows[offset*4:(offset+1)*4];first=group[0];profile=first["profile"]
        people={"combined-115-six-weeks":115,"combined-250-six-weeks":250}.get(case,3)
        cutover=case=="monthly-cutover-december"
        days=31 if cutover else 7 if people==3 else 42
        check(first["scenario"]==case and profile["days"]==days and profile["includedOnWire"]==people
              and profile["activePositions"]==people*days and profile.get("cutover") is cutover
              and integer(profile.get("visibleDays")) and 1<=profile["visibleDays"]<=days
              and (days!=42 or profile["untimedPositions"]>0 and profile["paidHolidayCount"]==1)
              and (case!="cross-sector-leadership" or profile["untimedPositions"]==7)
              and profile["paidHolidayCount"]==(1 if case=="holiday-absence-history" or days==42 or cutover else 0)
              and profile["searchBudgetSeconds"]==12
              and profile["processBudgetSeconds"]==18 and profile["transportBudgetSeconds"]==20,"TEMPORAL_PROFILE")
        records={"ortools":[],"temporal":[]}
        for i,r in enumerate(group):
            rep,pos=divmod(i,2);name=("ortools","temporal")[(rep+pos)%2]
            check(r["kind"]=="temporal" and r["variant"]==name and r["repetition"]==rep and r["position"]==pos,"TEMPORAL_ORDER")
            for key in ("scenario","inputHash","revision","evaluatorTree","comparatorBlob","profile","baselineRevision",
                        "timefoldRevision","resources","arch","sampleKind","hostCapacityMeasured","liveHttpMeasured"):
                check(r.get(key)==first.get(key),"TEMPORAL_DRIFT")
            check(sha(r["inputHash"],64) and all(sha(r[k],40) for k in ("revision","evaluatorTree","comparatorBlob"))
                  and r["baselineRevision"]==BASE and r["timefoldRevision"]==CONTROL and r["resources"]==RESOURCES
                  and r["arch"]=="arm64" and r["sampleKind"]=="cold-container"
                  and r["hostCapacityMeasured"] is False and r["liveHttpMeasured"] is False,"TEMPORAL_ISOLATION")
            im=r["identity"]
            check(im.get("architecture")=="arm64" and im.get("revision")== (BASE if name=="ortools" else r["revision"])
                  and isinstance(im.get("image"),str) and im["image"].startswith("sha256:") and sha(im["image"][7:],64),"TEMPORAL_IMAGE")
            check(type(r.get("featureChecks")) is bool,"TEMPORAL_FEATURE_CHECK")
            ok=valid(r,profile)
            if ok:
                check(integer(r.get("tieBreakAudit")),"TEMPORAL_TIE_AUDIT")
                metrics=r["finalAssessment"]["metrics"]
                sector_vector({**metrics,"coverageAudit":r.get("scaleCoverageAudit")},profile)
            t=r.get("temporal")
            if name=="ortools":
                check(t is None,"TEMPORAL_CONTROL")
            else:
                check(r.get("rawStatus") not in ("OPTIMAL","INFEASIBLE"),"TEMPORAL_PROOF")
                if ok:
                    check(isinstance(t,dict) and t.get("version")==2 and t.get("scope")=="SYNTHETIC_TEMPORAL"
                          and t.get("partialModel") is True and t.get("entities")==people and t.get("days")==days
                          and t.get("untimed")==profile["untimedPositions"]//days and t.get("visibleDays")==profile["visibleDays"]
                          and t.get("domainMode")==("EXACT_WEEK" if days==7 else "BOUNDED_PATHS")
                          and t.get("pathLimit")== (30000 if days==7 else 384)
                          and integer(t.get("patterns")) and people<=t["patterns"]<=people*t["pathLimit"]
                          and type(t.get("nativeSearch")) is bool
                          and all(numeric(t.get(k)) for k in ("mapSeconds","seedSeconds","searchSeconds"))
                          and t["mapSeconds"]+t["seedSeconds"]+t["searchSeconds"]<=r["processSeconds"]+.01,"TEMPORAL_TELEMETRY")
                    for k in ("initialCost","finalCost"):
                        check(isinstance(t.get(k),list) and len(t[k])==17 and all(integer(x) for x in t[k]),"TEMPORAL_COST")
                    check(t["finalCost"][0]==0 and t["finalCost"][1]==r["finalAssessment"]["metrics"]["normalizedEstimatedShortage"]
                          and t["finalCost"][16]==r["tieBreakAudit"],"TEMPORAL_SCORE")
                    check(t["finalCost"]<=t["initialCost"],"TEMPORAL_SCORE_REGRESSED")
                    verify_temporal_search(t)
                    rest=r["scaleRestAudit"]
                    check(integer(t.get("restWeight")) and 1<=t["restWeight"]<=1+people*days
                          and t["restWeight"]==r.get("restWeightAudit")
                          and t.get("restPairs")==rest["adjustablePairs"] and t.get("restExcess")==rest["correctableExcess"]
                          and t["finalCost"][8]==t["restWeight"]*t["restExcess"]+t["restPairs"],"TEMPORAL_REST_SCORE")
                    check(integer(r.get("leadershipAudit")) and t["finalCost"][9]==r["leadershipAudit"],"TEMPORAL_LEADERSHIP_SCORE")
                    objs=t.get("objectives")
                    check(isinstance(objs,list) and len(objs)==16 and tuple(o["name"] for o in objs)==TEMPORAL_OBJECTIVES,"TEMPORAL_OBJECTIVES")
                    for j,o in enumerate(objs):
                        check(isinstance(o.get("status"),str) and (o["cost"]==t["finalCost"][j+1]
                              if o["status"].startswith(("SCOPED","PARTIAL")) else o["cost"] is None),"TEMPORAL_OBJECTIVE_STATUS")
                    check(objs[15]["status"]=="SCOPED_ORIGINAL_SHA256","TEMPORAL_TIE_STATUS")
                    check(objs[2]["status"]==("NOT_APPLICABLE_ONE_WEEK" if days==7 else "PARTIAL_GLOBAL_BOUND")
                          and objs[5]["status"]==("NOT_APPLICABLE_TIMED_ONLY" if t["untimed"]==0 else "SCOPED_WEEKDAY_AND_SUNDAY"),
                          "TEMPORAL_APPLICABILITY")
            records[name].append((r,ok))
        candidate=records["temporal"];control=records["ortools"]
        for (a,aok),(b,bok) in zip(control,candidate):
            pair_detail(b["againstOrtools"],a,b,profile,aok and bok)
        reports[case]={
            "ortoolsValid":sum(ok and r["featureChecks"] for r,ok in control),
            "temporalValid":sum(ok and r["featureChecks"] for r,ok in candidate),
            "pairedNoninferior":sum(r["againstOrtools"]["comparable"] is True and r["againstOrtools"]["regressed"] is False
                and r["againstOrtools"]["retained"] is False for r,_ in candidate),
            "candidateP50Seconds":p50([r["productSeconds"] for r,ok in candidate if ok]),
            "candidateCpuP50Seconds":p50([r["cgroup"]["cpuUsageUsec"]/1e6 for r,ok in candidate if ok]),
            "candidatePeakMemoryBytes":max((r["cgroup"]["memoryPeakBytes"] for r,ok in candidate if ok),default=None),
            "nativeAccepted":sum(bool(r["temporal"]["nativeAccepted"]) for r,ok in candidate if ok),
            "guardRejected":sum(r["temporal"]["guardPreserved"] is False for r,ok in candidate if ok),
        }
    observed=all(v["ortoolsValid"]==2 and v["temporalValid"]==2 for v in reports.values())
    return {"decision":"TEMPORAL_VALIDITY_OBSERVED" if observed else "TEMPORAL_VALIDITY_REVIEW_REQUIRED",
            "cases":reports,"noninferiorityObserved":observed and all(v["pairedNoninferior"]==2 for v in reports.values()),
            "fullE3Parity":False,"fullE4Parity":False,"productionCertified":False}

def verify_scale(rows):
    names=("ortools","native-12","adaptive")
    check(len(rows)==18 and all(isinstance(r,dict) for r in rows),"SCALE_COUNT")
    reports={}
    for offset,(case,people) in enumerate((("branch-115-six-weeks",115),("stress-250-six-weeks",250))):
        group=rows[offset*9:(offset+1)*9];first=group[0];profile=first["profile"]
        check(first["scenario"]==case and profile["includedOnWire"]==people and profile["days"]==42
              and profile["activePositions"]==people*42 and profile["mode"]=="DAYS_AND_HOURS"
              and profile["searchBudgetSeconds"]==12 and profile["processBudgetSeconds"]==18
              and profile["transportBudgetSeconds"]==20,"SCALE_PROFILE")
        check(sha(first["inputHash"],64) and all(sha(first[k],40) for k in ("revision","evaluatorTree","comparatorBlob")),"SCALE_SOURCE")
        records={name:[] for name in names};images={}
        for index,r in enumerate(group):
            rep,pos=divmod(index,3);name=names[(rep+pos)%3]
            check(r["kind"]=="scale" and r["repetition"]==rep and r["position"]==pos and r["variant"]==name,"SCALE_ORDER")
            for key in ("scenario","inputHash","revision","evaluatorTree","comparatorBlob","profile","baselineRevision",
                        "timefoldRevision","resources","arch","sampleKind","hostCapacityMeasured","liveHttpMeasured"):
                check(r.get(key)==first.get(key),"SCALE_DRIFT")
            check(r["baselineRevision"]==BASE and r["timefoldRevision"]==CONTROL and r["resources"]==RESOURCES
                  and r["arch"]=="arm64" and r["sampleKind"]=="cold-container"
                  and r["hostCapacityMeasured"] is False and r["liveHttpMeasured"] is False,"SCALE_ISOLATION")
            engine="ortools" if name=="ortools" else "solverforge";im=r["identity"]
            check(im.get("architecture")=="arm64" and im.get("revision")== (BASE if name=="ortools" else r["revision"])
                  and isinstance(im.get("image"),str) and im["image"].startswith("sha256:") and sha(im["image"][7:],64),"SCALE_IMAGE")
            check(images.setdefault(engine,im)==im,"SCALE_IMAGE_DRIFT")
            check(name=="ortools" or r.get("rawStatus") not in ("OPTIMAL","INFEASIBLE"),"SCALE_PROOF")
            ok=valid(r,profile)
            if ok:
                sector_vector({**r["finalAssessment"]["metrics"],"coverageAudit":r.get("scaleCoverageAudit")},profile)
            if ok and name!="ortools":native(r,profile,adaptive=name=="adaptive")
            if name=="ortools":check(r.get("forge") is None,"SCALE_FORGE_TELEMETRY")
            records[name].append((r,ok))
        results={}
        for name in names:
            accepted=[r for r,ok in records[name] if ok];comparisons={}
            for control,field in (("ortools","againstOrtools"),("native-12","againstNative12")):
                for i,(r,ok) in enumerate(records[name]):
                    other,other_ok=records[control][i]
                    pair_detail(r[field],other,r,profile,ok and other_ok)
                comparisons[control]={"comparable":sum(r[field]["comparable"] is True for r,_ in records[name]),
                    "regressions":sum(r[field]["regressed"] is True for r,_ in records[name]),
                    "retained":sum(r[field]["retained"] is True for r,_ in records[name])}
            results[name]={"samples":3,"validNew":len(accepted),"productP50Seconds":p50([r["productSeconds"] for r in accepted]),
                "cpuP50Seconds":p50([r["cgroup"]["cpuUsageUsec"]/1e6 for r in accepted]),
                "peakMemoryBytes":max((r["cgroup"]["memoryPeakBytes"] for r in accepted),default=None),
                "shortageP50":p50([r["finalAssessment"]["metrics"]["normalizedEstimatedShortage"] for r in accepted]),
                "comparisons":comparisons}
        reports[case]=results
    complete=all(v["validNew"]==3 for case in reports.values() for v in case.values())
    noninferior=complete and all(c["comparable"]==3 and c["regressions"]==0 and c["retained"]==0
        for case in reports.values() for name in ("native-12","adaptive") for control,c in case[name]["comparisons"].items()
        if name=="adaptive" or control!="native-12")
    return {"decision":"SCALE_VALIDITY_OBSERVED" if complete else "SCALE_VALIDITY_REVIEW_REQUIRED",
            "noninferiorityObserved":noninferior,"tailSampleSufficient":False,"fullE4Parity":False,
            "productionCertified":False,"cases":reports}


def verify_tail(rows):
    names=("ortools","timefold","native-12","adaptive")
    check(len(rows)==128 and all(isinstance(r,dict) for r in rows),"TAIL_COUNT")
    first=rows[0]
    profile=first["profile"]
    check(first["scenario"]=="branch-50-four-weeks" and profile["includedOnWire"]==50
          and profile["days"]==28 and profile["activePositions"]==1400
          and profile["mode"]=="DAYS_AND_HOURS" and profile["searchBudgetSeconds"]==12
          and profile["processBudgetSeconds"]==18 and profile["transportBudgetSeconds"]==20,"TAIL_PROFILE")
    check(sha(first["inputHash"],64) and all(sha(first[k],40) for k in ("revision","evaluatorTree","comparatorBlob")),"TAIL_SOURCE")
    records={name:[] for name in names}
    images={}
    for index,r in enumerate(rows):
        repetition,position=divmod(index,4)
        name=names[(repetition+position)%4]
        check(r["kind"]=="tail" and r["repetition"]==repetition and r["position"]==position and r["variant"]==name,"TAIL_ORDER")
        for key in ("scenario","inputHash","revision","evaluatorTree","comparatorBlob","profile","baselineRevision",
                    "timefoldRevision","resources","arch","sampleKind","hostCapacityMeasured","liveHttpMeasured"):
            check(r.get(key)==first.get(key),"TAIL_DRIFT")
        check(r["baselineRevision"]==BASE and r["timefoldRevision"]==CONTROL and r["resources"]==RESOURCES
              and r["arch"]=="arm64" and r["sampleKind"]=="cold-container"
              and r["hostCapacityMeasured"] is False and r["liveHttpMeasured"] is False,"TAIL_ISOLATION")
        engine=name if name in ("ortools","timefold") else "solverforge"
        im=r["identity"]
        check(im.get("architecture")=="arm64" and im.get("revision")==({"ortools":BASE,"timefold":CONTROL,"solverforge":r["revision"]}[engine])
              and isinstance(im.get("image"),str) and im["image"].startswith("sha256:") and sha(im["image"][7:],64),"TAIL_IMAGE")
        check(images.setdefault(engine,im)==im,"TAIL_IMAGE_DRIFT")
        check(engine=="ortools" or r.get("rawStatus") not in ("OPTIMAL","INFEASIBLE"),"TAIL_PROOF")
        ok=valid(r,profile)
        if ok and engine=="solverforge":native(r,profile,adaptive=name=="adaptive")
        if engine!="solverforge":check(r.get("forge") is None,"TAIL_FORGE_TELEMETRY")
        records[name].append((r,ok))
    reports={}
    for name in names:
        accepted=[r for r,ok in records[name] if ok]
        comparisons={}
        for control,field in (("ortools","againstOrtools"),("timefold","againstTimefold"),("native-12","againstNative12")):
            for i,(r,ok) in enumerate(records[name]):
                other,other_ok=records[control][i]
                pair_detail(r[field],other,r,profile,ok and other_ok)
            comparisons[control]={"comparable":sum(r[field]["comparable"] is True for r,_ in records[name]),
                "regressions":sum(r[field]["regressed"] is True for r,_ in records[name]),
                "retained":sum(r[field]["retained"] is True for r,_ in records[name])}
        times=[r["productSeconds"] for r in accepted]
        reports[name]={"samples":32,"validNew":len(accepted),"p50ProductSeconds":p50(times),
            "p95ProductSeconds":tail_percentile(times) if len(accepted)==32 else None,
            "maxProductSeconds":max(times,default=None),
            "cpuP50Seconds":p50([r["cgroup"]["cpuUsageUsec"]/1e6 for r in accepted]),
            "peakMemoryBytes":max((r["cgroup"]["memoryPeakBytes"] for r in accepted),default=None),
            "shortageP50":p50([r["finalAssessment"]["metrics"]["normalizedEstimatedShortage"] for r in accepted]),
            "comparisons":comparisons}
    complete=all(v["validNew"]==32 for v in reports.values())
    noninferior=complete and all(c["comparable"]==32 and c["regressions"]==0 and c["retained"]==0
        for name in ("native-12","adaptive") for key,c in reports[name]["comparisons"].items()
        if name=="adaptive" or key!="native-12")
    # Only the adaptive variant is required to be noninferior to native-12.
    # Native-12 and adaptive are also evaluated against both frozen controls.
    native_rows=records["native-12"]
    adaptive_rows=records["adaptive"]
    paired=[(a,b) for (a,ok_a),(b,ok_b) in zip(native_rows,adaptive_rows) if ok_a and ok_b]
    gains=adaptive_gain(paired,reports["adaptive"]["comparisons"])
    return {"decision":"E2_TAIL_NONINFERIORITY_OBSERVED" if noninferior else "E2_TAIL_REVIEW_REQUIRED",
            "tailSampleSufficient":complete,"productionCertified":False,"variants":reports,"adaptiveGain":gains}


if __name__ == "__main__":
    try:
        if sys.argv[2]=="quality":
            with open(sys.argv[1],encoding="utf-8") as stream:
                print(json.dumps(e2_noninferiority(json.load(stream)),separators=(",",":")))
            sys.exit(0)
        with open(sys.argv[1],encoding="utf-8") as stream:
            rows=[json.loads(line) for line in stream if line.strip()]
            report=verify_curve(rows) if sys.argv[2]=="curve" else verify_tail(rows) if sys.argv[2]=="tail" else verify_personal(rows) if sys.argv[2]=="personal" else verify_scale(rows) if sys.argv[2]=="scale" else verify_temporal(rows) if sys.argv[2]=="temporal" else verify(rows,sys.argv[2])
        print(json.dumps(report,separators=(",",":")))
        sys.exit(0 if report["decision"] in ("EXPLORATORY_VALID_TRIPLE","CANDIDATE_CURVE_DIAGNOSTIC_ONLY","E2_TAIL_NONINFERIORITY_OBSERVED","E3A_FIXED_CLOCK_NONINFERIORITY_OBSERVED","SCALE_VALIDITY_OBSERVED","TEMPORAL_VALIDITY_OBSERVED") else 1)
    except EvidenceError as error:
        code=str(error)
        print("SolverForge comparison rejected: "+(code if re.fullmatch(r"[A-Z_0-9]+",code) else "EVIDENCE_ERROR"),file=sys.stderr)
        sys.exit(1)
    except (ValueError,KeyError,TypeError,IndexError,AttributeError,OSError,OverflowError):
        print("SolverForge comparison rejected: invalid or inconsistent evidence",file=sys.stderr)
        sys.exit(1)
