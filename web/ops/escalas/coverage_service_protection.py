"""Private feasibility limits for demonstrated service, distinct from demand floors."""
import time
from collections import Counter, defaultdict
from datetime import date, datetime, time as civil_time, timedelta
from zoneinfo import ZoneInfo

from ortools.sat.python import cp_model

from model_input import SERVICE_SCOPES
from rest_quality import visible_month


SERVICE_CONFLICT = (
    "Não foi possível preservar a presença com horário da grade salva por setor/dia e cargo/faixa. "
    "Nenhum dia, afastamento ou bloqueio foi flexibilizado."
)
ZONE = ZoneInfo("America/Sao_Paulo")


def _scope_dates(dates, data):
    month = visible_month(data)
    full = frozenset(dates)
    shown = frozenset(day for day in full if not month or day.startswith(month + "-"))
    sundays = frozenset(day for day in full if date.fromisoformat(day).weekday() == 6)
    return dict(zip(SERVICE_SCOPES, (full, shown, sundays, shown & sundays)))


def _is_active(person, day):
    return person["activeFrom"] <= day and (not person.get("activeUntil") or day <= person["activeUntil"])


def _fixed_offset(previous_day, last_day):
    """A historical timezone transition has no unambiguous nominal-minute projection."""
    first = date.fromisoformat(previous_day)
    until = date.fromisoformat(last_day) + timedelta(days=1)
    offsets = {datetime.combine(first + timedelta(days=i), civil_time(), ZONE).utcoffset()
               for i in range((until - first).days + 1)}
    return len(offsets) == 1


def _clock_parts(shift, day, tomorrow):
    # The planning model always uses São Paulo, and historical offset changes
    # were rejected before using nominal civil arithmetic.
    return [(civil, max(0, segment["start"] - offset), min(1440, segment["end"] - offset))
            for segment in shift["segments"] if segment["kind"] == "WORK"
            for civil, offset in ((day, 0), (tomorrow, 1440))
            if segment["start"] < offset + 1440 and segment["end"] > offset]


def _clock_text(minute):
    return f"{minute // 60:02d}:{minute % 60:02d}"


def _slices(floors, windows, selected_days, expired):
    floor_events, service_events = defaultdict(list), defaultdict(list)
    for start, end, minimum in floors:
        floor_events[start].append((minimum, 1))
        floor_events[end].append((minimum, -1))
    for idx, ((civil, lo, hi), terms) in enumerate(windows.items()):
        if idx % 64 == 0 and expired():
            yield None
            return
        if civil in selected_days:
            for pid, term in terms:
                bucket = pid, civil
                service_events[lo].append((bucket, term, 1))
                service_events[hi].append((bucket, term, -1))
    required, active = Counter(), {}
    points = sorted(floor_events.keys() | service_events.keys())
    for idx, minute in enumerate(points[:-1]):
        if idx % 8 == 0 and expired():
            yield None
            return
        for minimum, delta in floor_events.get(minute, ()):
            required[minimum] += delta
            if not required[minimum]:
                del required[minimum]
        for bucket, term, delta in service_events.get(minute, ()):
            counts = active.setdefault(bucket, Counter())
            counts[term] += delta
            if not counts[term]:
                del counts[term]
            if not counts:
                del active[bucket]
        if required:
            yield minute, points[idx + 1], max(required), active


