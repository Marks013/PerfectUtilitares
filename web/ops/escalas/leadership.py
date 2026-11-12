"""Optional responsibility-aware daily presence, separate from timed staffing."""
import re
import unicodedata
from optimization import remember

PRIORITY = {"LOW": 1, "NORMAL": 2, "HIGH": 3}

def responsibility(person):
    if person.get("leadership") is not None:
        return person["leadership"]
    role = unicodedata.normalize("NFD", person.get("role", ""))
    role = "".join(char for char in role if unicodedata.category(char) != "Mn").upper()
    if re.search(r"\bGERENTE\b", role):
        return {"role": "BRANCH", "sectors": []}
    if re.search(r"\bENCARREGAD|\bENC(?:\.|\s|$)", role):
        return {"role": "SECTOR", "sectors": [person["sector"]]}
    return {"role": "NONE", "sectors": []}

def movement_priority(priorities, sector, day):
    """An explicit sector/day decision overrides the branch-wide reference."""
    matched = [entry for entry in priorities if entry["startDate"] <= day <= entry["endDate"]
               and (not entry.get("sector") or entry["sector"] == sector)]
    if not matched:
        return None
    # An explicit sector priority overrides the branch-wide default for this day.
    specific = [entry for entry in matched if entry.get("sector") == sector]
    return max(PRIORITY[entry["level"]] for entry in specific or matched)


def leadership_objective(model, data, employees, dates, work, values):
    priorities = data.get("movementPriorities", [])
    if not priorities:
        return [], []
    terms, checks = [], []
    sectors = sorted({person["sector"] for person in employees})
    for sector in sectors:
        leaders = [person for person in employees
                   if responsibility(person).get("role") in ("SECTOR", "BRANCH")
                   and sector in responsibility(person).get("sectors", [])]
        for day in dates:
            if day in data["policy"].get("closedDates", []):
                continue
            weight = movement_priority(priorities, sector, day)
            if weight is None:
                continue
            available = [work[person["id"], day] for person in leaders if (person["id"], day) in work]
            missing = model.new_bool_var(f"leadership-gap:{len(checks)}")
            model.add(sum(available) + missing >= 1)
            present = sum(values[variable.index] for variable in available)
            # The metric remains exact even when the leadership phase is not reached.
            if available:
                model.add(sum(available) == 0).only_enforce_if(missing)
            remember(model, values, missing, int(present == 0))
            terms.append(weight * missing)
            checks.append((sector, day, weight, missing))
    return terms, checks


def leadership_summary(checks, snapshot):
    if not checks:
        return None
    critical = [(sector, day, variable) for sector, day, weight, variable in checks if weight == PRIORITY["HIGH"]]
    return {"criticalSectorDays": len(critical),
            "criticalSectorDaysWithoutLeader": sum(snapshot.value(variable) for _sector, _day, variable in critical),
            "prioritizedSectorDays": len(checks),
            "prioritizedSectorDaysWithoutLeader": sum(snapshot.value(variable) for _sector, _day, _weight, variable in checks),
            "timedCoverageIncluded": False}
