//! Adapter for SolverForge 0.31.2, whose BendableScore implements Score
//! but not ParseableScore (required by the native solve factory).
//! Delegate all numeric operations and ordering to the original nine-level
//! score. No reweighting, collapsing objectives or dependency changes.
use solverforge::{BendableScore, ParseableScore, Score, ScoreLevel, ScoreParseError};
use std::fmt;
use std::ops::{Add, Neg, Sub};

type Inner = BendableScore<1, 8>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EscalasScore(Inner);

impl EscalasScore {
    pub const fn of(hard: [i64; 1], soft: [i64; 8]) -> Self {
        Self(Inner::of(hard, soft))
    }
}

impl fmt::Display for EscalasScore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.0, f)
    }
}

impl Add for EscalasScore {
    type Output = Self;
    fn add(self, rhs: Self) -> Self { Self(self.0 + rhs.0) }
}
impl Sub for EscalasScore {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self { Self(self.0 - rhs.0) }
}
impl Neg for EscalasScore {
    type Output = Self;
    fn neg(self) -> Self { Self(-self.0) }
}

impl Score for EscalasScore {
    fn is_feasible(&self) -> bool { self.0.is_feasible() }
    fn zero() -> Self { Self(Inner::zero()) }
    fn levels_count() -> usize { Inner::levels_count() }
    fn level_number(&self, index: usize) -> i64 { self.0.level_number(index) }
    fn from_level_numbers(levels: &[i64]) -> Self {
        assert_eq!(levels.len(), Self::levels_count());
        Self(Inner::from_level_numbers(levels))
    }
    fn multiply(&self, factor: f64) -> Self { Self(self.0.multiply(factor)) }
    fn divide(&self, divisor: f64) -> Self { Self(self.0.divide(divisor)) }
    fn scale(&self, factor: i64) -> Self { Self(self.0.scale(factor)) }
    fn abs(&self) -> Self { Self(self.0.abs()) }
    fn to_scalar(&self) -> f64 { self.0.to_scalar() }
    fn level_label(index: usize) -> ScoreLevel { Inner::level_label(index) }

    fn overflowing_add(self, other: Self) -> (Self, bool) {
        let (value, overflow) = self.0.overflowing_add(other.0);
        (Self(value), overflow)
    }
    fn overflowing_sub(self, other: Self) -> (Self, bool) {
        let (value, overflow) = self.0.overflowing_sub(other.0);
        (Self(value), overflow)
    }
    fn overflowing_neg(self) -> (Self, bool) {
        let (value, overflow) = self.0.overflowing_neg();
        (Self(value), overflow)
    }
    fn overflowing_scale(&self, factor: i64) -> (Self, bool) {
        let (value, overflow) = self.0.overflowing_scale(factor);
        (Self(value), overflow)
    }
    fn overflowing_multiply(&self, factor: f64) -> (Self, bool) {
        let (value, overflow) = self.0.overflowing_multiply(factor);
        (Self(value), overflow)
    }
}

impl ParseableScore for EscalasScore {
    fn parse(text: &str) -> Result<Self, ScoreParseError> {
        fn invalid() -> ScoreParseError {
            ScoreParseError { message: "Expected [hard]hard/[eight soft levels separated by /]soft".into() }
        }
        let (hard, soft) = text.strip_prefix('[')
            .and_then(|s| s.split_once("]hard/["))
            .ok_or_else(invalid)?;
        let hard = hard.parse::<i64>().map_err(|_| invalid())?;
        let soft = soft.strip_suffix("]soft").ok_or_else(invalid)?;
        let mut parts = soft.split('/');
        let mut levels = [0i64; 8];
        for level in &mut levels {
            *level = parts.next().ok_or_else(invalid)?.parse().map_err(|_| invalid())?;
        }
        if parts.next().is_some() { return Err(invalid()); }
        Ok(Self::of([hard], levels))
    }
    fn to_string_repr(&self) -> String { self.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_text_roundtrip_and_all_nine_levels() {
        let values = [-1, 0, -23, 4, 5, -6, 7, i64::MIN, i64::MAX];
        let score = EscalasScore::from_level_numbers(&values);
        assert_eq!(EscalasScore::parse(&score.to_string_repr()).unwrap(), score);
        assert_eq!(score.to_level_numbers(), values.to_vec());
        assert!(!score.is_feasible());
    }

    #[test]
    fn rejects_bad_or_wrong_length_scores() {
        for text in ["", "0hard/0soft", "[0]hard/[0/0]soft",
                     "[0]hard/[0/0/0/0/0/0/0/0/0]soft",
                     "[0]hard/[0/0/0/0/0/0/0/x]soft",
                     "[9223372036854775808]hard/[0/0/0/0/0/0/0/0]soft"] {
            assert!(EscalasScore::parse(text).is_err());
        }
    }

    #[test]
    fn arithmetic_order_and_overflow_match_bendable_score() {
        let inner = Inner::of([0], [-1, 3, -4, 5, 6, 7, 8, 9]);
        let score = EscalasScore(inner);
        let other = EscalasScore::of([0], [0, -100, -100, -100, -100, -100, -100, -100]);
        assert_eq!(score.cmp(&other), inner.cmp(&other.0));
        assert!(other > score);
        assert_eq!((score + other).0, inner + other.0);
        assert_eq!((score - other).0, inner - other.0);
        assert_eq!((-score).0, -inner);
        assert_eq!(score.scale(3).0, inner.scale(3));
        assert_eq!(score.multiply(0.5).0, inner.multiply(0.5));
        assert_eq!(score.divide(2.0).0, inner.divide(2.0));
        assert_eq!(score.abs().0, inner.abs());
        assert_eq!(score.to_scalar(), inner.to_scalar());
        let max = EscalasScore::of([i64::MAX], [0; 8]);
        let one = EscalasScore::of([1], [0; 8]);
        let (wrapped, overflow) = max.overflowing_add(one);
        let expected = max.0.overflowing_add(one.0);
        assert!(overflow);
        assert_eq!((wrapped.0, overflow), expected);
    }
}
