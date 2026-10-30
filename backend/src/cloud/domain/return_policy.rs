//! How long a piece may come back, and what "the same item" means.
//!
//! # The setting is a fallback, not the rule
//!
//! [`ReturnPolicySetting`] is the fleet's default window. A [`ReturnPolicy`]
//! may name a division, any number of tags, or any number of articles and say
//! a different window for them. Resolution is specificity-first:
//!
//! ```text
//! ARTICLE  >  TAG  >  DIVISION  >  GLOBAL policy  >  setting
//! ```
//!
//! Equally specific matches keep the LONGEST window. Two tags on one garment
//! are two entitlements, and the shopper is entitled to the better one —
//! silently shortening a promise because a second tag happened to match is
//! the sort of rule that is only discovered at a counter with a customer
//! holding the paper.
//!
//! Nothing here reads a clock or a database. The same function resolves a
//! catalogue publication at head office and a sale at a till, which is the
//! point: there is one answer to "how long", wherever it is asked.
//!
//! # Goods that never come back
//!
//! A policy may say its goods are not taken back at all (`exchangeable:
//! false`, Hari 28 Oct 2026: "pakaian dalam … tidak bisa ditukar"). An
//! ARTICLE policy is the per-article flag; a DIVISION or TAG policy covers a
//! category. [`resolve_exchangeable`] answers it with the same specificity as
//! the window, and where equally specific policies disagree the refusal wins:
//! a till that takes underwear back because a second tag happened to allow it
//! has broken the one promise the shop printed. Such a policy does not speak
//! for the window — the piece has none.
//!
//! # The same-item exchange
//!
//! The owner's rule (28 Oct 2026): a garment may be exchanged for the same
//! article even when today's price is lower — a markdown today is not a reason
//! to refuse a return tomorrow — as long as the article's HPP and supplier are
//! unchanged. [`same_item_exchange_allowed`] is that rule as arithmetic.
//!
//! A missing HPP or supplier is NOT treated as equal. "We could not prove it
//! changed" and "it did not change" are different facts, and a rule that
//! conflates them gives away the difference on every article whose cost has
//! not been received yet.

use chrono::{Datelike, Days, NaiveDate};
use serde::{Deserialize, Serialize};

/// The longest window a policy may name. A year is already an extraordinary
/// promise; beyond it the policy is a permanent right and should be said as
/// one rather than hidden in a number.
pub const MAX_RETURN_DAYS: u32 = 365;

/// Which kind of thing a policy names.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum ReturnScopeKind {
    /// A policy with no targets: it applies to every article.
    Global,
    Division,
    Tag,
    Article,
}

impl ReturnScopeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Global => "GLOBAL",
            Self::Division => "DIVISION",
            Self::Tag => "TAG",
            Self::Article => "ARTICLE",
        }
    }

    /// How strongly a match of this kind speaks. Higher wins.
    pub fn rank(self) -> u8 {
        match self {
            Self::Global => 1,
            Self::Division => 2,
            Self::Tag => 3,
            Self::Article => 4,
        }
    }
}

/// The fleet's fallback window and the conditions printed on every receipt.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnPolicySetting {
    pub max_days: u32,
    pub require_hang_tag: bool,
    pub require_receipt: bool,
    pub same_item_exchange: bool,
    pub same_item_same_cost: bool,
    pub same_item_same_supplier: bool,
    /// Once any piece of a struk came back, the struk takes no further return
    /// (Hari, 29 Oct 2026). False: each piece may still come back once.
    #[serde(default = "taken_by_default")]
    pub one_return_per_receipt: bool,
    /// What went out on a return may itself come back. False (Hari, 28 Oct
    /// 2026): a return's struk never comes back.
    #[serde(default)]
    pub return_receipt_returnable: bool,
}

/// An older snapshot without the 1007 rules keeps what the till did then.
fn taken_by_default() -> bool {
    true
}

impl Default for ReturnPolicySetting {
    fn default() -> Self {
        Self {
            max_days: 7,
            require_hang_tag: true,
            require_receipt: true,
            same_item_exchange: true,
            same_item_same_cost: true,
            same_item_same_supplier: true,
            one_return_per_receipt: true,
            return_receipt_returnable: false,
        }
    }
}

