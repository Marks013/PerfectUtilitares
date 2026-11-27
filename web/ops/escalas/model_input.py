"""Structural private-service boundary errors, without echoing submitted values."""
from datetime import date
from rest_configuration import fixed_rest_projection
from planning_calendar import is_december_cutover, planning_week_starts_on, planning_weeks


SERVICE_SCOPES = ("HORIZON", "MONTH", "SUNDAYS", "MONTH_SUNDAYS")
DECEMBER_ADVISORY_DATES = frozenset(f"2026-12-{day:02d}" for day in range(1, 6))


class ModelInputError(ValueError):
    def __init__(self, path, reason):
        super().__init__("INVALID_MODEL_INPUT")
        self.fields = [{"path": path, "reason": reason}]


def _require(condition, path, reason="INVALID_VALUE"):
    if not condition:
        raise ModelInputError(path, reason)


def _object(value, path):
    _require(isinstance(value, dict), path, "EXPECTED_OBJECT")
    return value


def _array(value, path, maximum):
    _require(isinstance(value, list), path, "EXPECTED_ARRAY")
    _require(len(value) <= maximum, path, "TOO_MANY_ITEMS")
    return value


def _date(value, path, allow_empty=False):
    if allow_empty and value == "":
        return
    _require(isinstance(value, str) and len(value) == 10, path, "INVALID_DATE")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ModelInputError(path, "INVALID_DATE") from None
    _require(parsed.isoformat() == value and 1900 <= parsed.year <= 2099, path, "INVALID_DATE")


def _integer(value, path, minimum, maximum):
    _require(type(value) is int and minimum <= value <= maximum, path, "INVALID_INTEGER")


def _identifier(value, path):
    _require(isinstance(value, str) and 0 < len(value) <= 100, path, "INVALID_IDENTIFIER")


def _assignments(entries, path, maximum, employee_ids, shift_ids, scoped=False):
    for index, entry in enumerate(_array(entries, path, maximum)):
        prefix = f"{path}[{index}]"
        entry = _object(entry, prefix)
        _date(entry.get("date"), prefix + ".date")
        if "locked" in entry:
            _require(type(entry["locked"]) is bool, prefix + ".locked", "EXPECTED_BOOLEAN")
        if not scoped:
            _require(entry.get("employeeId") in employee_ids, prefix + ".employeeId", "UNKNOWN_REFERENCE")
        _require(entry.get("kind") in ("WORK", "DUTY", "OFF", "ABSENCE", "HOLIDAY"), prefix + ".kind")
        if entry["kind"] == "WORK":
            _require(entry.get("shiftId") in shift_ids, prefix + ".shiftId", "UNKNOWN_REFERENCE")
        else:
            _require("shiftId" not in entry, prefix + ".shiftId")


def validate_manual_shifts(data):
    """Validate dated local IDs without echoing map keys or employee values."""
    if not any('manualShiftByDate' in person for person in data['employees']):
        return
    shift_ids = {shift['id'] for shift in data['shifts']}
    locked_work = {}
    for entry in data['assignments']:
        if entry.get('locked') and entry['kind'] == 'WORK':
            locked_work.setdefault((entry['employeeId'], entry['date']), set()).add(entry['shiftId'])
    for index, person in enumerate(data['employees']):
        if 'manualShiftByDate' not in person:
            continue
        prefix = f'employees[{index}].manualShiftByDate'
        selection = _object(person['manualShiftByDate'], prefix)
        _require(len(selection) <= 42, prefix, 'TOO_MANY_ITEMS')
        _require(not selection or person.get('scheduleMode') not in ('UNTIMED', 'MISSING'),
                 prefix, 'MANUAL_SHIFT_REQUIRES_TIMED_EMPLOYEE')
        for offset, (day, sid) in enumerate(selection.items()):
            place = f'{prefix}[{offset}]'
            _date(day, place + '.date')
            _require(data['startDate'] <= day <= data['endDate'], place + '.date', 'OUTSIDE_HORIZON')
            _require(person['activeFrom'] <= day
                     and (not person.get('activeUntil') or day <= person['activeUntil']),
                     place + '.date', 'OUTSIDE_EMPLOYMENT')
            _identifier(sid, place + '.shiftId')
            _require(sid in shift_ids, place + '.shiftId', 'UNKNOWN_REFERENCE')
            # The dated map authorizes this local target only on this day.
            # shiftIds remains the normal base; never widen it for manual choices.
            locked = locked_work.get((person['id'], day), set())
            _require(not locked or locked == {sid}, place + '.shiftId', 'MANUAL_SHIFT_LOCK_CONFLICT')


