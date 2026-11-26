//! Public boundary of the isolated E2 model.
//! Keep legal domains, scoring and construction independent for later profiling.
mod coverage;
mod guard;
mod incremental;
mod patterns;
mod peak_repair;
mod presence;
mod seed;
mod rest_repair;
mod sunday_repair;
mod weekly_domain;

pub use coverage::{Band, Cost, Member, Sector, evaluate, validate_complete};
pub use incremental::SectorAccumulator;
pub use presence::Presence;
pub use guard::SeedGuard;
pub use patterns::{PersonalRules, SCALE_DOMAIN_LIMIT, allowed_indices, bounded_patterns, catalog, full_mask, legal_profile, worked};
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
    fn coverage_floors_support_250_people() {
        let everyone=(0..250).fold(Presence::EMPTY,|a,i|a|Presence::one(i));
        let role=Presence::one(64)|Presence::one(249);
        let band=Band{day:0,start:480,minutes:60,estimated:true,minimum:250,eligible:everyone,role_floors:vec![(role,2)]};
        assert_eq!(band.gap(everyone),0);
        assert_eq!(band.gap(everyone&!role),2);
        assert_eq!(band.gap_components(everyone&!Presence::one(249)),vec![1,1]);
    }
    #[test]
    fn aggregate_gap_does_not_hide_role_regression() {
        let band=Band{day:0,start:480,minutes:60,estimated:true,minimum:3,eligible:Presence::from_low(7),
            role_floors:vec![(Presence::one(0),1)]};
        assert_eq!(band.gap(Presence::one(0)),band.gap(Presence::one(1)));
        assert_eq!(band.gap_components(Presence::one(0)),vec![2,0]);
        assert_eq!(band.gap_components(Presence::one(1)),vec![2,1]);
    }

    #[test]
    fn role_and_general_floors_are_not_additive() {
        let b = Band { day: 0, start: 480, minutes: 60, estimated: true, minimum: 2, eligible: Presence::from_low(3),
            role_floors: vec![(Presence::from_low(1), 1), (Presence::from_low(2), 1)] };
        assert_eq!(b.gap(Presence::from_low(1)) * b.minutes, 60);
        assert_eq!(b.gap(Presence::EMPTY) * b.minutes, 120);
        assert_eq!(b.gap(Presence::from_low(3)), 0);
    }
}
