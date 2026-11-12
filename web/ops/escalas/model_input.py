"""Structural private-service boundary errors, without echoing submitted values."""
from datetime import date


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


def validate_model_input(data):
    data = _object(data, "input")
    _date(data.get("startDate"), "startDate")
    _date(data.get("endDate"), "endDate")
    horizon = (date.fromisoformat(data["endDate"]) - date.fromisoformat(data["startDate"])).days + 1
    _require(7 <= horizon <= 42 and horizon % 7 == 0, "endDate", "INVALID_HORIZON")
    _require(data.get("defaultWeeklyHours") in (40, 42, 44), "defaultWeeklyHours")
    if "simulation" in data:
        _require(type(data["simulation"]) is bool, "simulation", "EXPECTED_BOOLEAN")
    if "storeClosingMinutes" in data:
        _integer(data["storeClosingMinutes"], "storeClosingMinutes", 300, 1440)
    policy = _object(data.get("policy"), "policy")
    for field, lower, upper in (("dailyLimitMinutes", 1, 600), ("minInterShiftMinutes", 660, 1440),
                                ("minWeeklyRestMinutes", 2100, 4320), ("minMealMinutes", 30, 180),
                                ("maxConsecutiveWorkDays", 1, 6)):
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
            _require(segment["end"] > segment["start"] >= previous, place, "OVERLAPPING_SEGMENTS")
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
    sectors = {person['sector'] for person in people} | {demand['sector'] for demand in data['demands']}
    for index, priority in enumerate(data.get('movementPriorities', [])):
        if 'sector' in priority:
            _require(priority['sector'] in sectors, f'movementPriorities[{index}].sector', 'UNKNOWN_REFERENCE')