def validate_fixed_rest_settings(data):
    for index, person in enumerate(data["employees"]):
        try:
            fixed_rest_projection(person)
        except (ValueError, TypeError):
            raise ModelInputError(f"employees[{index}].fixedRestSlots", "INVALID_FIXED_REST_CONFIGURATION") from None


def validate_planning_horizon(data):
    """The transport and direct solver share the same versioned week boundary."""
    try:
        planning_week_starts_on(data)
    except (ValueError, TypeError):
        raise ModelInputError('planningWeekStartsOn', 'INVALID_VALUE') from None
    try:
        planning_weeks(data)
    except (ValueError, TypeError):
        raise ModelInputError('endDate', 'INVALID_HORIZON') from None


def _validate_service_protection(data, roles_by_sector):
    path = "_coverageServiceProtection"
    service = _object(data[path], path)
    _require(service.keys() == {"days", "bands"}, path, "INVALID_FIELDS")
    for index, entry in enumerate(_array(service["days"], path + ".days", 10500)):
        prefix = f"{path}.days[{index}]"
        row = _object(entry, prefix)
        _require(row.keys() == {"date", "sector"}, prefix, "INVALID_FIELDS")
        _date(row["date"], prefix + ".date")
        _require(data["startDate"] <= row["date"] <= data["endDate"], prefix + ".date", "OUTSIDE_HORIZON")
        sector = row["sector"]
        _require(isinstance(sector, str) and sector in roles_by_sector, prefix + ".sector", "UNKNOWN_REFERENCE")
    for index, entry in enumerate(_array(service["bands"], path + ".bands", 12000)):
        prefix = f"{path}.bands[{index}]"
        row = _object(entry, prefix)
        _require(row.keys() == {"sector", "role", "start", "end", "scope", "minimum"}, prefix, "INVALID_FIELDS")
        sector, role = row["sector"], row["role"]
        _require(isinstance(sector, str) and sector in roles_by_sector, prefix + ".sector", "UNKNOWN_REFERENCE")
        _require(isinstance(role, str) and role in roles_by_sector[sector], prefix + ".role", "UNKNOWN_REFERENCE")
        _require(row["scope"] in SERVICE_SCOPES, prefix + ".scope")
        _integer(row["start"], prefix + ".start", 0, 1439)
        _integer(row["end"], prefix + ".end", 1, 1440)
        _require(row["start"] < row["end"], prefix, "INVALID_INTERVAL")
        _integer(row["minimum"], prefix + ".minimum", 1, 10500)


def coverage_advisory_estimate_dates(data):
    """Admit only the confirmed five civil dates on an exact December cutover."""
    comparison = data.get("_coverageComparison", {})
    if "advisoryEstimateDates" not in comparison:
        return frozenset()
    path = "_coverageComparison.advisoryEstimateDates"
    _require(is_december_cutover(data), path, "INVALID_SCOPE")
    dates = _array(comparison["advisoryEstimateDates"], path, len(DECEMBER_ADVISORY_DATES))
    _require(len(dates) == len(DECEMBER_ADVISORY_DATES) and all(isinstance(day, str) for day in dates)
             and frozenset(dates) == DECEMBER_ADVISORY_DATES, path, "INVALID_DATES")
    return DECEMBER_ADVISORY_DATES


