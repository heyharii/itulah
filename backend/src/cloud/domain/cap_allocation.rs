//! Splitting a promotion's limit between the shops that enforce it — the hard
//! cap, decided without a clock or a database.
//!
//! A budget is a brake by default: every shop enforces the fleet's count, and
//! the count reaches a shop only when it syncs. A shop that has been offline
//! all afternoon keeps giving the offer away against a count from lunchtime,
//! and nothing at the centre can stop it. For a promotion that must not be
//! exceeded, head office can split the limit instead: each shop is granted an
//! allowance and enforces it against its OWN sales, which it counts itself
//! (edge `0043`) — so it stops at its allowance whether or not it can reach
//! the centre. The allowances never add up to more than the limit, so the fleet
//! cannot give away more than the limit either.
//!
//! # Grants only ever grow
//!
//! This is the one rule everything else leans on. Taking allowance back from a
//! quiet shop would free it for a busy one — and would be wrong, because the
//! centre cannot know what a shop has sold that it has not uploaded yet. A
//! shop cut from two hundred thousand to fifty may already have given away one
//! hundred and fifty offline; handing the difference to another shop would put
//! the fleet a hundred thousand over. So allowance moves only out of the pool
//! of what has never been granted, and `commercial_cap_allocation` refuses a
//! grant that shrinks.
//!
//! The price of that rule is allowance stranded at shops that never use it,
//! which is why the first split hands out only part of the limit and the rest
//! is given in steps to the shops that are actually selling.

use std::collections::BTreeMap;

/// How the first split and every later step are sized, in basis points of the
/// limit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Split {
    /// The share of the limit handed out evenly the first time, before anybody
    /// has sold anything. The rest is the pool.
    pub initial_bps: i64,
}

impl Default for Split {
    /// Half at the start, half kept for whoever turns out to be busy.
    fn default() -> Self {
        Self { initial_bps: 5_000 }
    }
}

/// One shop's standing on one limit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Standing {
    pub origin_id: String,
    /// What it has been granted so far, or `None` if it has never been.
    pub granted: Option<i64>,
    /// What the centre has counted it giving away. Behind the shop's own
    /// figure by whatever it has not uploaded yet — which is why nothing here
    /// ever takes allowance back on the strength of it.
    pub used: i64,
}

/// Whether a limit is big enough to split at all.
///
/// A shop is topped up only once it has sold under the limit, and a shop
/// granted nothing can never sell — so a limit whose first share rounds to
/// nothing would leave every shop shut for good. Ten baskets across thirty
/// shops is such a limit; it is refused rather than split into nothing.
pub fn can_split(limit: i64, shops: usize, split: Split) -> bool {
    first_share(limit, shops, split) >= 1
}

/// An even first share of the limit, per shop, never below nought.
pub fn first_share(limit: i64, shops: usize, split: Split) -> i64 {
    if limit <= 0 || shops == 0 {
        return 0;
    }
    let pot = limit.saturating_mul(split.initial_bps) / 10_000;
    (pot / shops as i64).max(0)
}

