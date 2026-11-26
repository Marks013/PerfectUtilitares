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


def sector_vector(metrics, profile):
    vector = metrics.get("coverageAudit")
    check(isinstance(vector, list) and 0 < len(vector) <= profile["includedOnWire"] + 250, "COVERAGE_VECTOR")
    fields = ("horizon", "month", "sundays", "monthSundays", "closing", "peak")
    for sector in vector:
        check(isinstance(sector, dict) and set(sector) == {*fields, "presence"}
              and all(integer(sector[k]) for k in fields), "COVERAGE_VECTOR")
        # E2 fixtures cover the complete visible horizon.
        check(sector["month"] == sector["horizon"] and sector["monthSundays"] == sector["sundays"]
              and sector["sundays"] <= sector["horizon"] and sector["closing"] <= sector["horizon"],
              "COVERAGE_VECTOR_TOTALS")
        presence = sector["presence"]
        check(isinstance(presence, list) and all(integer(day) and day < profile["days"] for day in presence)
              and presence == sorted(set(presence)), "COVERAGE_VECTOR_PRESENCE")
    if profile.get("confirmedDemands") == 0:
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
            sector_vector(metrics, profile)
            rest = metrics.get("restAudit")
            check(isinstance(rest, dict) and set(rest) == {"adjustablePairs", "correctableExcess", "concentration", "weeklyRepetitions"}
                  and all(integer(v) for v in rest.values()) and rest["correctableExcess"] <= rest["adjustablePairs"],
                  "REST_METRICS")
    accepted = (row.get("errorCode") is None and row["timely"] and row.get("outcome") == "NEW_PROPOSAL"
                and row.get("unchangedReference") is False and assessment_valid(final)
                and (final.get("comparison") or {}).get("regressed") is not True)
    engine_new = accepted and row.get("sameAsRaw") is True and feasible and assessment_valid(row.get("rawAssessment"))
    check(row.get("acceptedNew") is accepted and row.get("engineNew") is engine_new, "ATTRIBUTION")
    if engine_new:
        check(row["rawAssessment"]["metrics"] == final["metrics"], "RAW_FINAL_DRIFT")
    sample = verify_cgroup(row.get("cgroup"))
    return engine_new and sample is not None


def native(row, profile, seed=False, budget=12):
    t = row.get("forge")
    check(isinstance(t, dict) and t.get("version") == "0.31.2" and t.get("partialModel") is True
          and t.get("budgetSeconds") == budget
          and t.get("mode") == ("SEED_ONLY" if seed else "NATIVE") and t.get("nativeSearch") is (not seed)
          and t.get("entities") == profile["includedOnWire"] and t.get("positions") == profile["activePositions"]
          and integer(t.get("initialized")) and t["initialized"] <= t["entities"]
          and integer(t.get("allowedPatterns")) and t["entities"] <= t["allowedPatterns"] <= t["entities"] * 50625
          and type(t.get("seedComplete")) is bool and all(numeric(t.get(k)) for k in ("mapSeconds", "seedSeconds", "searchSeconds")),
          "NATIVE_TELEMETRY")
    for name in ("initialCost", "finalCost"):
        check(isinstance(t.get(name), list) and len(t[name]) == 9 and all(integer(v) for v in t[name]), "COST_VECTOR")
    check(t["finalCost"][0] == 0 and t["finalCost"][3] == row["finalAssessment"]["metrics"]["normalizedEstimatedShortage"],
          "NATIVE_SCORE_DRIFT")
    check(t["mapSeconds"] + t["seedSeconds"] + t["searchSeconds"] <= row["processSeconds"] + .01, "NATIVE_TIMING")
    if seed:
        check(t["seedComplete"] and t["initialized"] == t["entities"] and t["searchSeconds"] == 0
              and t["initialCost"] == t["finalCost"], "SEED_CONTROL")
    else:
        check(t["searchSeconds"] > 0, "NATIVE_SEARCH_MISSING")
        if t["seedComplete"]:
            check(t["finalCost"] <= t["initialCost"], "NATIVE_SCORE_REGRESSED")


def pair_detail(pair, a, b, profile, comparable):
    check(pair.get("comparable") is comparable, "COMPARABILITY")
    if not comparable:
        check(pair.get("reason") == "NOT_COMPARABLE" and pair.get("regressed") is None
              and pair.get("improved") is None and pair.get("retained") is None, "NONCOMPARABLE")
        return
    check(all(type(pair.get(k)) is bool for k in ("regressed", "improved", "retained"))
          and not (pair["regressed"] and pair["improved"]), "PAIR_FLAGS")
    expected = first_sector_regression(sector_vector(a["finalAssessment"]["metrics"], profile),
                                       sector_vector(b["finalAssessment"]["metrics"], profile))
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


def verify_curve(rows):
    variants = [("seed-only", 12), ("native-2", 2), ("native-4", 4), ("native-8", 8), ("native-12", 12)]
    check(len(rows) == 25 and all(isinstance(r,dict) for r in rows), "CURVE_COUNT")
    first = rows[0]
    profile = first["profile"]
    check(first["scenario"] == "branch-50-four-weeks" and profile["includedOnWire"] == 50
          and profile["days"] == 28 and profile["activePositions"] == 1400, "CURVE_PROFILE")
    check(sha(first["inputHash"],64) and all(sha(first[k],40) for k in ("revision","evaluatorTree","comparatorBlob")), "CURVE_SOURCE")
    reports = {name: [] for name,_ in variants}
    for index,r in enumerate(rows):
        repetition,position = divmod(index,5)
        name,budget = variants[(repetition+position)%5]
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
            native(r,profile,name=="seed-only",budget)
        reports[name].append((r,ok))
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
            "peakMemoryBytes":max((r["cgroup"]["memoryPeakBytes"] for r in accepted),default=None),
            "outcomes":{str(o):sum(r.get("outcome")==o for r,_ in records) for o in {r.get("outcome") for r,_ in records}}}
    return {"decision":"CANDIDATE_CURVE_DIAGNOSTIC_ONLY","productionCertified":False,
            "qualityGatePassed":False,"tailSampleSufficient":False,"variants":result}


if __name__ == "__main__":
    try:
        with open(sys.argv[1],encoding="utf-8") as stream:
            rows=[json.loads(line) for line in stream if line.strip()]
            report=verify_curve(rows) if sys.argv[2]=="curve" else verify(rows,sys.argv[2])
        print(json.dumps(report,separators=(",",":")))
        sys.exit(0 if report["decision"] in ("EXPLORATORY_VALID_TRIPLE","CANDIDATE_CURVE_DIAGNOSTIC_ONLY") else 1)
    except (ValueError,KeyError,TypeError,IndexError,AttributeError,OSError,OverflowError):
        print("SolverForge comparison rejected: invalid or inconsistent evidence",file=sys.stderr)
        sys.exit(1)