/// One exception to the setting.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnPolicyRule {
    pub name: String,
    pub scope_kind: ReturnScopeKind,
    /// Division, tag or article codes. Empty for `GLOBAL`.
    pub targets: Vec<String>,
    pub max_days: u32,
    /// False: the goods it covers are never taken back (1006). Defaults to
    /// true so a snapshot from before it still reads.
    #[serde(default = "exchangeable_by_default")]
    pub exchangeable: bool,
}

fn exchangeable_by_default() -> bool {
    true
}

impl ReturnPolicyRule {
    fn matches(&self, article: &ReturnArticle<'_>) -> bool {
        match self.scope_kind {
            ReturnScopeKind::Global => true,
            ReturnScopeKind::Division => article
                .division_code
                .is_some_and(|division| self.targets.iter().any(|target| target == division)),
            ReturnScopeKind::Tag => article
                .tags
                .iter()
                .any(|tag| self.targets.iter().any(|target| target == tag)),
            ReturnScopeKind::Article => self
                .targets
                .iter()
                .any(|target| target == article.article_code),
        }
    }
}

/// What a garment is, for the one question "which policy speaks for it".
#[derive(Clone, Copy, Debug)]
pub struct ReturnArticle<'a> {
    pub article_code: &'a str,
    pub division_code: Option<&'a str>,
    pub tags: &'a [String],
}

/// The whole promise, as a till receives it: the fallback, the exceptions,
/// and the conditions. Travels beside the auth policy (`AuthPolicySnapshot`)
/// because that is the one command every node receives — and outside its
/// content hash, so a node running an older build keeps signing people in.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReturnPolicySnapshot {
    pub setting: ReturnPolicySetting,
    pub rules: Vec<ReturnPolicyRule>,
}

impl Default for ReturnPolicySnapshot {
    fn default() -> Self {
        Self {
            setting: ReturnPolicySetting::default(),
            rules: Vec::new(),
        }
    }
}

impl ReturnPolicySnapshot {
    /// The window for one article, with the same specificity rule the screen
    /// explains.
    pub fn resolve(&self, article: &ReturnArticle<'_>) -> EffectiveReturnPolicy {
        resolve_return_days(&self.setting, &self.rules, article)
    }

    /// Whether a till may take this article back at all.
    pub fn exchangeable(&self, article: &ReturnArticle<'_>) -> bool {
        resolve_exchangeable(&self.rules, article)
    }

    /// The name of the policy that says this article never comes back, when
    /// one does: the struk prints it ("* Pakaian dalam tidak bisa ditukar").
    pub fn refused_by(&self, article: &ReturnArticle<'_>) -> Option<&str> {
        refusing_policy(&self.rules, article).map(|rule| rule.name.as_str())
    }
}

/// The policy that keeps the goods from coming back, by the same rule as
/// [`resolve_exchangeable`]: among the most specific matches, a "no" answers;
/// when several do, the first by name, so every till prints the same one.
pub fn refusing_policy<'a>(
    rules: &'a [ReturnPolicyRule],
    article: &ReturnArticle<'_>,
) -> Option<&'a ReturnPolicyRule> {
    let matching: Vec<&ReturnPolicyRule> =
        rules.iter().filter(|rule| rule.matches(article)).collect();
    let top = matching.iter().map(|rule| rule.scope_kind.rank()).max()?;
    matching
        .into_iter()
        .filter(|rule| rule.scope_kind.rank() == top && !rule.exchangeable)
        .min_by(|a, b| a.name.cmp(&b.name))
}

/// Whether the goods may come back: the most specific matching policies
/// decide, and among equally specific ones a single "no" is the answer.
pub fn resolve_exchangeable(rules: &[ReturnPolicyRule], article: &ReturnArticle<'_>) -> bool {
    let matching: Vec<&ReturnPolicyRule> =
        rules.iter().filter(|rule| rule.matches(article)).collect();
    let Some(top) = matching.iter().map(|rule| rule.scope_kind.rank()).max() else {
        return true;
    };
    matching
        .iter()
        .filter(|rule| rule.scope_kind.rank() == top)
        .all(|rule| rule.exchangeable)
}

/// The window that applies, and where it came from.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EffectiveReturnPolicy {
    pub max_days: u32,
    /// The policy's name, or `"Global"` when the setting answered.
    pub source: String,
}

