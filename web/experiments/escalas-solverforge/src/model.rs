//! Public boundary of the isolated E2 model.
//! Keep legal domains, scoring and construction independent for later profiling.
mod coverage;
mod guard;
mod incremental;
mod patterns;
mod seed;
mod sunday_repair;

pub use coverage::{Band, Cost, Member, Sector, evaluate, validate_complete};
pub use incremental::SectorAccumulator;
pub use guard::SeedGuard;
pub use patterns::{allowed_indices, catalog, full_mask, worked};
#[cfg(test)]
use patterns::legal;
pub use seed::seed;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogue_and_legal_domain() {
        let week = catalog(7);
        assert_eq!(week.len(), 15);
        assert!(week.iter().all(|&m| legal(m, 7, 0, 0, 1, 1)));
        let four = catalog(28);
        assert_eq!(four.len(), 50_625);
        assert_eq!(four.iter().filter(|&&m| legal(m, 28, 0, 0, 1, 15)).count(), 8020);
        assert!(!legal(127, 7, 0, 0, 1, 1));
        assert!(!legal(week[0], 7, 0, 64, 1, 1));
    }

    #[test]
    fn role_and_general_floors_are_not_additive() {
        let b = Band { day: 0, minutes: 60, estimated: true, minimum: 2, eligible: 3,
            role_floors: vec![(1, 1), (2, 1)] };
        assert_eq!(b.gap(1) * b.minutes, 60);
        assert_eq!(b.gap(0) * b.minutes, 120);
        assert_eq!(b.gap(3), 0);
    }
}
