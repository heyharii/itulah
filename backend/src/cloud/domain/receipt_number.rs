//! The 7-letter transaction number (Hari, 30 Oct 2026): random to the eye,
//! the same for no two transactions anywhere, offline included.
//!
//! Head office hands every store its own slices of one run of numbers
//! `0 … 26⁷−1` (postgres 1010); a store numbers its sales and returns from its
//! slices alone, so two stores never hold the same number. Each number is then
//! scrambled by a fixed permutation of the run — a Feistel network on 34 bits,
//! cycle-walked back into `26⁷` — and written as seven letters. A permutation
//! sends no two numbers to one code, so the letters are as unique as the
//! numbers, with nothing to look up.

use serde::{Deserialize, Serialize};

/// Seven letters' worth of numbers: 26⁷ = 8 031 810 176.
pub const SPACE: u64 = 26 * 26 * 26 * 26 * 26 * 26 * 26;

/// Half of the 34 bits the Feistel network works on (2³⁴ > 26⁷).
const HALF: u32 = 17;
const MASK: u64 = (1 << HALF) - 1;
const KEYS: [u64; 4] = [0x2c1b_3c6d, 0x297a_2d39, 0x1b87_3593, 0x6c8e_9cf5];

/// One slice of the run, granted to one store: `start … start+size−1`.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct ReceiptSlice {
    pub start: i64,
    pub size: i64,
}

fn round(half: u64, key: u64) -> u64 {
    let mixed = half.wrapping_mul(0x9e37_79b1).wrapping_add(key);
    (mixed ^ (mixed >> 15) ^ (half << 3)) & MASK
}

fn feistel(x: u64) -> u64 {
    let (mut left, mut right) = (x >> HALF, x & MASK);
    for key in KEYS {
        (left, right) = (right, left ^ round(right, key));
    }
    (left << HALF) | right
}

fn feistel_back(x: u64) -> u64 {
    let (mut left, mut right) = (x >> HALF, x & MASK);
    for key in KEYS.iter().rev() {
        (left, right) = (right ^ round(left, *key), left);
    }
    (left << HALF) | right
}

/// The number's place in the scrambled run; one-to-one on `0 … SPACE−1`.
pub fn scramble(n: u64) -> u64 {
    let mut x = feistel(n % SPACE);
    while x >= SPACE {
        x = feistel(x);
    }
    x
}

/// The number a scrambled place came from.
pub fn unscramble(x: u64) -> u64 {
    let mut n = feistel_back(x % SPACE);
    while n >= SPACE {
        n = feistel_back(n);
    }
    n
}

/// Seven letters, `A` = 0, most significant first.
pub fn letters(x: u64) -> String {
    let mut x = x % SPACE;
    let mut out = [b'A'; 7];
    for slot in out.iter_mut().rev() {
        // `x % 26` is below 26, so the cast cannot truncate.
        #[allow(clippy::cast_possible_truncation)]
        let digit = (x % 26) as u8;
        *slot = b'A' + digit;
        x /= 26;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The code of the number at `used` places into a store's slices, in the
/// order they were granted; `None` once every slice is spent.
pub fn code_at(slices: &[ReceiptSlice], used: i64) -> Option<String> {
    let mut left = used;
    for slice in slices {
        if left < slice.size {
            let n = u64::try_from(slice.start + left).ok()?;
            return Some(letters(scramble(n)));
        }
        left -= slice.size;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn scramble_is_one_to_one_and_stays_in_the_run() {
        let mut seen = HashSet::new();
        for n in (0..300_000).chain(SPACE - 1000..SPACE) {
            let x = scramble(n);
            assert!(x < SPACE);
            assert_eq!(unscramble(x), n);
            assert!(seen.insert(x), "{n} met another number");
        }
    }

    #[test]
    fn neighbours_look_nothing_alike() {
        let a = letters(scramble(125));
        let b = letters(scramble(126));
        assert_eq!(a.len(), 7);
        assert!(a.chars().zip(b.chars()).filter(|(x, y)| x == y).count() < 4);
    }

    #[test]
    fn slices_are_read_in_order() {
        let slices = [
            ReceiptSlice { start: 10, size: 2 },
            ReceiptSlice {
                start: 100,
                size: 1,
            },
        ];
        assert_eq!(code_at(&slices, 0), Some(letters(scramble(10))));
        assert_eq!(code_at(&slices, 2), Some(letters(scramble(100))));
        assert_eq!(code_at(&slices, 3), None);
    }
}