/// Resolve one article against the setting and every active policy.
pub fn resolve_return_days(
    setting: &ReturnPolicySetting,
    rules: &[ReturnPolicyRule],
    article: &ReturnArticle<'_>,
) -> EffectiveReturnPolicy {
    let mut winner: Option<(&ReturnPolicyRule, u8)> = None;
    // A policy that takes nothing back has no window to give.
    for rule in rules.iter().filter(|rule| rule.exchangeable) {
        if !rule.matches(article) {
            continue;
        }
        let rank = rule.scope_kind.rank();
        winner = match winner {
            None => Some((rule, rank)),
            Some((current, current_rank)) => {
                // More specific wins; equally specific keeps the longer
                // window. The name breaks a remaining tie so the answer is
                // stable when two policies say the same number.
                let better = rank > current_rank
                    || (rank == current_rank
                        && (rule.max_days > current.max_days
                            || (rule.max_days == current.max_days
                                && rule.name.as_str() < current.name.as_str())));
                if better {
                    Some((rule, rank))
                } else {
                    Some((current, current_rank))
                }
            }
        };
    }
    match winner {
        Some((rule, _)) => EffectiveReturnPolicy {
            max_days: rule.max_days,
            source: rule.name.clone(),
        },
        None => EffectiveReturnPolicy {
            max_days: setting.max_days,
            source: "Global".into(),
        },
    }
}

/// The last day a piece sold on `sold_on` may come back.
///
/// The sold day itself is day zero, so a seven-day window bought on the 1st
/// ends on the 8th. That is how a customer reads "tujuh hari" and how the
/// receipt's sentence is meant.
pub fn return_deadline(sold_on: NaiveDate, days: u32) -> NaiveDate {
    sold_on
        .checked_add_days(Days::new(u64::from(days)))
        .unwrap_or(sold_on)
}

/// Whether `today` is still inside the promise.
pub fn within_return_window(sold_on: NaiveDate, days: u32, today: NaiveDate) -> bool {
    today <= return_deadline(sold_on, days)
}

/// The facts the same-item rule compares.
#[derive(Clone, Copy, Debug)]
pub struct ReturnItemFacts<'a> {
    pub article_code: &'a str,
    /// The article's HPP at the moment compared, in minor units.
    pub cost_minor: Option<i64>,
    /// The supplier the cost came from, when the layer names one.
    pub supplier_id: Option<&'a str>,
}

/// The owner's same-item rule (28 Oct 2026).
///
/// True only when the replacement is the SAME article and every fact the
/// setting requires is present and equal. A markdown is deliberately absent
/// from the comparison: the selling price is what the customer paid, not what
/// makes two pieces the same goods.
pub fn same_item_exchange_allowed(
    setting: &ReturnPolicySetting,
    sold: ReturnItemFacts<'_>,
    replacement: ReturnItemFacts<'_>,
) -> bool {
    if !setting.same_item_exchange || sold.article_code != replacement.article_code {
        return false;
    }
    if setting.same_item_same_cost
        && !matches!((sold.cost_minor, replacement.cost_minor), (Some(a), Some(b)) if a == b)
    {
        return false;
    }
    if setting.same_item_same_supplier
        && !matches!(
            (sold.supplier_id, replacement.supplier_id),
            (Some(a), Some(b)) if a == b
        )
    {
        return false;
    }
    true
}

/// The sentence a receipt prints under "Terima kasih".
///
/// Kept here rather than in the edge so the wording is edited once and both
/// the printed paper and the on-screen preview read the same string. The
/// owner asked for the language to be tidied (28 Oct 2026); the elements are
/// one promise and two conditions, in that order.
pub fn receipt_return_note(
    deadline: NaiveDate,
    require_hang_tag: bool,
    require_receipt: bool,
) -> String {
    let mut parts = vec![format!(
        "Penukaran barang paling lambat {}.",
        indonesian_date(deadline)
    )];
    if require_hang_tag {
        parts.push("Hang tag harus utuh dan masih terpasang.".into());
    }
    if require_receipt {
        parts.push("Struk tidak boleh hilang.".into());
    }
    parts.join(" ")
}

