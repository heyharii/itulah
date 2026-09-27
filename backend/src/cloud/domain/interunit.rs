//! Making every unit's books balance on their own.
//!
//! # The failure this exists to end
//!
//! The client keeps a profit and loss per location, and their chart carries the
//! location in the account code itself. So an entry that debits store 01 and
//! credits head office balances in total and leaves BOTH sets of books wrong:
//! store 01's trial balance is out by the cost, head office's is out by the same
//! amount the other way, and the consolidated one balances perfectly. That is
//! the failure this repository keeps naming — wrong in a way the trial balance
//! cannot see.
//!
//! 0098 answered it by refusing: a cost had to sit at its own bill's location,
//! and `assert_allocation_fits` in 0084 refused a cross-location payment on the
//! same argument. Both said, in writing, that the honest answer is an inter-unit
//! balance and that no rule wrote one yet. This is that rule.
//!
//! # What it does
//!
//! Given the lines a posting rule built, it works out what each unit nets and
//! adds the legs that bring every one of them back to zero:
//!
//! ```text
//!   Dr Biaya Listrik  @store-03   1,000,000     head office pays store 03's
//!   Cr Bank BCA       @dc         1,000,000     electricity from its own bank
//!
//!   + Cr Hutang Affiliasi   @store-03  (counter dc)        1,000,000
//!   + Dr Piutang Affiliasi  @dc        (counter store-03)  1,000,000
//! ```
//!
//! Store 03 now balances on its own — a cost and the debt that funded it — and
//! so does head office: money out, and a receivable in its place.
//!
//! # Two decisions, both the owner's
//!
//! **Which side books which account: the account map decides.** The owner's
//! convention of 25 Sep, following the client's books: the unit side of every
//! family is its hutang account (2028 / 2029 / 2030) and head office's side
//! its piutang account (1057 / 1058 / 1059), whichever way value moved; a
//! balance may go negative. This module picks the MEANING by direction
//! (`affiliate_payable` where the unit owes more, `affiliate_receivable` where
//! it owes less) and migration 0380 makes both meanings resolve to the hutang
//! account at every unit and the piutang account at head office. So a store
//! remittance is store Dr 2028 / HO Cr 1057, and head office funding a store is
//! HO Dr 1057 / store Cr 2028.
//!
//! **Three columns, by kind.** `BARANG` is goods — what a shop owes for stock
//! it received, settled by its deposits. `PEMBIAYAAN` is financing — head
//! office paying a shop's costs, replenishing its petty cash, advancing it
//! money. `LAIN` is everything else, principal (owner) transactions included.
//! The client keeps these as separate account families and reconciles them
//! separately, so a rule that merged them would produce one balance neither
//! side could agree.
//!
//! # Why a store-to-store entry goes through head office
//!
//! Two shops moving stock between them could book a balance against each other,
//! and the client's chart even has the accounts for it. It would also mean
//! thirteen shops reconciling against twelve counterparties each. Routing
//! through head office makes it two pairs instead of one, and leaves every shop
//! with exactly one counterparty to agree with — which is how the client
//! actually works, and how their own `Piutang/Hutang Affiliasi` suffixes are
//! laid out.
//!
//! This module is pure: no database, no clock, no randomness. Every fact it
//! needs arrives as an argument, which is what lets the properties below be
//! checked exhaustively without a Postgres.

/// Which of the client's two inter-unit columns a balance lands in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AffiliateKind {
    /// `Piutang/Hutang Affiliasi Atas Barang`. Stock sent to a shop, and the
    /// deposits and on-behalf payments that settle it.
    Goods,
    /// `Piutang/Hutang Affiliasi Pembiayaan`. Head office funding a shop:
    /// paying its costs, topping up its float, advancing it money.
    Financing,
    /// Neither money nor goods: a fixed asset moved between sites, a cost
    /// allocation or management fee charged by head office, a correction, a
    /// principal (owner) transaction. `1059 Piutang Affiliasi Lain-lain` at
    /// head office and `2030 Hutang Lain-lain Principal` at the unit (owner
    /// decision 25 Sep, migration 0380); the account map makes both meanings
    /// resolve that way at each site.
    Other,
}

impl AffiliateKind {
    /// The client's own word for it, which is what the qualifier carries and
    /// what an accountant reads on the screen.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Goods => "BARANG",
            Self::Financing => "PEMBIAYAAN",
            Self::Other => "LAIN",
        }
    }
}

