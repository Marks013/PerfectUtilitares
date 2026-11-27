//! An optional starting suggestion is never the authoritative assignment grid.
//! The HTTP schema remains strict; native service fallback discards the WHOLE
//! unusable suggestion and does not reinterpret a timeout as invalid user data.
use super::{Calendar, Record, Result, V, array, check, code, text};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

type Hints<'a> = BTreeMap<(&'a str, i32), Record>;
pub(super) fn read<'a>(
    input: &'a V,
    calendar: &Calendar,
    ids: &BTreeMap<String, u8>,
    service: bool,
    deadline: Instant,
) -> Result<Hints<'a>> {
    let Some(_) = input.get("_initialAssignments") else {
        return Ok(BTreeMap::new());
    };
    let parse = || -> Result<Hints<'a>> {
        check(Instant::now() < deadline, "MAPPING_TIMEOUT")?;
        let entries = array(input, "_initialAssignments")?;
        check(entries.len() <= 10500, "HINT_LIMIT")?;
        if entries.is_empty() {
            return Ok(BTreeMap::new());
        }
        let people: BTreeMap<_, _> = array(input, "employees")?
            .iter()
            .filter_map(|p| {
                p["id"]
                    .as_str()
                    .map(|id| (id, p["planningEnabled"].as_bool() == Some(false)))
            })
            .collect();
        let mut preserved = BTreeMap::new();
        if service && people.values().any(|disabled| *disabled) {
            for (i, row) in array(input, "assignments")?.iter().enumerate() {
                if i.is_multiple_of(64) {
                    check(Instant::now() < deadline, "MAPPING_TIMEOUT")?;
                }
                if row["employeeId"]
                    .as_str()
                    .is_some_and(|id| people.get(id) == Some(&true))
                {
                    preserved.insert((text(row, "employeeId")?, text(row, "date")?), row);
                }
            }
        }
        let mut hints = BTreeMap::new();
        let mut seen = BTreeSet::new();
        for (i, row) in entries.iter().enumerate() {
            if i.is_multiple_of(64) {
                check(Instant::now() < deadline, "MAPPING_TIMEOUT")?;
            }
            let pid = text(row, "employeeId")?;
            let date = text(row, "date")?;
            let day = calendar.relative(date)?;
            check(
                (0..calendar.labels.len() as i32).contains(&day),
                "HINT_DATE",
            )?;
            check(seen.insert((pid, day)), "DUPLICATE_HINT")?;
            let disabled = *people.get(pid).ok_or("HINT_PERSON")?;
            if service && disabled {
                check(
                    preserved.get(&(pid, date)).is_some_and(|old| *old == row),
                    "HINT_EXCLUDED_RECORD",
                )?;
                continue;
            }
            hints.insert((pid, day), code(row, ids, pid, false)?);
        }
        check(Instant::now() < deadline, "MAPPING_TIMEOUT")?;
        Ok(hints)
    };
    match parse() {
        Ok(hints) => Ok(hints),
        Err(error) if service && error != "MAPPING_TIMEOUT" => Ok(BTreeMap::new()),
        Err(error) => Err(error),
    }
}

// Only the hard component controls admission. The exact operational scorers
// evaluate temporary Members, so a rejected hint never copies a catalogue,
// changes pin flags, or displaces a legal sampled path. Original saved-record
// costs stay in Pattern and are calculated normally once a hint is accepted.
pub(super) fn feasible(
    employees: &[super::TemporalEmployee],
    witnesses: &[Option<super::Pattern>],
    deadline: Instant,
) -> Result<bool> {
    check(Instant::now() < deadline, "MAPPING_TIMEOUT")?;
    if employees.len() != witnesses.len() || witnesses.iter().any(Option::is_none) {
        return Ok(false);
    }
    let mut groups = BTreeMap::<usize, Vec<super::Member>>::new();
    for (p, witness) in employees.iter().zip(witnesses) {
        check(Instant::now() < deadline, "MAPPING_TIMEOUT")?;
        let mut member = p.member();
        member.pattern = *witness;
        groups.entry(p.sector).or_default().push(member);
    }
    for rows in groups.values() {
        check(Instant::now() < deadline, "MAPPING_TIMEOUT")?;
        if super::sector_cost(rows.iter())[0] != 0 {
            return Ok(false);
        }
    }
    let feasible = super::global_cost(groups.values().flatten())[0] == 0;
    check(Instant::now() < deadline, "MAPPING_TIMEOUT")?;
    Ok(feasible)
}
