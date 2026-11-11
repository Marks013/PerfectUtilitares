"""Deterministic warm-start proposals. CP-SAT still verifies every mandatory rule."""
import hashlib
import time
from datetime import date, timedelta
from itertools import combinations


def paid_holiday_dates(policy):
    """Closed operational holidays are real dates, never invented time credits."""
    closed = set(policy.get("closedDates", []))
    holidays = set(policy.get("holidayDates", []))
    result = set()
    for day in policy.get("paidHolidayDates", []):
        try:
            parsed = date.fromisoformat(day)
        except (ValueError, TypeError):
            continue
        if parsed.isoformat() == day and day in closed and day in holidays:
            result.add(day)
    return result


def holiday_rest_forbidden(policy, day):
    """Sunday takes precedence over the ordinary open-holiday rest restriction."""
    return (day in policy.get("holidayDates", []) and date.fromisoformat(day).weekday() != 6
            and (not policy.get("holidayRestAllowed", False)
                 or policy.get("normativeProfile") == "SINDECOMU_SUPERMARKETS_2026_2027"))


def _mixed_week_variants(entries, choices, metrics, baseline, pid, require_two=True):
    """Choose allowed long days without changing rests, absences or locked clocks."""
    working = [day for day, entry in entries.items() if entry["kind"] == "WORK"]
    candidates = [day for day in working if any(metrics[sid][0] == 540 for sid in choices[pid, day])]
    if not candidates:
        yield entries
        return
    counts = (2,) if require_two else range(min(2, len(working)) + 1)
    variants = (days for count in counts for days in combinations(candidates, count))
    for long_days in variants:
        long_days, proposal = set(long_days), {day: dict(entry) for day, entry in entries.items()}
        for day in working:
            duration = 540 if day in long_days else 480
            old = baseline.get((pid, day), {})
            matching = [sid for sid in choices[pid, day] if metrics[sid][0] == duration]
            if old.get("locked"):
                matching = [sid for sid in matching if sid == old.get("shiftId")]
            if not matching:
                break
            proposal[day]["shiftId"] = min(matching, key=lambda sid: (sid != old.get("shiftId"), sid))
        else:
            yield proposal