/// The grants that should change, as `origin → new total`.
///
/// 1. A shop never granted anything is given the first share, as far as the
///    pool allows.
/// 2. A shop that has given away more than half of what it holds, and has
///    actually sold under this limit, is given one more first share — the
///    busiest first, then by name, so the answer is the same on every run.
///
/// The pool is the limit less everything ever granted. Nothing is taken from a
/// grant, and the total granted never passes the limit.
pub fn rebalance(limit: i64, shops: &[Standing], split: Split) -> BTreeMap<String, i64> {
    let mut changes = BTreeMap::new();
    if limit <= 0 || shops.is_empty() {
        return changes;
    }
    let share = first_share(limit, shops.len(), split);
    let granted: i64 = shops.iter().filter_map(|shop| shop.granted).sum();
    let mut pool = (limit - granted).max(0);

    let mut ordered: Vec<&Standing> = shops.iter().collect();
    ordered.sort_by(|left, right| left.origin_id.cmp(&right.origin_id));
    for shop in &ordered {
        if shop.granted.is_none() {
            let given = share.min(pool);
            pool -= given;
            changes.insert(shop.origin_id.clone(), given);
        }
    }

    // A step is one first share, and never less than one of whatever is
    // counted — a limit of ten baskets across thirty shops still moves.
    let step = share.max(1);
    let mut busy: Vec<(&Standing, i64)> = ordered
        .iter()
        .filter_map(|shop| {
            let held = shop.granted?;
            let left = held - shop.used;
            (shop.used > 0 && left.saturating_mul(2) < held.max(step)).then_some((*shop, held))
        })
        .collect();
    busy.sort_by(|(left, _), (right, _)| {
        right
            .used
            .cmp(&left.used)
            .then_with(|| left.origin_id.cmp(&right.origin_id))
    });
    for (shop, held) in busy {
        if pool <= 0 {
            break;
        }
        let given = step.min(pool);
        pool -= given;
        changes.insert(shop.origin_id.clone(), held + given);
    }
    changes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shop(origin: &str, granted: Option<i64>, used: i64) -> Standing {
        Standing {
            origin_id: origin.into(),
            granted,
            used,
        }
    }

    fn total(shops: &[Standing], changes: &BTreeMap<String, i64>) -> i64 {
        shops
            .iter()
            .map(|one| {
                changes
                    .get(&one.origin_id)
                    .copied()
                    .or(one.granted)
                    .unwrap_or(0)
            })
            .sum()
    }

    #[test]
    fn half_the_limit_is_split_evenly_the_first_time() {
        let shops = [
            shop("a", None, 0),
            shop("b", None, 0),
            shop("c", None, 0),
            shop("d", None, 0),
        ];
        let changes = rebalance(1_000_000, &shops, Split::default());
        assert_eq!(changes.len(), 4);
        assert!(changes.values().all(|grant| *grant == 125_000));
    }

    #[test]
    fn a_busy_shop_is_topped_up_from_the_pool_and_a_quiet_one_is_not() {
        let shops = [
            shop("a", Some(125_000), 100_000),
            shop("b", Some(125_000), 0),
        ];
        let changes = rebalance(500_000, &shops, Split::default());
        assert_eq!(changes.get("a"), Some(&250_000));
        assert_eq!(
            changes.get("b"),
            None,
            "nobody has sold there; nothing is moved to it"
        );
    }

    #[test]
    fn a_grant_never_shrinks_and_the_total_never_passes_the_limit() {
        let shops = [
            shop("a", Some(400_000), 399_000),
            shop("b", Some(400_000), 390_000),
            shop("c", Some(150_000), 149_000),
        ];
        let changes = rebalance(1_000_000, &shops, Split::default());
        for one in &shops {
            if let Some(new) = changes.get(&one.origin_id) {
                assert!(*new >= one.granted.unwrap_or(0), "{} shrank", one.origin_id);
            }
        }
        assert!(total(&shops, &changes) <= 1_000_000);
        assert_eq!(
            changes.get("a"),
            Some(&450_000),
            "the pool was fifty thousand, all to the busiest"
        );
    }

    #[test]
    fn an_exhausted_pool_moves_nothing() {
        let shops = [
            shop("a", Some(500_000), 500_000),
            shop("b", Some(500_000), 10),
        ];
        assert!(rebalance(1_000_000, &shops, Split::default()).is_empty());
    }

    #[test]
    fn a_limit_lowered_below_what_was_granted_takes_nothing_back() {
        let shops = [shop("a", Some(600_000), 0), shop("b", None, 0)];
        let changes = rebalance(500_000, &shops, Split::default());
        assert_eq!(
            changes.get("b"),
            Some(&0),
            "a new shop is granted from an empty pool"
        );
        assert_eq!(changes.get("a"), None);
    }

    #[test]
    fn a_limit_too_small_to_split_is_refused() {
        assert!(
            !can_split(10, 30, Split::default()),
            "five across thirty is nought each"
        );
        assert!(
            can_split(60, 30, Split::default()),
            "thirty across thirty is one each"
        );
    }
}