def _validate_coverage_comparison(data, roles_by_sector):
    path = "_coverageComparison"
    comparison = _object(data[path], path)
    fields = {"sectors", "bands"}
    if "dailyBands" in comparison and is_december_cutover(data):
        fields.add("dailyBands")
    advisory_dates = coverage_advisory_estimate_dates(data)
    if advisory_dates:
        fields.add("advisoryEstimateDates")
    _require(comparison.keys() == fields, path, "INVALID_FIELDS")
    # A demand-only sector or function can have a real nonzero saved shortage.
    scopes = {sector: set(roles) for sector, roles in roles_by_sector.items()}
    for demand in data["demands"]:
        roles = scopes.setdefault(demand["sector"], set())
        if isinstance(demand.get("role"), str):
            roles.add(demand["role"])
    # The bounded payload can contain overlapping minima for distinct functions.
    maximum_peak = 12000 * 250
    maximum_minutes = maximum_peak * 42 * 1440
    fields = {"horizon", "month", "sundays", "monthSundays", "closing"}
    sectors = set()
    for index, entry in enumerate(_array(comparison["sectors"], path + ".sectors", 12000)):
        prefix = f"{path}.sectors[{index}]"
        row = _object(entry, prefix)
        _require(row.keys() == fields | {"sector", "peak"}, prefix, "INVALID_FIELDS")
        sector = row["sector"]
        _require(isinstance(sector, str) and sector in scopes, prefix + ".sector", "UNKNOWN_REFERENCE")
        _require(sector not in sectors, prefix + ".sector", "DUPLICATE_REFERENCE")
        sectors.add(sector)
        for field in sorted(fields):
            _integer(row[field], prefix + "." + field, 0, maximum_minutes)
        _integer(row["peak"], prefix + ".peak", 0, maximum_peak)
    for index, entry in enumerate(_array(comparison["bands"], path + ".bands", 12000)):
        prefix = f"{path}.bands[{index}]"
        row = _object(entry, prefix)
        _require(row.keys() == {"scope", "sector", "role", "start", "end", "maximum", "peak"}, prefix, "INVALID_FIELDS")
        sector, role = row["sector"], row["role"]
        _require(isinstance(sector, str) and sector in scopes, prefix + ".sector", "UNKNOWN_REFERENCE")
        _require(role is None or isinstance(role, str) and role in scopes[sector], prefix + ".role", "UNKNOWN_REFERENCE")
        _require(row["scope"] in SERVICE_SCOPES, prefix + ".scope")
        _integer(row["start"], prefix + ".start", 0, 1439)
        _integer(row["end"], prefix + ".end", 1, 1440)
        _require(row["start"] < row["end"], prefix, "INVALID_INTERVAL")
        _integer(row["maximum"], prefix + ".maximum", 0, maximum_peak * 42)
        _integer(row["peak"], prefix + ".peak", 0, maximum_peak)
    for index, entry in enumerate(_array(comparison.get("dailyBands", []), path + ".dailyBands", 12000)):
        prefix = f"{path}.dailyBands[{index}]"
        row = _object(entry, prefix)
        _require(row.keys() == {"date", "sector", "role", "start", "end", "maximum"}, prefix, "INVALID_FIELDS")
        _date(row["date"], prefix + ".date")
        _require(row["date"] not in advisory_dates, prefix + ".date", "ADVISORY_ESTIMATE_DATE")
        _require(data["startDate"] <= row["date"] <= data["endDate"], prefix + ".date", "OUTSIDE_HORIZON")
        sector, role = row["sector"], row["role"]
        _require(isinstance(sector, str) and sector in scopes, prefix + ".sector", "UNKNOWN_REFERENCE")
        _require(role is None or isinstance(role, str) and role in scopes[sector], prefix + ".role", "UNKNOWN_REFERENCE")
        _integer(row["start"], prefix + ".start", 0, 1439)
        _integer(row["end"], prefix + ".end", 1, 1440)
        _require(row["start"] < row["end"], prefix, "INVALID_INTERVAL")
        _integer(row["maximum"], prefix + ".maximum", 0, maximum_peak)


def _presence_only(people):
    """No hourly upper-bound semantics when every enabled person has no clock."""
    return (isinstance(people, list) and bool(people)
            and any(isinstance(p, dict) and p.get("planningEnabled") is not False for p in people)
            and all(isinstance(p, dict) and (p.get("planningEnabled") is False
                    or p.get("scheduleMode") in ("UNTIMED", "MISSING")) for p in people))