def balanced_rest_hints(employees, dates, active, baseline, choices, metrics, policy, instant, sunday_limit,
                        deadline=None, control=None, mixed_people=frozenset()):
    """Balance opportunities before the bounded optimizer adds optional staffing goals.

    These are variable hints only. No target is converted into a staffing constraint,
    and no missing history is fabricated. Unsupported alternatives are left to CP-SAT.
    """
    closed_holidays = paid_holiday_dates(policy)
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
    # A person on leave is not an available alternative to the remaining team.
    # Score rest concentration against actual daily exposure, not nominal staff.
    active_sets = {pid: set(days) for pid, days in active.items()}
    group_sizes = {(index, day): sum(day in active_sets.get(pid, set())
                   and baseline.get((pid, day), {}).get("kind") != "ABSENCE" for pid in members)
                   for index, members in enumerate(unique) for day in dates}
    counts, result = {}, {}
    weekdays = {day: date.fromisoformat(day).weekday() for day in dates}
    if not dates or not employees:
        return {}
    history_cutoff = (date.fromisoformat(dates[0]) - timedelta(days=21)).isoformat()
    for person in sorted(employees, key=lambda item: hashlib.sha256(item["id"].encode()).digest()):
        if control is not None:
            control.checkpoint()
        if deadline is not None and time.monotonic() >= deadline:
            return result
        pid = person["id"]
        available = set(active[pid])
        prior = {entry["date"]: entry for entry in person.get("planningHistory", []) + person["history"] + person.get("planningFuture", [])}
        fixed = set(person["fixedOffDays"])
        # Select one coherent reference; the model can choose another admissible shift.
        target = min(person["weeklyHours"] * 60, person.get("simulationDailyMinutes", 600) * 5) / 5
        tie_scores = {}
        selected = {}
        for day in available:
            old = baseline.get((pid, day), {})
            allowed = choices[pid, day]
            selected[day] = old.get("shiftId") if old.get("locked") else min(allowed, key=lambda sid: (abs(metrics[sid][0] - target), sid), default=None)
        history_rests = [0] * 7
        for day, entry in prior.items():
            if history_cutoff <= day < dates[0] and entry["kind"] == "OFF":
                history_rests[date.fromisoformat(day).weekday()] += 1
        # Check each selected week against preceding work and Sunday rotation.
        beam = [(0.0, {}, history_rests)]
        for week in range(0, len(dates), 7):
            if control is not None:
                control.checkpoint()
            if deadline is not None and time.monotonic() >= deadline:
                return result
            group = [day for day in dates[week:week + 7] if day in available]
            if not group:
                continue
            absent = {day for day in group if baseline.get((pid, day), {}).get("kind") == "ABSENCE"}
            holidays = (set(group) & closed_holidays) - absent
            closed_weekdays = sum(weekdays[day] != 6 for day in holidays)
            closed_sundays = sum(weekdays[day] == 6 for day in holidays)
            forced = {day for day in group if day not in absent | holidays and (weekdays[day] in fixed or day in policy["closedDates"] or baseline.get((pid, day), {}).get("locked") and baseline[pid, day]["kind"] == "OFF")}
            forbidden = {day for day in group if day in absent | holidays or baseline.get((pid, day), {}).get("locked") and baseline[pid, day]["kind"] in ("WORK", "DUTY") or holiday_rest_forbidden(policy, day)}
            candidates = []
            complete = len(group) == 7 and not absent
            rest_target = max(0, 2 - closed_sundays)
            sizes = (rest_target,) if complete else range(min(rest_target, len(group)), -1, -1)
            for size in sizes:
                for pair in combinations([day for day in group if day not in forbidden], size):
                    rests = set(pair)
                    work_days = len(group) - len(absent) - len(holidays) - len(rests)
                    if not forced <= rests or work_days > 5 or complete and work_days != max(0, 5 - closed_weekdays):
                        continue
                    entries = {day: {"kind": "ABSENCE" if day in absent else "HOLIDAY" if day in holidays else "OFF" if day in rests else "DUTY" if person.get("scheduleMode") in ("UNTIMED", "MISSING") else "WORK"} for day in group}
                    for day, entry in entries.items():
                        if entry["kind"] == "WORK":
                            entry["shiftId"] = selected[day]
                    if pid in mixed_people:
                        candidates.extend((rests, variant) for variant in
                                          _mixed_week_variants(entries, choices, metrics, baseline, pid, require_two=complete and not closed_weekdays))
                    else:
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
                        # Sunday rotation can synchronize otherwise identical teams.
                        # Prefer staggered sector rests; this remains only a hint.
                        importance = 3 if weekday == 6 else 1
                        for index in memberships[pid]:
                            capacity, resting = group_sizes[index, day], counts.get((index, day), 0)
                            total += importance * (2 * resting + 1) / max(1, capacity)
                            # A stronger soft cost for the last available rest prevents
                            # moving an avoidable empty sector from Sunday to a weekday.
                            if capacity >= 2 and resting + 1 >= capacity:
                                total += 7
                        total += 0.15 * (2 * new_weekdays[weekday] + 1)
                        new_weekdays[weekday] += 1
                        if weekday in person["preferredOffDays"]:
                            total -= 0.1
                        if day not in tie_scores:
                            tie_scores[day] = (int(hashlib.sha256(f"{pid}:{day}".encode()).hexdigest()[:6], 16) % 97) / 9700
                        total += tie_scores[day]
                    if person["offPattern"] == "PREFER_CONSECUTIVE" and any((date.fromisoformat(day) + timedelta(days=1)).isoformat() in rests for day in rests):
                        total -= 0.1
                    next_beam.append((total, combined, new_weekdays))
            if not next_beam:
                beam = []
                break
            next_beam.sort(key=lambda item: item[0])
            # Keep two distinct Sunday trajectories through the whole month.
            # A greedy first week can force the same rest parity on the sector.
            # Rank first and skip duplicate Sunday patterns before temporal checks.
            beam = []
            signatures = set()
            for candidate in next_beam:
                if control is not None:
                    control.checkpoint()
                if deadline is not None and time.monotonic() >= deadline:
                    return result
                signature = tuple(day for day, entry in candidate[1].items()
                                  if weekdays[day] == 6 and entry['kind'] == 'OFF')
                if signature in signatures:
                    continue
                if _compatible(person, candidate[1], prior, metrics, policy, instant, sunday_limit, final_week):
                    beam.append(candidate)
                    signatures.add(signature)
                    if len(beam) == 2:
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
    regular_rest = lambda day: (known.get(day, {}).get("kind") == "OFF"
                                or known.get(day, {}).get("kind") == "HOLIDAY"
                                and date.fromisoformat(day).weekday() == 6)
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
                if civil != day and known.get(civil, {}).get("kind") in ("OFF", "ABSENCE", "HOLIDAY"):
                    return False
                occupied.add(civil)
        if day in proposed and entry["kind"] in ("WORK", "DUTY"):
            if day in policy["closedDates"] or day in policy["holidayDates"] and day not in policy["authorizedHolidayDates"] and not policy["_simulation"]:
                return False
        if day in proposed and entry["kind"] == "OFF" and holiday_rest_forbidden(policy, day):
            return False
        if day in proposed and regular_rest(day) and person["offPattern"] == "CONSECUTIVE":
            adjacent = [(date.fromisoformat(day) + timedelta(days=delta)).isoformat() for delta in (-1, 1)]
            if not any(regular_rest(other) for other in adjacent):
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
                if any(known.get((date.fromisoformat(day) + timedelta(days=offset)).isoformat(), {}).get("kind") in ("OFF", "HOLIDAY") for offset in range(1, delta)):
                    return False
    return True
