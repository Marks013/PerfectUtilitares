"""Deterministic warm-start proposals. CP-SAT still verifies every mandatory rule."""
import hashlib
from datetime import date, timedelta
from itertools import combinations


def balanced_rest_hints(employees, dates, active, baseline, choices, metrics, policy, instant, sunday_limit):
    """Balance opportunities before the bounded optimizer adds optional staffing goals.

    These are variable hints only. No target is converted into a staffing constraint,
    and no missing history is fabricated. Unsupported alternatives are left to CP-SAT.
    """
    groups = {}
    leadership = []
    for person in employees:
        pid, role = person["id"], person["role"].strip().upper()
        groups.setdefault(("sector", person["sector"]), []).append(pid)
        if role:
            groups.setdefault(("role", person["sector"], role), []).append(pid)
        if role.startswith("ENC.") or "ENCARREGAD" in role or "GERENTE" in role:
            leadership.append(pid)
    if len(leadership) > 1:
        groups[("leadership",)] = leadership
    unique = list(dict.fromkeys(tuple(sorted(members)) for members in groups.values()))
    memberships = {person["id"]: [index for index, members in enumerate(unique) if person["id"] in members and len(members) > 1]
                   for person in employees}
    counts, result = {}, {}
    weekdays = {day: date.fromisoformat(day).weekday() for day in dates}
    for person in sorted(employees, key=lambda item: hashlib.sha256(item["id"].encode()).digest()):
        pid = person["id"]
        available = set(active[pid])
        prior = {entry["date"]: entry for entry in person.get("planningHistory", []) + person["history"] + person.get("planningFuture", [])}
        fixed = set(person["fixedOffDays"])
        # Select one coherent reference; the model can choose another admissible shift.
        selected = {}
        for day in available:
            old = baseline.get((pid, day), {})
            allowed = choices[pid, day]
            target = min(person["weeklyHours"] * 60, person.get("simulationDailyMinutes", 600) * 5) / 5
            selected[day] = old.get("shiftId") if old.get("locked") else min(allowed, key=lambda sid: (abs(metrics[sid][0] - target), sid), default=None)
        history_rests = [0] * 7
        for day, entry in prior.items():
            if dates[0] > day >= (date.fromisoformat(dates[0]) - timedelta(days=21)).isoformat() and entry["kind"] == "OFF":
                history_rests[date.fromisoformat(day).weekday()] += 1
        # Check each selected week against preceding work and Sunday rotation.
        beam = [(0.0, {}, history_rests)]
        for week in range(0, len(dates), 7):
            group = [day for day in dates[week:week + 7] if day in available]
            if not group:
                continue
            absent = {day for day in group if baseline.get((pid, day), {}).get("kind") == "ABSENCE"}
            forced = {day for day in group if day not in absent and (weekdays[day] in fixed or day in policy["closedDates"] or baseline.get((pid, day), {}).get("locked") and baseline[pid, day]["kind"] == "OFF")}
            forbidden = {day for day in group if day in absent or baseline.get((pid, day), {}).get("locked") and baseline[pid, day]["kind"] in ("WORK", "DUTY") or day in policy["holidayDates"] and (not policy["holidayRestAllowed"] or policy.get("normativeProfile") == "SINDECOMU_SUPERMARKETS_2026_2027")}
            candidates = []
            sizes = (2,) if len(group) == 7 and not absent else range(min(2, len(group)), -1, -1)
            for size in sizes:
                for pair in combinations([day for day in group if day not in forbidden], size):
                    rests = set(pair)
                    if not forced <= rests or len(group) - len(absent) - len(rests) > 5:
                        continue
                    entries = {day: {"kind": "ABSENCE" if day in absent else "OFF" if day in rests else "DUTY" if person.get("scheduleMode") in ("UNTIMED", "MISSING") else "WORK"} for day in group}
                    for day, entry in entries.items():
                        if entry["kind"] == "WORK":
                            entry["shiftId"] = selected[day]
                    candidates.append((rests, entries))
            next_beam = []
            final_week = week + 7 >= len(dates)
            for score, previous, weekday_rests in beam:
                for rests, entries in candidates:
                    combined = {**previous, **entries}
                    total = score
                    new_weekdays = weekday_rests.copy()
                    for day in rests:
                        weekday = weekdays[day]
                        total += sum((2 * counts.get((index, day), 0) + 1) / len(unique[index]) for index in memberships[pid])
                        total += 0.15 * (2 * new_weekdays[weekday] + 1)
                        new_weekdays[weekday] += 1
                        if weekday in person["preferredOffDays"]:
                            total -= 0.1
                        total += (int(hashlib.sha256(f"{pid}:{day}".encode()).hexdigest()[:6], 16) % 97) / 9700
                    if person["offPattern"] == "PREFER_CONSECUTIVE" and any((date.fromisoformat(day) + timedelta(days=1)).isoformat() in rests for day in rests):
                        total -= 0.1
                    next_beam.append((total, combined, new_weekdays))
            if not next_beam:
                beam = []
                break
            next_beam.sort(key=lambda item: item[0])
            # Rank cheaply first; expensive temporal checks stop at the first valid
            # proposal. This warm start must not consume the solver's time budget.
            beam = []
            for candidate in next_beam:
                if _compatible(person, candidate[1], prior, metrics, policy, instant, sunday_limit, final_week):
                    beam = [candidate]
                    break
            if not beam:
                break
        if not beam:
            continue  # Incomplete information or a difficult alternative remains CP-SAT's task.
        _, entries, _ = min(beam, key=lambda item: item[0])
        result[pid] = entries
        for day, entry in entries.items():
            if entry["kind"] == "OFF":
                for index in memberships[pid]:
                    counts[index, day] = counts.get((index, day), 0) + 1
    return result