/// `4 November 2026`, as a customer reads a date on paper.
pub fn indonesian_date(date: NaiveDate) -> String {
    const MONTHS: [&str; 12] = [
        "Januari",
        "Februari",
        "Maret",
        "April",
        "Mei",
        "Juni",
        "Juli",
        "Agustus",
        "September",
        "Oktober",
        "November",
        "Desember",
    ];
    let month = MONTHS
        .get(date.month0() as usize)
        .copied()
        .unwrap_or("Januari");
    format!("{} {} {}", date.day(), month, date.year())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    fn rule(name: &str, kind: ReturnScopeKind, targets: &[&str], days: u32) -> ReturnPolicyRule {
        ReturnPolicyRule {
            name: name.into(),
            scope_kind: kind,
            targets: targets.iter().map(|value| value.to_string()).collect(),
            max_days: days,
            exchangeable: true,
        }
    }

    #[test]
    fn underwear_never_comes_back_and_an_equal_no_wins() {
        let mut underwear = rule("Pakaian dalam", ReturnScopeKind::Division, &["MENSWEAR"], 7);
        underwear.exchangeable = false;
        let tagged = rule("Tag", ReturnScopeKind::Tag, &["KOKO"], 21);
        let tags = vec!["KOKO".to_string()];
        // The tag is more specific than the division and allows it.
        assert!(resolve_exchangeable(
            &[underwear.clone(), tagged.clone()],
            &article(&tags)
        ));
        assert!(!resolve_exchangeable(&[underwear.clone()], &article(&[])));
        let mut refused_tag = rule("Tag tidak", ReturnScopeKind::Tag, &["KOKO"], 7);
        refused_tag.exchangeable = false;
        assert!(!resolve_exchangeable(
            &[tagged, refused_tag],
            &article(&tags)
        ));
        // And it gives no window: the setting answers.
        let setting = ReturnPolicySetting::default();
        assert_eq!(
            resolve_return_days(&setting, &[underwear], &article(&[])).source,
            "Global"
        );
    }

    fn article<'a>(tags: &'a [String]) -> ReturnArticle<'a> {
        ReturnArticle {
            article_code: "10000001",
            division_code: Some("MENSWEAR"),
            tags,
        }
    }

    #[test]
    fn the_setting_answers_when_nothing_is_more_specific() {
        let setting = ReturnPolicySetting::default();
        let answer = resolve_return_days(&setting, &[], &article(&[]));
        assert_eq!(answer.max_days, 7);
        assert_eq!(answer.source, "Global");
    }

    #[test]
    fn the_most_specific_match_wins() {
        let setting = ReturnPolicySetting::default();
        let rules = vec![
            rule("Divisi", ReturnScopeKind::Division, &["MENSWEAR"], 14),
            rule("Tag", ReturnScopeKind::Tag, &["KOKO"], 21),
            rule("Artikel", ReturnScopeKind::Article, &["10000001"], 30),
        ];
        let tags = vec!["KOKO".to_string()];
        let answer = resolve_return_days(&setting, &rules, &article(&tags));
        assert_eq!(answer.max_days, 30);
        assert_eq!(answer.source, "Artikel");
    }

    #[test]
    fn equally_specific_tags_keep_the_longer_promise() {
        let setting = ReturnPolicySetting::default();
        let rules = vec![
            rule("Pendek", ReturnScopeKind::Tag, &["KOKO"], 10),
            rule("Panjang", ReturnScopeKind::Tag, &["LEBARAN"], 20),
        ];
        let tags = vec!["KOKO".to_string(), "LEBARAN".to_string()];
        let answer = resolve_return_days(&setting, &rules, &article(&tags));
        assert_eq!(answer.max_days, 20);
        assert_eq!(answer.source, "Panjang");
    }

    #[test]
    fn a_global_policy_beats_the_setting_but_not_a_division() {
        let setting = ReturnPolicySetting::default();
        let rules = vec![
            rule("Semua", ReturnScopeKind::Global, &[], 10),
            rule("Divisi", ReturnScopeKind::Division, &["MENSWEAR"], 14),
        ];
        let global_only = ReturnArticle {
            article_code: "10000002",
            division_code: Some("KIDS"),
            tags: &[],
        };
        assert_eq!(
            resolve_return_days(&setting, &rules, &global_only).max_days,
            10
        );
        assert_eq!(
            resolve_return_days(&setting, &rules, &global_only).source,
            "Semua"
        );
        assert_eq!(
            resolve_return_days(&setting, &rules, &article(&[])).max_days,
            14
        );
    }

    #[test]
    fn a_seven_day_window_sold_on_the_first_ends_on_the_eighth() {
        assert_eq!(return_deadline(date(2026, 10, 1), 7), date(2026, 10, 8));
        assert!(within_return_window(
            date(2026, 10, 1),
            7,
            date(2026, 10, 8)
        ));
        assert!(!within_return_window(
            date(2026, 10, 1),
            7,
            date(2026, 10, 9)
        ));
    }

    #[test]
    fn the_same_article_with_the_same_cost_and_supplier_may_be_exchanged() {
        let setting = ReturnPolicySetting::default();
        let sold = ReturnItemFacts {
            article_code: "10000001",
            cost_minor: Some(80_000),
            supplier_id: Some("supplier-a"),
        };
        let replacement = sold;
        assert!(same_item_exchange_allowed(&setting, sold, replacement));
    }

    #[test]
    fn a_lower_selling_price_does_not_refuse_the_exchange() {
        // The facts here carry cost and supplier only. A markdown is the
        // selling price, which is deliberately not part of this comparison.
        let setting = ReturnPolicySetting::default();
        let sold = ReturnItemFacts {
            article_code: "10000001",
            cost_minor: Some(80_000),
            supplier_id: Some("supplier-a"),
        };
        assert!(same_item_exchange_allowed(&setting, sold, sold));
    }

    #[test]
    fn a_different_article_is_not_the_same_item() {
        let setting = ReturnPolicySetting::default();
        let sold = ReturnItemFacts {
            article_code: "10000001",
            cost_minor: Some(80_000),
            supplier_id: Some("supplier-a"),
        };
        let replacement = ReturnItemFacts {
            article_code: "10000002",
            cost_minor: Some(80_000),
            supplier_id: Some("supplier-a"),
        };
        assert!(!same_item_exchange_allowed(&setting, sold, replacement));
    }

    #[test]
    fn a_changed_cost_or_supplier_is_a_different_item() {
        let setting = ReturnPolicySetting::default();
        let sold = ReturnItemFacts {
            article_code: "10000001",
            cost_minor: Some(80_000),
            supplier_id: Some("supplier-a"),
        };
        let costlier = ReturnItemFacts {
            cost_minor: Some(85_000),
            ..sold
        };
        let other_supplier = ReturnItemFacts {
            supplier_id: Some("supplier-b"),
            ..sold
        };
        assert!(!same_item_exchange_allowed(&setting, sold, costlier));
        assert!(!same_item_exchange_allowed(&setting, sold, other_supplier));
    }

    #[test]
    fn an_unknown_cost_is_not_proof_that_it_did_not_change() {
        let setting = ReturnPolicySetting::default();
        let sold = ReturnItemFacts {
            article_code: "10000001",
            cost_minor: None,
            supplier_id: Some("supplier-a"),
        };
        assert!(!same_item_exchange_allowed(&setting, sold, sold));
    }

    #[test]
    fn every_condition_can_be_switched_off_except_the_article() {
        let setting = ReturnPolicySetting {
            same_item_same_cost: false,
            same_item_same_supplier: false,
            ..ReturnPolicySetting::default()
        };
        let sold = ReturnItemFacts {
            article_code: "10000001",
            cost_minor: None,
            supplier_id: None,
        };
        assert!(same_item_exchange_allowed(&setting, sold, sold));
    }

    #[test]
    fn the_receipt_sentence_is_the_owner_s_words_in_order() {
        assert_eq!(
            receipt_return_note(
                date(2026, 10, 1).checked_add_days(Days::new(7)).unwrap(),
                true,
                true
            ),
            "Penukaran barang paling lambat 8 Oktober 2026. Hang tag harus utuh dan masih \
             terpasang. Struk tidak boleh hilang."
        );
        assert_eq!(
            receipt_return_note(date(2026, 10, 8), false, false),
            "Penukaran barang paling lambat 8 Oktober 2026."
        );
    }
}