def validate_model_input(data):
    data = _object(data, "input")
    _date(data.get("startDate"), "startDate")
    _date(data.get("endDate"), "endDate")
    validate_planning_horizon(data)
    _require(data.get("defaultWeeklyHours") in (40, 42, 44), "defaultWeeklyHours")
    if 'restRulesVersion' in data:
        _integer(data['restRulesVersion'], 'restRulesVersion', 1, 2147483647)
    if "simulation" in data:
        _require(type(data["simulation"]) is bool, "simulation", "EXPECTED_BOOLEAN")
    if "storeClosingMinutes" in data:
        _integer(data["storeClosingMinutes"], "storeClosingMinutes", 300, 1440)
    policy = _object(data.get("policy"), "policy")
    for field, lower, upper in (("dailyLimitMinutes", 1, 600), ("minInterShiftMinutes", 660, 1440),
                                ("minWeeklyRestMinutes", 2100, 4320), ("minMealMinutes", 30, 180),
                                ("maxConsecutiveWorkDays", 1, 6)):
        if field in ("minInterShiftMinutes", "minWeeklyRestMinutes") and _presence_only(data.get("employees")):
            upper = 2147483647
        _integer(policy.get(field), "policy." + field, lower, upper)
    _require(policy.get("weeklyLimit") in (40, 42, 44), "policy.weeklyLimit")
    for field in ("compensationAuthorized", "holidayRestAllowed"):
        _require(type(policy.get(field)) is bool, "policy." + field, "EXPECTED_BOOLEAN")
    for field in ("closedDates", "holidayDates", "authorizedHolidayDates"):
        for index, day in enumerate(_array(policy.get(field), "policy." + field, 100)):
            _date(day, f"policy.{field}[{index}]")
    shifts, shift_ids = _array(data.get("shifts"), "shifts", 120), set()
    for index, shift in enumerate(shifts):
        prefix = f"shifts[{index}]"
        shift = _object(shift, prefix)
        _identifier(shift.get("id"), prefix + ".id")
        _require(shift["id"] not in shift_ids, prefix + ".id", "DUPLICATE_IDENTIFIER")
        shift_ids.add(shift["id"])
        segments = _array(shift.get("segments"), prefix + ".segments", 12)
        _require(bool(segments), prefix + ".segments", "REQUIRED")
        previous, paid = -1, 0
        for offset, segment in enumerate(segments):
            place = f"{prefix}.segments[{offset}]"
            segment = _object(segment, place)
            _integer(segment.get("start"), place + ".start", 0, 2879)
            _integer(segment.get("end"), place + ".end", 1, 2880)
            _require(segment["end"] > segment["start"] and (offset == 0 or segment["start"] == previous), place, "OVERLAPPING_SEGMENTS")
            _require(segment.get("kind") in ("WORK", "PAID_BREAK", "BREAK"), place + ".kind")
            previous = segment["end"]
            paid += segment["end"] - segment["start"] if segment["kind"] != "BREAK" else 0
        _require(segments[0]["start"] < 1440 and segments[0]["kind"] != "BREAK"
                 and segments[-1]["kind"] != "BREAK" and 0 < paid <= 600
                 and previous - segments[0]["start"] <= 1080, prefix + ".segments", "INVALID_SHIFT")
    people = _array(data.get("employees"), "employees", 250)
    _require(bool(people), "employees", "REQUIRED")
    employee_ids = set()
    for index, person in enumerate(people):
        prefix = f"employees[{index}]"
        person = _object(person, prefix)
        _identifier(person.get("id"), prefix + ".id")
        _require(person["id"] not in employee_ids, prefix + ".id", "DUPLICATE_IDENTIFIER")
        employee_ids.add(person["id"])
        if "leadership" in person:
            leader = _object(person["leadership"], prefix + ".leadership")
            _require(leader.get("role") in ("SECTOR", "BRANCH", "NONE"), prefix + ".leadership.role")
            _require(leader.get("source") in ("INFERRED", "MANUAL"), prefix + ".leadership.source")
            sectors = _array(leader.get("sectors"), prefix + ".leadership.sectors", 250)
            for offset, sector in enumerate(sectors):
                _require(isinstance(sector, str) and 0 < len(sector) <= 160,
                         f"{prefix}.leadership.sectors[{offset}]")
            _require(len(set(sectors)) == len(sectors), prefix + ".leadership.sectors", "DUPLICATE_REFERENCE")
            _require(leader["role"] != "NONE" or not sectors, prefix + ".leadership.sectors")
        for field in ("sector", "role"):
            _require(isinstance(person.get(field), str) and len(person[field]) <= 160, prefix + "." + field)
        _require(person.get("weeklyHours") in (40, 42, 44), prefix + ".weeklyHours")
        _require(person.get("offMode") in ("FIXED", "MIXED", "VARIABLE"), prefix + ".offMode")
        _require(person.get("offPattern") in ("ANY", "CONSECUTIVE", "PREFER_CONSECUTIVE"), prefix + ".offPattern")
        _integer(person.get("maxConsecutiveSundays"), prefix + ".maxConsecutiveSundays", 1, 2)
        _date(person.get("activeFrom"), prefix + ".activeFrom", allow_empty=True)
        if "activeUntil" in person:
            _date(person["activeUntil"], prefix + ".activeUntil")
        for field in ("fixedOffDays", "preferredOffDays"):
            for offset, day in enumerate(_array(person.get(field), prefix + "." + field, 7)):
                _integer(day, f"{prefix}.{field}[{offset}]", 0, 6)
        for offset, sid in enumerate(_array(person.get("shiftIds"), prefix + ".shiftIds", 12)):
            _require(sid in shift_ids, f"{prefix}.shiftIds[{offset}]", "UNKNOWN_REFERENCE")
        for field, maximum in (("history", 56), ("planningHistory", 56), ("planningFuture", 21)):
            _assignments(person.get(field, []), prefix + "." + field, maximum, employee_ids, shift_ids, scoped=True)
    _assignments(data.get("assignments"), "assignments", 10500, employee_ids, shift_ids)
    if "_initialAssignments" in data:
        _assignments(data["_initialAssignments"], "_initialAssignments", 10500, employee_ids, shift_ids)
    validate_manual_shifts(data)
    validate_fixed_rest_settings(data)
    for index, priority in enumerate(_array(data.get("movementPriorities", []), "movementPriorities", 250)):
        prefix = f"movementPriorities[{index}]"
        priority = _object(priority, prefix)
        for field in ("startDate", "endDate"):
            _date(priority.get(field), prefix + "." + field)
        _require(data["startDate"] <= priority["startDate"] <= priority["endDate"] <= data["endDate"], prefix, "INVALID_INTERVAL")
        _require(priority.get("level") in ("LOW", "NORMAL", "HIGH"), prefix + ".level")
        if "sector" in priority:
            _require(isinstance(priority["sector"], str) and 0 < len(priority["sector"]) <= 160, prefix + ".sector")
    for index, demand in enumerate(_array(data.get("demands"), "demands", 12000)):
        prefix = f"demands[{index}]"
        demand = _object(demand, prefix)
        _date(demand.get("date"), prefix + ".date")
        _require(isinstance(demand.get("sector"), str), prefix + ".sector")
        _integer(demand.get("start"), prefix + ".start", 0, 1439)
        _integer(demand.get("end"), prefix + ".end", 1, 1440)
        _require(demand["end"] > demand["start"], prefix, "INVALID_INTERVAL")
        _integer(demand.get("minimum"), prefix + ".minimum", 0, 250)
    if any(field in data for field in ("_coverageProtection", "_coverageServiceProtection", "_coverageComparison")):
        roles_by_sector = {}
        for person in people:
            if person.get("planningEnabled") is not False:
                roles_by_sector.setdefault(person["sector"], set()).add(person["role"])
    if "_coverageServiceProtection" in data:
        _validate_service_protection(data, roles_by_sector)
    if "_coverageComparison" in data:
        _validate_coverage_comparison(data, roles_by_sector)
    if "_restPairTarget" in data:
        path = "_restPairTarget"
        _integer(data[path], path, 20, 20)
        _require(is_december_cutover(data) and data.get("generationMode") == "DAYS_AND_HOURS",
                 path, "INVALID_SCOPE")
        service = data.get("_coverageServiceProtection", {})
        # A genuine historical service reference is mandatory. A reference
        # containing only estimates may have no explicit minimum sectors.
        _require("_coverageComparison" in data and bool(service.get("days") and service.get("bands")),
                 path, "REQUIRED_COVERAGE_PROTECTION")
    if "_coverageProtection" in data:
        for index, floor in enumerate(_array(data["_coverageProtection"], "_coverageProtection", 12000)):
            prefix = f"_coverageProtection[{index}]"
            floor = _object(floor, prefix)
            _require(floor.keys() <= {"date", "sector", "role", "start", "end", "minimum"}, prefix, "UNKNOWN_FIELD")
            _date(floor.get("date"), prefix + ".date")
            _require(data["startDate"] <= floor["date"] <= data["endDate"], prefix + ".date", "OUTSIDE_HORIZON")
            sector = floor.get("sector")
            _require(isinstance(sector, str) and bool(sector) and sector in roles_by_sector,
                     prefix + ".sector", "UNKNOWN_REFERENCE")
            if "role" in floor:
                role = floor["role"]
                _require(isinstance(role, str) and bool(role) and role in roles_by_sector[sector],
                         prefix + ".role", "UNKNOWN_REFERENCE")
            _integer(floor.get("start"), prefix + ".start", 0, 1439)
            _integer(floor.get("end"), prefix + ".end", 1, 1440)
            _require(floor["end"] > floor["start"], prefix, "INVALID_INTERVAL")
            _integer(floor.get("minimum"), prefix + ".minimum", 1, 250)
    sectors = {person['sector'] for person in people} | {demand['sector'] for demand in data['demands']}
    for index, priority in enumerate(data.get('movementPriorities', [])):
        if 'sector' in priority:
            _require(priority['sector'] in sectors, f'movementPriorities[{index}].sector', 'UNKNOWN_REFERENCE')
