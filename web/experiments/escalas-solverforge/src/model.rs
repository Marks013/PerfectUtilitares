//! Public boundary of the isolated E2 model.
//! Keep legal domains, scoring and construction independent for later profiling.
mod coverage;
mod patterns;
mod seed;

pub use coverage::{Band, Member, Sector, evaluate, group_cost, validate_complete};
pub use patterns::{catalog, full_mask, legal, worked};
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
