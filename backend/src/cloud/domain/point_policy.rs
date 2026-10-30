//! How many member points a purchase earns from the point policy.
//!
//! # The setting is a fallback, as for returns
//!
//! [`PointPolicySetting`] is the everyday rate: one point per so many rupiah,
//! on or off. A [`PointPolicyRule`] names a division, tags or articles, and may
//! be limited to some stores and a run of dates. Resolution per line is
//! specificity-first, the return policy's order:
//!
//! ```text
//! ARTICLE  >  TAG  >  DIVISION  >  setting
//! ```
//!
//! Equally specific matches keep the BEST rate (fewest rupiah per point); a
//! rule that says the goods earn nothing wins at its own level.
//!
//! # Policy points add to promotion points
//!
//! The owner's rule (30 Oct 2026): a sale that matches the point policy and a
//! points promotion earns both, added. The engine's promotions are priced
//! first and untouched; [`award`] is computed beside them and summed by the
//! caller. Nothing here can lower what a promotion gave.
//!
//! Nothing here reads a clock or a database, so head office and a till give
//! the same answer for the same basket.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

/// The most rupiah a policy may ask for one point.
pub const MAX_SPEND_PER_POINT: i64 = 100_000_000;

/// Which kind of thing a point policy names.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum PointScopeKind {
    Division,
    Tag,
    Article,
}

impl PointScopeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Division => "DIVISION",
            Self::Tag => "TAG",
            Self::Article => "ARTICLE",
        }
    }

    /// How strongly a match of this kind speaks. Higher wins.
    pub fn rank(self) -> u8 {
        match self {
            Self::Division => 1,
            Self::Tag => 2,
            Self::Article => 3,
        }
    }
}

/// The everyday rate.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PointPolicySetting {
    pub enabled: bool,
    /// Rupiah spent for one point.
    pub spend_per_point: i64,
}

impl Default for PointPolicySetting {
    /// Off: a node that never heard of the point policy pays no policy points.
    fn default() -> Self {
        Self {
            enabled: false,
            spend_per_point: 10_000,
        }
    }
}

/// One exception to the setting.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PointPolicyRule {
    pub name: String,
    pub scope_kind: PointScopeKind,
    pub targets: Vec<String>,
    pub spend_per_point: i64,
    /// False: the goods it covers earn no policy points.
    #[serde(default = "earns_by_default")]
    pub earns: bool,
    /// Empty: every store.
    #[serde(default)]
    pub site_ids: Vec<String>,
    #[serde(default)]
    pub starts_on: Option<NaiveDate>,
    #[serde(default)]
    pub ends_on: Option<NaiveDate>,
}

fn earns_by_default() -> bool {
    true
}

/// What a line's article is, for "which policy speaks for it".
#[derive(Clone, Copy, Debug)]
pub struct PointArticle<'a> {
    pub article_code: &'a str,
    pub division_code: Option<&'a str>,
    pub tags: &'a [String],
}

impl PointPolicyRule {
    fn matches(&self, article: &PointArticle<'_>) -> bool {
        match self.scope_kind {
            PointScopeKind::Division => article
                .division_code
                .is_some_and(|division| self.targets.iter().any(|target| target == division)),
            PointScopeKind::Tag => article
                .tags
                .iter()
                .any(|tag| self.targets.iter().any(|target| target == tag)),
            PointScopeKind::Article => self
                .targets
                .iter()
                .any(|target| target == article.article_code),
        }
    }

    /// In force at this store on this day.
    fn in_force(&self, site_id: &str, day: NaiveDate) -> bool {
        (self.site_ids.is_empty() || self.site_ids.iter().any(|site| site == site_id))
            && self.starts_on.is_none_or(|start| day >= start)
            && self.ends_on.is_none_or(|end| day <= end)
    }
}

/// The whole policy as a till receives it. Only active rules travel.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PointPolicySnapshot {
    pub setting: PointPolicySetting,
    pub rules: Vec<PointPolicyRule>,
}

impl PointPolicySnapshot {
    /// Rupiah per point for one article at one store on one day; `None` earns
    /// nothing from the policy.
    pub fn rate_for(
        &self,
        article: Option<&PointArticle<'_>>,
        site_id: &str,
        day: NaiveDate,
    ) -> Option<i64> {
        let hits: Vec<&PointPolicyRule> = match article {
            Some(article) => self
                .rules
                .iter()
                .filter(|rule| rule.in_force(site_id, day) && rule.matches(article))
                .collect(),
            None => Vec::new(),
        };
        let Some(top) = hits.iter().map(|rule| rule.scope_kind.rank()).max() else {
            return (self.setting.enabled && self.setting.spend_per_point > 0)
                .then_some(self.setting.spend_per_point);
        };
        let level: Vec<&&PointPolicyRule> = hits
            .iter()
            .filter(|rule| rule.scope_kind.rank() == top)
            .collect();
        if level.iter().any(|rule| !rule.earns) {
            return None;
        }
        level
            .iter()
            .map(|rule| rule.spend_per_point)
            .filter(|rate| *rate > 0)
            .min()
    }
}

