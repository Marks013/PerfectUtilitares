"""Engine-neutral original contract fixtures; not solver-selected outputs."""

from datetime import date, timedelta
from planning_calendar import planning_weeks


def fixture(hours=42, people=1, weeks=1, start_date="2026-11-02", shift_hours=None):
    start = date.fromisoformat(start_date)
    minutes = (shift_hours if shift_hours is not None else hours) * 12
    data = {
        "schemaVersion": 1,
        "branchCode": "01",
        "branchName": "Filial de teste",
        "startDate": start.isoformat(),
        "endDate": (start + timedelta(days=weeks * 7 - 1)).isoformat(),
        "defaultWeeklyHours": hours,
        "timeZone": "America/Sao_Paulo",
        "policy": {
            "source": "Norma de teste",
            "validFrom": "2026-01-01",
            "validUntil": "2026-12-31",
            "reviewed": True,
            "reviewedBy": "Teste",
            "weeklyLimit": 44,
            "dailyLimitMinutes": 600,
            "compensationAuthorized": True,
            "minInterShiftMinutes": 660,
            "minWeeklyRestMinutes": 2100,
            "minMealMinutes": 60,
            "maxConsecutiveWorkDays": 6,
            "closedDates": [],
            "holidayDates": [],
            "authorizedHolidayDates": [],
            "holidayRestAllowed": False,
            "nightWorkReviewed": False,
        },
        "shifts": [
            {
                "id": "day",
                "name": "Diurno",
                "segments": [
                    {"start": 480, "end": 720, "kind": "WORK"},
                    {"start": 720, "end": 780, "kind": "BREAK"},
                    {"start": 780, "end": 780 + minutes - 240, "kind": "WORK"},
                ],
            }
        ],
        "employees": [],
        "demands": [],
        "assignments": [],
    }
    for index in range(people):
        pid = f"p{index}"
        person = {
            "id": pid,
            "registration": f"00{index}",
            "name": f"Colaborador {index}",
            "sector": "Reposição",
            "role": "Repositor",
            "weeklyHours": hours,
            "shiftIds": ["day"],
            "activeFrom": "2020-01-01",
            "offMode": "VARIABLE",
            "fixedOffDays": [],
            "offPattern": "ANY",
            "maxConsecutiveSundays": 2,
            "sundayRestRule": "COMMERCE",
            "preferredOffDays": [],
            "historyKnown": True,
            "history": [],
        }
        for offset in range(-21, 0):
            current = start + timedelta(days=offset)
            item = {
                "employeeId": pid,
                "date": current.isoformat(),
                "kind": "OFF" if current.weekday() in (5, 6) else "WORK",
            }
            if item["kind"] == "WORK":
                item["shiftId"] = "day"
            person["history"].append(item)
        data["employees"].append(person)
    return data


def authorize_transition(data, valid_from="2026-12-16", valid_until="2027-12-15"):
    data["policy"]["collectiveAgreement"] = {
        "source": "Acordo coletivo assinado no cenário de teste",
        "validFrom": valid_from,
        "validUntil": valid_until,
        "reviewedBy": "Responsável de teste",
        "reviewed": True,
    }


def make_untimed(person):
    person.update(scheduleMode="UNTIMED", shiftIds=[])
    for entry in person["history"]:
        if entry["kind"] == "WORK":
            entry["kind"] = "DUTY"
            entry.pop("shiftId", None)


def days_between(start, end):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    return [
        (first + timedelta(days=n)).isoformat() for n in range((last - first).days + 1)
    ]


def locked_roster(data, rests, long_days=()):
    """A concrete calendar is the oracle; no optimizer-selected pattern is assumed."""
    holidays = set(data["policy"].get("paidHolidayDates", []))
    data["assignments"] = []
    for person in data["employees"]:
        for week in planning_weeks(data):
            for day in week["dates"]:
                kind = (
                    "HOLIDAY" if day in holidays else "OFF" if day in rests else "WORK"
                )
                if kind == "WORK" and person.get("scheduleMode") == "UNTIMED":
                    kind = "DUTY"
                entry = {
                    "employeeId": person["id"],
                    "date": day,
                    "kind": kind,
                    "locked": True,
                }
                if kind == "WORK":
                    entry["shiftId"] = "long" if day in long_days else "day"
                data["assignments"].append(entry)


def scenario(branch="02", weeks=4):
    data = fixture(42, people=2, weeks=weeks, start_date="2026-11-29")
    data.update(
        branchCode=branch,
        planningWeekStartsOn="SUNDAY",
        restRulesVersion=3,
        generationMode="REST_ONLY",
    )
    data["policy"]["maxConsecutiveWorkDays"] = 5
    for person in data["employees"]:
        person["history"] = []
    return data


def supported_fixture(people=3):
    """Supported envelope for transport tests only, not a rewrite of real input."""
    data = fixture(40, people=people, start_date="2026-11-01")
    data.update(
        branchCode="02",
        simulation=False,
        planningWeekStartsOn="SUNDAY",
        restRulesVersion=3,
        storeClosingMinutes=1200,
        generationMode="DAYS_AND_HOURS",
    )
    data["policy"].update(
        calendarMode="MANUAL", normativeProfile="CUSTOM", maxConsecutiveWorkDays=5
    )
    for index, person in enumerate(data["employees"]):
        person.update(
            id=f"employee:{index}",
            name=f"Contract employee {index}",
            history=[],
            historyKnown=False,
            sundayRestRule="PROTECTIVE",
            maxConsecutiveSundays=1,
            scheduleMode="TIMED",
            activeFrom="",
        )
    data["demands"] = [
        {
            "id": "confirmed",
            "date": "2026-11-04",
            "sector": "Reposição",
            "start": 480,
            "end": 540,
            "minimum": 1,
            "estimated": False,
        }
    ]
    return data