def add_service_protection(model, data, employees, dates, choices, shifts, deadline, control=None):
    """Return True, False on timeout or a proven conflict message; never relax a guard."""
    guard = data.get("_coverageServiceProtection") or {}
    days = {(row["sector"], row["date"]) for row in guard.get("days", ())}
    bands = guard.get("bands", ())
    if not days and not bands:
        return True

    def expired():
        if control is not None:
            control.checkpoint()
        return time.monotonic() >= deadline

    if expired():
        return False
    previous_day = (date.fromisoformat(dates[0]) - timedelta(days=1)).isoformat()
    if not _fixed_offset(previous_day, dates[-1]):
        return "Não foi possível projetar as faixas protegidas em um horizonte com mudança de fuso horário."

    scopes = _scope_dates(dates, data)
    floors = defaultdict(list)
    role_dates = defaultdict(set)
    for idx, band in enumerate(bands):
        if idx % 64 == 0 and expired():
            return False
        group = band["sector"], band["role"]
        date_set = scopes[band["scope"]]
        floors[group, date_set].append((band["start"], band["end"], band["minimum"]))
        role_dates[group].update(date_set)

    closed = set(data["policy"]["closedDates"])
    records = {(record["employeeId"], record["date"]): record for record in data["assignments"]}
    following = dict(zip([previous_day, *dates], [*dates, (date.fromisoformat(dates[-1]) + timedelta(days=1)).isoformat()]))
    sectors = {sector for sector, _ in days}
    people = {person["id"]: person for person in employees if person.get("planningEnabled") is not False
              and person.get("scheduleMode") not in ("MISSING", "UNTIMED")
              and (person["sector"] in sectors or (person["sector"], person["role"]) in role_dates)}
    daily_terms = defaultdict(set)
    windows = defaultdict(lambda: defaultdict(set))
    parts_cache, anchors, emitted, combined = {}, {}, set(), {}

    def register(person, day, sid, term):
        pid, sector = person["id"], person["sector"]
        role_key = sector, person["role"]
        tomorrow = following[day]
        required_dates = role_dates.get(role_key, ())
        if (sector, day) not in days and (sector, tomorrow) not in days and day not in required_dates and tomorrow not in required_dates:
            return
        key = day, sid
        if key not in parts_cache:
            parts_cache[key] = _clock_parts(shifts[sid], day, tomorrow)
        for civil, start, end in parts_cache[key]:
            if civil in closed or not _is_active(person, civil):
                continue
            old = records.get((pid, civil), {})
            if old.get("kind") in ("ABSENCE", "HOLIDAY") or old.get("kind") == "OFF" and old.get("locked"):
                continue
            if (sector, civil) in days:
                daily_terms[sector, civil].add(term)
            if civil in required_dates:
                windows[role_key][civil, start, end].add((pid, term))

    for idx, ((pid, day), options) in enumerate(choices.items()):
        if idx % 64 == 0 and expired():
            return False
        person = people.get(pid)
        if person is None:
            continue
        for sid, variable in options.items():
            anchors[variable.index] = day
            register(person, day, sid, variable.index)
    for person in people.values():
        prior = {record["date"]: record for record in person.get("planningHistory", []) + person["history"]}
        record = prior.get(previous_day)
        if record and record["kind"] == "WORK" and _is_active(person, previous_day):
            register(person, previous_day, record["shiftId"], None)

    def impose(terms, minimum):
        key = minimum, tuple(sorted(terms))
        if key not in emitted:
            model.add(cp_model.LinearExpr.sum([model.get_bool_var_from_proto_index(index) for index in key[1]]) >= minimum)
            emitted.add(key)

    for idx, key in enumerate(sorted(days)):
        if idx % 64 == 0 and expired():
            return False
        terms = daily_terms.get(key, ())
        if None not in terms:
            if not terms:
                sector, civil = key
                return f"Setor {sector or 'sem nome'}, {civil}: nenhuma faixa de trabalho disponível. " + SERVICE_CONFLICT
            impose(terms, 1)

    for (group, selected_days), bands_in_scope in floors.items():
        if expired():
            return False
        for interval in _slices(bands_in_scope, windows[group], selected_days, expired):
            if interval is None:
                return False
            begin, end, minimum, active = interval
            if len(active) < minimum:
                sector, role = group
                scope = "/".join(name for name, selection in scopes.items() if selection == selected_days)
                return (f"Setor {sector or 'sem nome'}, cargo {role or 'sem nome'}, {scope}, "
                        f"{_clock_text(begin)}–{_clock_text(end)}: até {len(active)} pessoas-dia disponíveis "
                        f"para preservar {minimum}. " + SERVICE_CONFLICT)
            terms = []
            for idx, bucket in enumerate(active.values()):
                if idx % 128 == 0 and expired():
                    return False
                if None in bucket:
                    minimum -= 1
                    continue
                # Same-anchor shifts are already mutually exclusive. If clocks
                # can arrive from multiple anchors, count that civil person-day once.
                if len({anchors[term] for term in bucket}) > 1:
                    key = tuple(sorted(bucket))
                    if key not in combined:
                        present = model.new_bool_var("protected-service")
                        model.add_max_equality(present, [model.get_bool_var_from_proto_index(term) for term in key])
                        combined[key] = present.index
                    terms.append(combined[key])
                else:
                    terms.extend(bucket)
            if minimum > 0:
                impose(terms, minimum)
    return True
