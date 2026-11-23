"""Hard non-regression on the frozen estimated coverage ruler."""
from collections import Counter, defaultdict

from ortools.sat.python import cp_model


COMPARISON_CONFLICT = (
    "Não foi possível manter os limites de desfalque da grade salva junto às demais regras. "
    "Nenhuma regra de cobertura, horário ou folga foi flexibilizada."
)

SCOPE_LABELS = {"HORIZON": "período", "MONTH": "mês", "SUNDAYS": "domingos do período",
                "MONTH_SUNDAYS": "domingos do mês"}


def _band_conflict(group, start, end, shortage, limit, metric):
    scope, sector, role = group
    context = f"{sector[:64]} / {role[:64]}" if role else sector[:64]
    return (
        f"Não foi possível manter o limite de desfalque: {context}, {SCOPE_LABELS.get(scope, scope)}, "
        f"{start // 60:02d}h{start % 60:02d}–{end // 60:02d}h{end % 60:02d}. "
        f"{metric}: pelo menos {shortage} com os horários permitidos, limite {limit}."
    )


class CoverageComparison:
    def __init__(self, payload):
        self.protect_daily_bands = "dailyBands" in payload
        self.sectors = {row["sector"]: row for row in payload["sectors"]}
        self.bands = defaultdict(list)
        self.expressions = defaultdict(Counter)
        self.peaks = {}
        for row in payload["bands"]:
            key = row["scope"], row["sector"], row["role"]
            self.bands[key].append((row["start"], row["end"], row["maximum"], row["peak"]))
        for row in payload.get("dailyBands", ()):
            key = row["date"], row["sector"], row["role"]
            self.bands[key].append((row["start"], row["end"], row["maximum"], row["maximum"]))

    def _track_peak(self, term, limit):
        if isinstance(term, int):
            return term <= limit
        self.peaks[term.index] = min(limit, self.peaks.get(term.index, limit))
        return True

    def track_sector(self, sector, shortage):
        return self._track_peak(shortage, self.sectors.get(sector, {}).get("peak", 0))

    def track_band(self, sector, role, shortage, occurrences):
        if isinstance(shortage, int) and not shortage:
            return
        # The coefficient is the number of dates, not interval duration.
        # Multiplying by civil minutes would obscure the unit of the cap.
        term = (True, shortage) if isinstance(shortage, int) else (False, shortage.index)
        for (scope, start, end), count in occurrences.items():
            self.expressions[scope, sector, role][start, end, term] += count

    def constrain(self, model, sector_terms, expired):
        """Impose pointwise caps on a common civil partition, plus sector totals."""
        limits = {}
        for groups, field in sector_terms:
            for index, (sector, terms) in enumerate(groups.items()):
                if index % 32 == 0 and expired():
                    return False
                if terms:
                    cap = self.sectors.get(sector, {}).get(field, 0)
                    model.add(cp_model.LinearExpr.sum(terms) <= cap)
        for group, expressions in self.expressions.items():
            if expired():
                return False
            result = self._band_limits(group, expressions, limits, expired)
            if result is not True:
                return result
        for index, (signature, cap) in enumerate(limits.items()):
            if index % 16 == 0 and expired():
                return False
            model.add(cp_model.LinearExpr.sum([
                count * model.get_int_var_from_proto_index(var) for var, count in signature]) <= cap)
        for index, (var, cap) in enumerate(self.peaks.items()):
            if index % 64 == 0 and expired():
                return False
            model.add(model.get_int_var_from_proto_index(var) <= cap)
        return True

    def _band_limits(self, group, expressions, limits, expired):
        events, cap_events = defaultdict(list), defaultdict(list)
        for index, ((start, end, term), count) in enumerate(expressions.items()):
            if index % 64 == 0 and expired():
                return False
            events[start].append((term, count))
            events[end].append((term, -count))
        for start, end, maximum, peak in self.bands.get(group, ()):
            row = maximum, peak
            cap_events[start].append((row, 1))
            cap_events[end].append((row, -1))
        active, caps = Counter(), Counter()
        points = sorted(events.keys() | cap_events.keys())
        for index, minute in enumerate(points[:-1]):
            if index % 16 == 0 and expired():
                return False
            for key, change in events.get(minute, ()):
                active[key] += change
                if not active[key]:
                    del active[key]
            for key, change in cap_events.get(minute, ()):
                caps[key] += change
                if not caps[key]:
                    del caps[key]
            if not active:
                continue
            maximum = min((cap[0] for cap in caps), default=0)
            peak = min((cap[1] for cap in caps), default=0)
            terms, fixed = [], 0
            for position, ((constant, value), count) in enumerate(active.items()):
                if position % 128 == 0 and expired():
                    return False
                if constant:
                    fixed += value * count
                    if value > peak:
                        return _band_conflict(group, minute, points[index + 1], value, peak, "Pico de pessoas")
                    if fixed > maximum:
                        return _band_conflict(group, minute, points[index + 1], fixed, maximum, "Soma das carências")
                else:
                    terms.append((value, count))
                    self.peaks[value] = min(peak, self.peaks.get(value, peak))
            if terms:
                cap = maximum - fixed
                if len(terms) == 1 and terms[0][1] == 1:
                    variable = terms[0][0]
                    self.peaks[variable] = min(cap, self.peaks.get(variable, cap))
                else:
                    signature = tuple(sorted(terms))
                    limits[signature] = min(cap, limits.get(signature, cap))
        return True