/// The meaning head office's side resolves through. An asset: debit when the
/// shop owes more.
pub const AFFILIATE_RECEIVABLE: &str = "affiliate_receivable";
/// The meaning a shop's side resolves through. A liability: credit when it
/// owes more.
pub const AFFILIATE_PAYABLE: &str = "affiliate_payable";

/// The source kinds that move GOODS between units.
///
/// Everything else is financing, and financing is the default deliberately:
/// a new source kind that nobody has thought about lands in the column head
/// office reconciles by hand anyway, rather than quietly joining the goods
/// balance a shop is asked to agree line by line.
//
// The client accountant's rule of 25 Sep: goods cross on Atas Barang
// (1058/2029) — merchandise and shopping bags moving between units, SJD
// dispatch and receipt, returns unit -> HO. Money never does: a shop banking
// its takings into a head-office account, or paying head office's supplier,
// is money, so it crosses on Pembiayaan (it used to be classed as goods).
const GOODS_SOURCES: &[&str] = &["TRANSFER", "GOODS_RECEIPT", "CREDIT_NOTE", "LANDED_COST"];

/// Neither money nor goods (owner decision 25 Sep): assets moved between
/// sites, cost allocations, corrections and principal (owner) transactions
/// cross on Lain-lain (1059 at head office, 2030 at the unit).
const OTHER_SOURCES: &[&str] = &[
    "ASSET_TRANSFER",
    "RECLASS",
    "ADJUSTMENT",
    "WRITE_OFF",
    "DEPRECIATION",
    "AMORTIZATION_RUN",
    "ASSET_RESERVE",
    "PREPAID_ALLOCATION",
    // Head office charging a unit (owner decision, 25 Sep): neither money moved
    // nor goods — a cost allocation across the two books, so Lain-lain 1059.
    "MANAGEMENT_FEE",
    // Owner decision 25 Sep: 2030 Hutang Lain-lain Principal is the unit side
    // of Lain-lain, so money the owner puts into or takes out of a unit
    // crosses there, not on Pembiayaan.
    "EQUITY_MOVEMENT",
];

/// Which column an entry's balance belongs in, from the kind of document
/// behind it.
pub fn kind_for_source(source_kind: &str) -> AffiliateKind {
    if GOODS_SOURCES.contains(&source_kind) {
        AffiliateKind::Goods
    } else if OTHER_SOURCES.contains(&source_kind) {
        AffiliateKind::Other
    } else {
        AffiliateKind::Financing
    }
}

/// One posting line, as the balancer needs to see it.
///
/// Not the poster's `PostingLine`: this module never learns which account a
/// line names, only where it lands and which way it goes. That is the whole
/// input, and it is why the answer is a function of its arguments.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SiteMovement {
    pub site_id: String,
    pub debit_minor: i64,
    pub credit_minor: i64,
}

impl SiteMovement {
    pub fn new(site_id: &str, debit_minor: i64, credit_minor: i64) -> Self {
        Self {
            site_id: site_id.to_string(),
            debit_minor,
            credit_minor,
        }
    }
}

/// One leg the balancer wants added.
///
/// It names a MEANING and a qualifier, never an account code — the same rule
/// every posting rule in this system follows, and the reason Finance can move
/// an affiliate account without a release.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AffiliateLeg {
    /// [`AFFILIATE_RECEIVABLE`] at head office, [`AFFILIATE_PAYABLE`] at a shop.
    pub semantic_key: &'static str,
    /// The family alone, e.g. `BARANG`. Since 0380 the counterparty decides
    /// nothing about the leaf — a unit is on the family's hutang account and
    /// head office on its piutang account whoever is on the other side — so
    /// the family and the site are all `account_resolution` needs (0460). The
    /// counterparty travels as `counter_site_id`.
    pub qualifier: String,
    /// Whose books this leg lands in.
    pub site_id: String,
    /// The unit on the other side of it. Written onto the line so a shop's
    /// ledger can say who the balance is with, rather than leaving somebody to
    /// decode a twelve-digit account code.
    pub counter_site_id: String,
    pub debit_minor: i64,
    pub credit_minor: i64,
}