def _compatible(person, proposed, prior, metrics, policy, instant, sunday_limit, final):
    known = {**prior, **proposed}
    first, last = min(proposed), max(proposed)
    lower = (date.fromisoformat(first) - timedelta(days=21)).isoformat()
    upper = max([last, *(day for day in prior if day > last)])
    timeline = [(date.fromisoformat(lower) + timedelta(days=offset)).isoformat() for offset in range((date.fromisoformat(upper) - date.fromisoformat(lower)).days + 1)]
    working = lambda day: known.get(day, {}).get("kind") in ("WORK", "DUTY")
    maximum = min(5, policy["maxConsecutiveWorkDays"])
    streak = 0
    for day in timeline:
        streak = streak + 1 if working(day) else 0
        if streak > maximum:
            return False
    timed = []
    occupied = set()
    for day, entry in known.items():
        if not lower <= day <= upper:
            continue
        if entry["kind"] == "DUTY":
            occupied.add(day)
        elif entry["kind"] == "WORK":
            sid = entry.get("shiftId")
            if sid not in metrics:
                return False
            _, start, end = metrics[sid]
            timed.append((day, start, end))
            # A continuous paid span is conservative for overnight civil rest hints.
            for offset in range(start // 1440, (end - 1) // 1440 + 1):
                civil = (date.fromisoformat(day) + timedelta(days=offset)).isoformat()
                if civil != day and known.get(civil, {}).get("kind") in ("OFF", "ABSENCE"):
                    return False
                occupied.add(civil)
        if day in proposed and entry["kind"] in ("WORK", "DUTY"):
            if day in policy["closedDates"] or day in policy["holidayDates"] and day not in policy["authorizedHolidayDates"] and not policy["_simulation"]:
                return False
        if day in proposed and entry["kind"] == "OFF" and person["offPattern"] == "CONSECUTIVE":
            adjacent = [(date.fromisoformat(day) + timedelta(days=delta)).isoformat() for delta in (-1, 1)]
            if not any(known.get(other, {}).get("kind") == "OFF" for other in adjacent):
                # The last day's possible pair is checked once the next week is selected.
                if day != last or final:
                    return False
    sundays = [day for day in timeline if date.fromisoformat(day).weekday() == 6]
    cap = sunday_limit(person)
    for index in range(cap, len(sundays)):
        group = sundays[index - cap:index + 1]
        if any(day in proposed for day in group) and sum(day in occupied for day in group) > cap:
            return False
    timed.sort()
    for index, (day, start, end) in enumerate(timed):
        for next_day, next_start, _ in timed[index + 1:]:
            delta = (date.fromisoformat(next_day) - date.fromisoformat(day)).days
            if delta > 5:
                break
            if delta == 0 or not (day in proposed or next_day in proposed):
                continue
            gap = instant(next_day, next_start) - instant(day, end)
            if gap < policy["minInterShiftMinutes"]:
                return False
            if delta > 1 and gap < policy["minWeeklyRestMinutes"]:
                if any(known.get((date.fromisoformat(day) + timedelta(days=offset)).isoformat(), {}).get("kind") == "OFF" for offset in range(1, delta)):
                    return False
    return True
