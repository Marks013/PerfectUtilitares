//! Adapter for SolverForge 0.31.2, whose BendableScore implements Score
//! but not ParseableScore (required by the native solve factory).
//! Delegate numeric operations and ordering to BendableScore<1,16>.
//! E3b keeps the sixteen original objective positions explicit.
use solverforge::{BendableScore, ParseableScore, Score, ScoreLevel, ScoreParseError};
use std::fmt;
use std::ops::{Add, Neg, Sub};

type Inner = BendableScore<1, 16>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TemporalScore(Inner);

impl TemporalScore {
    pub const fn of(hard: [i64; 1], soft: [i64; 16]) -> Self {
        Self(Inner::of(hard, soft))
    }
}

impl fmt::Display for TemporalScore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.0, f)
    }
}

impl Add for TemporalScore {
    type Output = Self;
    fn add(self, rhs: Self) -> Self { Self(self.0 + rhs.0) }
}
impl Sub for TemporalScore {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self { Self(self.0 - rhs.0) }
}
impl Neg for TemporalScore {
    type Output = Self;
    fn neg(self) -> Self { Self(-self.0) }
}

impl Score for TemporalScore {
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

impl ParseableScore for TemporalScore {
    fn parse(text: &str) -> Result<Self, ScoreParseError> {
        fn invalid() -> ScoreParseError {
            ScoreParseError { message: "Expected [hard]hard/[sixteen soft levels separated by /]soft".into() }
        }
        let (hard, soft) = text.strip_prefix('[')
            .and_then(|s| s.split_once("]hard/["))
            .ok_or_else(invalid)?;
        let hard = hard.parse::<i64>().map_err(|_| invalid())?;
        let soft = soft.strip_suffix("]soft").ok_or_else(invalid)?;
        let mut parts = soft.split('/');
        let mut levels = [0i64; 16];
        for level in &mut levels {
            *level = parts.next().ok_or_else(invalid)?.parse().map_err(|_| invalid())?;
        }
        if parts.next().is_some() { return Err(invalid()); }
        Ok(Self::of([hard], levels))
    }
    fn to_string_repr(&self) -> String { self.to_string() }
}