/// What one unit nets over an entry, in the order the units first appear.
///
/// A `Vec` and not a map: the order legs come out in has to be the same on
/// every run, and a hash map's is not.
fn net_by_site(lines: &[SiteMovement]) -> Vec<(String, i64)> {
    let mut nets: Vec<(String, i64)> = Vec::new();
    for line in lines {
        // Saturating rather than checked, and it cannot bite: the poster has
        // already refused an entry whose debits or credits overflow an i64, so
        // every partial sum here is inside one, and a net is a difference of
        // two non-negative i64s.
        let signed = line.debit_minor.saturating_sub(line.credit_minor);
        match nets.iter_mut().find(|(site, _)| site == &line.site_id) {
            Some((_, net)) => *net = net.saturating_add(signed),
            None => nets.push((line.site_id.clone(), signed)),
        }
    }
    nets
}

/// The unit that is out, if any is.
///
/// The poster calls this after balancing as an assertion rather than as a
/// question: an entry that still has a unit out of balance after the legs were
/// added is a bug in this file, and one that would otherwise reach the ledger
/// looking correct.
pub fn first_unbalanced_site(lines: &[SiteMovement]) -> Option<(String, i64)> {
    net_by_site(lines).into_iter().find(|(_, net)| *net != 0)
}

/// The legs that make every unit balance on its own.
///
/// Empty when there is nothing to do: one unit, or several that already balance
/// individually. That is what makes this safe to run on every posting — the
/// overwhelming majority of entries are at one location and come back untouched.
///
/// The caller must have checked that the entry balances in total. When it does
/// not, the legs below would silently push the whole difference onto head
/// office; when it does, head office's own net is cured by the shops' legs
/// without a leg of its own, because the nets sum to zero.
pub fn balancing_legs(
    lines: &[SiteMovement],
    kind: AffiliateKind,
    ho_site_id: &str,
) -> Vec<AffiliateLeg> {
    let mut legs = Vec::new();
    for (site, net) in net_by_site(lines) {
        if net == 0 || site == ho_site_id {
            continue;
        }
        // `net` is what the shop is holding that nobody in its own books has
        // paid for. A debit excess means value arrived there — a cost, or
        // stock — so the shop owes head office more, and a payable grows by a
        // credit. A credit excess is the mirror: the shop gave up value on head
        // office's behalf, so head office owes it.
        // The meaning follows the direction; the ACCOUNT follows the site
        // (0380): at a unit both meanings resolve to the family's hutang
        // account and at head office to its piutang account. Head office
        // funding a unit: HO Dr 1057 / unit Cr 2028. A unit's takings landing
        // in a head-office bank: unit Dr 2028 / HO Cr 1057.
        let (store_key, ho_key) = if net > 0 {
            (AFFILIATE_PAYABLE, AFFILIATE_RECEIVABLE)
        } else {
            (AFFILIATE_RECEIVABLE, AFFILIATE_PAYABLE)
        };
        let (store_debit, store_credit) = if net > 0 { (0, net) } else { (-net, 0) };
        legs.push(AffiliateLeg {
            semantic_key: store_key,
            qualifier: kind.as_str().to_string(),
            site_id: site.clone(),
            counter_site_id: ho_site_id.to_string(),
            debit_minor: store_debit,
            credit_minor: store_credit,
        });
        legs.push(AffiliateLeg {
            semantic_key: ho_key,
            qualifier: kind.as_str().to_string(),
            site_id: ho_site_id.to_string(),
            counter_site_id: site,
            debit_minor: store_credit,
            credit_minor: store_debit,
        });
    }
    legs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legs(lines: &[SiteMovement], kind: AffiliateKind) -> Vec<AffiliateLeg> {
        balancing_legs(lines, kind, "dc")
    }

    /// The case 0098 refused: head office pays a shop's electricity.
    #[test]
    fn head_office_paying_a_shops_cost_leaves_both_books_balanced() {
        let lines = [
            SiteMovement::new("store-03", 1_000_000, 0),
            SiteMovement::new("dc", 0, 1_000_000),
        ];
        let added = legs(&lines, AffiliateKind::Financing);
        assert_eq!(added.len(), 2);

        assert_eq!(added[0].semantic_key, AFFILIATE_PAYABLE);
        assert_eq!(added[0].site_id, "store-03");
        assert_eq!(added[0].counter_site_id, "dc");
        assert_eq!(added[0].qualifier, "PEMBIAYAAN");
        // The shop owes more, so its payable is credited.
        assert_eq!(
            (added[0].debit_minor, added[0].credit_minor),
            (0, 1_000_000)
        );

        assert_eq!(added[1].semantic_key, AFFILIATE_RECEIVABLE);
        assert_eq!(added[1].site_id, "dc");
        assert_eq!(added[1].counter_site_id, "store-03");
        assert_eq!(added[1].qualifier, "PEMBIAYAAN");
        assert_eq!(
            (added[1].debit_minor, added[1].credit_minor),
            (1_000_000, 0)
        );
    }

    /// A shop banking its takings, which is how the goods balance comes down.
    #[test]
    fn a_shop_banking_its_takings_reduces_what_it_owes() {
        let lines = [
            SiteMovement::new("dc", 5_000_000, 0),
            SiteMovement::new("store-01", 0, 5_000_000),
        ];
        let added = balancing_legs(&lines, kind_for_source("STORE_DEPOSIT"), "dc");
        assert_eq!(added[0].qualifier, "PEMBIAYAAN");
        // The shop gave the money, so the shop is owed: Dr its Piutang, and
        // head office owes it back: Cr its Hutang (client accountant, 25 Sep).
        assert_eq!(added[0].semantic_key, AFFILIATE_RECEIVABLE);
        assert_eq!(added[1].semantic_key, AFFILIATE_PAYABLE);
        assert_eq!(
            (added[0].debit_minor, added[0].credit_minor),
            (5_000_000, 0)
        );
        assert_eq!(
            (added[1].debit_minor, added[1].credit_minor),
            (0, 5_000_000)
        );
    }

    /// Two shops and no head office: two pairs, not one.
    #[test]
    fn a_move_between_two_shops_is_routed_through_head_office() {
        let lines = [
            SiteMovement::new("store-01", 0, 800_000),
            SiteMovement::new("store-02", 800_000, 0),
        ];
        let added = balancing_legs(&lines, kind_for_source("TRANSFER"), "dc");
        assert_eq!(added.len(), 4);
        let ho_debits: i64 = added
            .iter()
            .filter(|leg| leg.site_id == "dc")
            .map(|leg| leg.debit_minor)
            .sum();
        let ho_credits: i64 = added
            .iter()
            .filter(|leg| leg.site_id == "dc")
            .map(|leg| leg.credit_minor)
            .sum();
        // Head office nets to nothing and still carries both counterparties,
        // which is the point of routing through it.
        assert_eq!(ho_debits, ho_credits);
        assert_eq!(added[0].site_id, "store-01");
        assert_eq!(added[2].site_id, "store-02");
    }

    #[test]
    fn an_entry_at_one_location_is_left_exactly_as_it_was() {
        let lines = [
            SiteMovement::new("dc", 8_600_000, 0),
            SiteMovement::new("dc", 0, 8_600_000),
        ];
        assert!(legs(&lines, AffiliateKind::Financing).is_empty());
    }

    /// Several units, each already balanced. Nothing is owed, so nothing is
    /// added — a payroll run charging every shop its own wages against its own
    /// accrual is the ordinary case.
    #[test]
    fn units_that_already_balance_get_no_legs() {
        let lines = [
            SiteMovement::new("dc", 100, 0),
            SiteMovement::new("dc", 0, 100),
            SiteMovement::new("store-05", 250, 0),
            SiteMovement::new("store-05", 0, 250),
        ];
        assert!(legs(&lines, AffiliateKind::Financing).is_empty());
    }

    #[test]
    fn the_kind_comes_from_the_document_and_defaults_to_financing() {
        assert_eq!(kind_for_source("STORE_DEPOSIT"), AffiliateKind::Financing);
        assert_eq!(kind_for_source("REMITTANCE"), AffiliateKind::Financing);
        assert_eq!(kind_for_source("TRANSFER"), AffiliateKind::Goods);
        assert_eq!(
            kind_for_source("SUPPLIER_INVOICE"),
            AffiliateKind::Financing
        );
        assert_eq!(kind_for_source("ASSET_TRANSFER"), AffiliateKind::Other);
        assert_eq!(kind_for_source("EQUITY_MOVEMENT"), AffiliateKind::Other);
        assert_eq!(kind_for_source("anything at all"), AffiliateKind::Financing);
    }

    /// Running the balancer over its own output changes nothing. The poster
    /// depends on this: a reversal copies the stored lines, legs and all, and
    /// must not grow a second set.
    #[test]
    fn balancing_an_already_balanced_entry_adds_nothing() {
        let mut lines = vec![
            SiteMovement::new("store-03", 1_000_000, 0),
            SiteMovement::new("dc", 0, 1_000_000),
        ];
        for leg in legs(&lines, AffiliateKind::Financing) {
            lines.push(SiteMovement::new(
                &leg.site_id,
                leg.debit_minor,
                leg.credit_minor,
            ));
        }
        assert!(legs(&lines, AffiliateKind::Financing).is_empty());
        assert_eq!(first_unbalanced_site(&lines), None);
    }

    /// Every entry that can be built out of these pieces, checked exhaustively.
    ///
    /// Not a hand-picked case: 6 units x 5 amounts across four lines is 22,500
    /// entries, which is a second's work here and a shape of failure a chosen
    /// example cannot find. The generator only builds entries that balance in
    /// TOTAL, because that is the precondition `balancing_legs` documents and
    /// the poster enforces before it calls in.
    fn every_balanced_entry(mut check: impl FnMut(&[SiteMovement])) {
        let sites = ["dc", "store-01", "store-02", "store-03", "store-11", "dc"];
        let amounts = [1_i64, 250, 1_000_000, 8_600_001, 9_000_000_000];
        for first in sites {
            for second in sites {
                for third in sites {
                    for fourth in sites {
                        for left in amounts {
                            for right in amounts {
                                check(&[
                                    SiteMovement::new(first, left, 0),
                                    SiteMovement::new(second, 0, left),
                                    SiteMovement::new(third, right, 0),
                                    SiteMovement::new(fourth, 0, right),
                                ]);
                            }
                        }
                    }
                }
            }
        }
    }

    /// The property the whole module exists for.
    #[test]
    fn every_unit_balances_once_the_legs_are_added() {
        every_balanced_entry(|lines| {
            let mut all = lines.to_vec();
            for leg in balancing_legs(lines, AffiliateKind::Financing, "dc") {
                all.push(SiteMovement::new(
                    &leg.site_id,
                    leg.debit_minor,
                    leg.credit_minor,
                ));
            }
            assert_eq!(
                first_unbalanced_site(&all),
                None,
                "left a unit out: {lines:?}"
            );
        });
    }

    /// And the entry is still the entry. Legs are added in pairs of equal
    /// weight, so the total the poster writes to `journal_entry.total_minor`
    /// grows by the same amount on both sides and never by a different one.
    #[test]
    fn the_legs_add_as_much_debit_as_credit() {
        every_balanced_entry(|lines| {
            let legs = balancing_legs(lines, AffiliateKind::Goods, "dc");
            let debits: i64 = legs.iter().map(|leg| leg.debit_minor).sum();
            let credits: i64 = legs.iter().map(|leg| leg.credit_minor).sum();
            assert_eq!(debits, credits, "unbalanced legs for {lines:?}");
            // And each leg is one side or the other, never both and never
            // neither — `check_balanced` refuses a line that is.
            for leg in &legs {
                assert!(
                    (leg.debit_minor == 0) != (leg.credit_minor == 0),
                    "a leg must be a debit or a credit: {leg:?}"
                );
            }
        });
    }

    /// Running it over its own output changes nothing, over every entry the
    /// generator can build. The reversal path depends on this and so does a
    /// posting rule that has already added a leg of its own.
    #[test]
    fn balancing_is_idempotent_everywhere_not_just_in_the_example() {
        every_balanced_entry(|lines| {
            let mut all = lines.to_vec();
            for leg in balancing_legs(lines, AffiliateKind::Financing, "dc") {
                all.push(SiteMovement::new(
                    &leg.site_id,
                    leg.debit_minor,
                    leg.credit_minor,
                ));
            }
            assert!(
                balancing_legs(&all, AffiliateKind::Financing, "dc").is_empty(),
                "a second pass wanted more legs for {lines:?}"
            );
        });
    }

    #[test]
    fn an_unbalanced_unit_is_named_with_what_it_is_out_by() {
        let lines = [
            SiteMovement::new("dc", 500, 0),
            SiteMovement::new("store-02", 0, 300),
        ];
        assert_eq!(first_unbalanced_site(&lines), Some(("dc".to_string(), 500)));
    }
}
