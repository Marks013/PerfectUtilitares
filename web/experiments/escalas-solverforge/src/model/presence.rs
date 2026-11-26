//! Fixed-size, allocation-free attendance bitmap. Covers 250 employees
//! (capacity 256), without changing the currently admitted E2 input limit.
use std::ops::{BitAnd,BitAndAssign,BitOr,BitOrAssign,Not};

#[derive(Clone,Copy,Debug,Default,PartialEq,Eq,PartialOrd,Ord,Hash)]
pub struct Presence([u64;4]);

impl Presence {
    pub const EMPTY:Self=Self([0;4]);
    pub fn one(id:usize)->Self{
        assert!(id<256,"presence index exceeds capacity");
        let mut words=[0;4];
        words[id/64]=1u64<<(id%64);
        Self(words)
    }
    pub fn count_ones(self)->u32{
        self.0.iter().map(|word|word.count_ones()).sum()
    }
    pub fn is_empty(self)->bool{self==Self::EMPTY}

    #[cfg(test)]
    pub fn from_low(word:u64)->Self{Self([word,0,0,0])}
}
impl BitAnd for Presence{
    type Output=Self;
    fn bitand(self,rhs:Self)->Self{Self(std::array::from_fn(|i|self.0[i]&rhs.0[i]))}
}
impl BitOr for Presence{
    type Output=Self;
    fn bitor(self,rhs:Self)->Self{Self(std::array::from_fn(|i|self.0[i]|rhs.0[i]))}
}
impl Not for Presence{
    type Output=Self;
    fn not(self)->Self{Self(self.0.map(|word|!word))}
}
impl BitAndAssign for Presence{fn bitand_assign(&mut self,rhs:Self){*self=*self&rhs;}}
impl BitOrAssign for Presence{fn bitor_assign(&mut self,rhs:Self){*self=*self|rhs;}}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn supports_250_people_without_aliasing_across_machine_words(){
        let mut all=Presence::EMPTY;
        for id in 0..250{let bit=Presence::one(id);assert!((all&bit).is_empty());all|=bit;}
        assert_eq!(all.count_ones(),250);
        for id in [0,63,64,127,128,191,192,249]{
            let bit=Presence::one(id);
            assert_eq!((all&bit).count_ones(),1);
            assert_eq!((all&!bit).count_ones(),249);
        }
        let role=(0..250).step_by(2).fold(Presence::EMPTY,|mask,id|mask|Presence::one(id));
        assert_eq!((role&all).count_ones(),125);
        assert_eq!((all&!role).count_ones(),125);
    }
}