/// Policy points per line, given each line's rate and the rupiah it was
/// charged.
///
/// Whole points per rate over the summed amount, then split across that rate's
/// lines by largest remainder — the engine's D02 rounding, so two lines of
/// Rp 15.000 at Rp 10.000 a point earn three, not two, and a return of one
/// line takes back what that line was given.
pub fn award(lines: &[(Option<i64>, i64)]) -> Vec<i64> {
    let mut out = vec![0_i64; lines.len()];
    let mut rates: Vec<i64> = lines.iter().filter_map(|(rate, _)| *rate).collect();
    rates.sort_unstable();
    rates.dedup();
    for rate in rates.into_iter().filter(|rate| *rate > 0) {
        let members: Vec<usize> = (0..lines.len())
            .filter(|index| lines[*index].0 == Some(rate) && lines[*index].1 > 0)
            .collect();
        let basis: i128 = members
            .iter()
            .map(|index| i128::from(lines[*index].1))
            .sum();
        let points = i64::try_from(basis / i128::from(rate)).unwrap_or(i64::MAX);
        if points <= 0 || basis <= 0 {
            continue;
        }
        let mut handed = 0_i64;
        let mut remainders: Vec<(usize, i128)> = Vec::with_capacity(members.len());
        for &index in &members {
            let exact = i128::from(lines[index].1) * i128::from(points);
            let whole = (exact / basis) as i64;
            out[index] = whole;
            handed += whole;
            remainders.push((index, exact % basis));
        }
        remainders.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.cmp(&right.0)));
        for (index, _) in remainders
            .into_iter()
            .take((points - handed).max(0) as usize)
        {
            out[index] += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 30).expect("date")
    }

    fn rule(kind: PointScopeKind, target: &str, rate: i64) -> PointPolicyRule {
        PointPolicyRule {
            name: target.into(),
            scope_kind: kind,
            targets: vec![target.into()],
            spend_per_point: rate,
            earns: true,
            site_ids: Vec::new(),
            starts_on: None,
            ends_on: None,
        }
    }

    #[test]
    fn the_setting_is_off_until_turned_on() {
        let tags = Vec::new();
        let article = PointArticle {
            article_code: "A1",
            division_code: None,
            tags: &tags,
        };
        let mut snapshot = PointPolicySnapshot::default();
        assert_eq!(snapshot.rate_for(Some(&article), "S1", day()), None);
        snapshot.setting.enabled = true;
        assert_eq!(snapshot.rate_for(Some(&article), "S1", day()), Some(10_000));
    }

    #[test]
    fn the_most_specific_rule_decides_and_the_best_rate_wins_a_tie() {
        let tags = vec!["SALE".to_string(), "NEW".to_string()];
        let article = PointArticle {
            article_code: "A1",
            division_code: Some("MEN"),
            tags: &tags,
        };
        let snapshot = PointPolicySnapshot {
            setting: PointPolicySetting {
                enabled: true,
                spend_per_point: 10_000,
            },
            rules: vec![
                rule(PointScopeKind::Division, "MEN", 2_000),
                rule(PointScopeKind::Tag, "SALE", 8_000),
                rule(PointScopeKind::Tag, "NEW", 5_000),
            ],
        };
        assert_eq!(snapshot.rate_for(Some(&article), "S1", day()), Some(5_000));
    }

    #[test]
    fn a_rule_outside_its_store_or_dates_does_not_speak() {
        let tags = vec!["SALE".to_string()];
        let article = PointArticle {
            article_code: "A1",
            division_code: None,
            tags: &tags,
        };
        let mut limited = rule(PointScopeKind::Tag, "SALE", 1_000);
        limited.site_ids = vec!["S2".into()];
        let mut later = rule(PointScopeKind::Tag, "SALE", 2_000);
        later.starts_on = NaiveDate::from_ymd_opt(2026, 11, 1);
        let snapshot = PointPolicySnapshot {
            setting: PointPolicySetting::default(),
            rules: vec![limited, later],
        };
        assert_eq!(snapshot.rate_for(Some(&article), "S1", day()), None);
        assert_eq!(snapshot.rate_for(Some(&article), "S2", day()), Some(1_000));
    }

    #[test]
    fn earns_nothing_wins_at_its_level() {
        let tags = vec!["UNDERWEAR".to_string(), "SALE".to_string()];
        let article = PointArticle {
            article_code: "A1",
            division_code: None,
            tags: &tags,
        };
        let mut none = rule(PointScopeKind::Tag, "UNDERWEAR", 1);
        none.earns = false;
        let snapshot = PointPolicySnapshot {
            setting: PointPolicySetting {
                enabled: true,
                spend_per_point: 10_000,
            },
            rules: vec![none, rule(PointScopeKind::Tag, "SALE", 1_000)],
        };
        assert_eq!(snapshot.rate_for(Some(&article), "S1", day()), None);
    }

    #[test]
    fn whole_points_over_the_rate_then_split() {
        assert_eq!(
            award(&[
                (Some(10_000), 15_000),
                (Some(10_000), 15_000),
                (None, 99_000)
            ]),
            vec![2, 1, 0]
        );
        assert_eq!(
            award(&[(Some(5_000), 12_000), (Some(10_000), 25_000)]),
            vec![2, 2]
        );
    }
}
