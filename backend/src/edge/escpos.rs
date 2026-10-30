//! The customer's receipt, and the drawer that opens with it.
//!
//! `zpl.rs` renders *labels* — the tag sewn into a garment, on a printer that
//! speaks ZPL or TSPL. This renders *receipts*, on the thermal printer beside
//! the till, which speaks **ESC/POS**: Epson TM-T82/T88, Xprinter, Gprinter,
//! EPPOS and every 58mm/80mm unit sold into an Indonesian shop. Two different
//! devices with two different languages, so two different modules.
//!
//! It emits BYTES, not text. A receipt carries control codes between its
//! lines, and a renderer that returned a `String` would be one `as_bytes()`
//! away from a printer receiving UTF-8 where it expected a control sequence.
//!
//! The cash drawer plugs into the receipt printer's RJ11 "DK" port and opens
//! when the printer is handed the drawer-kick — the same socket as the
//! receipt, which is why it lives here rather than anywhere near the sale.
//! **The kick is best-effort and cash accounting never depends on it.** A
//! drawer that failed to open is a drawer somebody opens by hand; a sale that
//! refused to complete because of it is a queue.

use chrono::{DateTime, Local, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::cloud::domain::return_policy::indonesian_date;

/// How wide the paper is, in characters at Font A.
///
/// The two sizes sold. Stored as a column count rather than millimetres
/// because the renderer centres and right-aligns by counting characters, and
/// converting mm to columns at every call site is the same arithmetic done in
/// more places.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PaperWidth {
    /// 58mm — 32 columns.
    Narrow,
    /// 80mm — 48 columns.
    Wide,
}

impl PaperWidth {
    pub const fn columns(self) -> usize {
        match self {
            Self::Narrow => 32,
            Self::Wide => 48,
        }
    }

    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_uppercase().as_str() {
            "WIDE" | "80" | "80MM" => Self::Wide,
            _ => Self::Narrow,
        }
    }
}

/// Whether the drawer is opened by the printer, by hand, or not at all.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DrawerMode {
    /// Emit the ESC/POS kick with the receipt.
    PrinterPulse,
    /// The cashier opens it with a key. No command emitted.
    Manual,
    /// There is no drawer.
    None,
}

impl DrawerMode {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_uppercase().as_str() {
            "PRINTER_PULSE" => Self::PrinterPulse,
            "MANUAL" => Self::Manual,
            _ => Self::None,
        }
    }
}

// ── The control codes, named ────────────────────────────────────────────────

const ESC: u8 = 0x1B;
const GS: u8 = 0x1D;

/// `ESC @` — reset. Sent first so the receipt does not inherit whatever the
/// last document left the printer in (double height, inverted, a stale
/// codepage). A printer that renders one receipt correctly and the next one in
/// giant letters is a printer nobody reset.
const INIT: [u8; 2] = [ESC, b'@'];

/// `ESC a n` — 0 left, 1 centre, 2 right.
const fn align(n: u8) -> [u8; 3] {
    [ESC, b'a', n]
}

/// `ESC E n` — emphasis (bold) off/on.
const fn bold(on: bool) -> [u8; 3] {
    [ESC, b'E', on as u8]
}

/// `GS ! n` — character size. The low nibble is height, the high nibble width;
/// `0x11` is double both, which is the only size worth using on a receipt.
const fn size(n: u8) -> [u8; 3] {
    [GS, b'!', n]
}

/// `GS V 66 n` — partial cut after feeding `n` dots, so the receipt tears off
/// with the last line clear of the blade.
const CUT: [u8; 4] = [GS, b'V', 66, 0x50];

/// The drawer kick: `ESC p 0 25 250` — connector pin 0, ~25ms on, ~250ms off.
///
/// The near-universal pulse for the drawers sold in Indonesia. Pin 0 rather
/// than pin 1 because that is what a drawer wired to a TM-T82 answers on, and
/// a shop that has the other wiring changes one constant.
pub const fn drawer_kick() -> [u8; 5] {
    [ESC, b'p', 0x00, 0x19, 0xFA]
}

// ── What a receipt says ─────────────────────────────────────────────────────

/// One line of goods on the receipt.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiptLine {
    pub name: String,
    pub sku_code: String,
    pub quantity: i64,
    pub unit_price_minor: i64,
    /// What was actually charged after a markdown or a promotion. Printed
    /// beside the struck-through original when the two differ, because "why is
    /// this cheaper than the tag" is a question asked at the counter, not
    /// afterwards.
    pub line_total_minor: i64,
    pub base_unit_price_minor: Option<i64>,
    /// False when a return policy says this piece never comes back (postgres
    /// 1006): the on-screen struk marks it "* … tidak bisa ditukar".
    #[serde(default = "taken_back_by_default")]
    pub exchangeable: bool,
    /// The policy that keeps it, by name, for the struk's
    /// "* Pakaian dalam tidak bisa ditukar". None while it may come back.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_exchange_by: Option<String>,
}

fn taken_back_by_default() -> bool {
    true
}

fn required_by_default() -> bool {
    true
}

/// One fee on the bill — a bag, a delivery, a gift box — as the receipt
/// prints it. Not merchandise: it counts in the money, never in Total Item.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiptCharge {
    pub description: String,
    pub amount_minor: i64,
}

/// A promotion that came off this sale (sqlite 0104): under its piece when it
/// names a SKU, by name above Total Disc when it came off the whole basket.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiptPromotion {
    pub name: String,
    pub sku_code: Option<String>,
    /// What it took off, positive.
    pub benefit_minor: i64,
}

/// One way the shopper paid.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiptTender {
    pub method: String,
    pub amount_minor: i64,
    pub reference: Option<String>,
    /// `DEBIT` or `CREDIT` on a card; null on every other tender, and on a
    /// card rung before the till sent it.
    #[serde(default)]
    pub card_kind: Option<String>,
    /// The EDC's bank on a card or QRIS (`BCA`), as the till named it.
    #[serde(default)]
    pub acquirer: Option<String>,
}

/// What a tender is called on paper: the same words the till's struk uses
/// (pos-thermal-prototype.html) — `Tunai`, `EDC BCA`, `QRIS BRI`, `Voucher`,
/// `Diskon karyawan`, `Poin`.
fn tender_label(tender: &ReceiptTender) -> String {
    let kind = match tender.method.as_str() {
        "CASH" => "Tunai",
        "CARD" => "EDC",
        "QRIS" => "QRIS",
        "EWALLET" => "E-Wallet",
        "VOUCHER" => "Voucher",
        "BENEFIT" => "Diskon karyawan",
        "POINTS" => "Poin",
        "OTHER" => "Return",
        _ => "Lainnya",
    };
    let bank = tender
        .acquirer
        .as_deref()
        .map(str::trim)
        .filter(|bank| !bank.is_empty());
    match bank {
        Some(bank) if matches!(tender.method.as_str(), "CARD" | "QRIS") => {
            format!("{kind} {bank}")
        }
        _ => kind.to_string(),
    }
}

/// Everything printed, resolved. The renderer performs no lookups: a receipt
/// that had to reach the database while the printer waited is a receipt that
/// fails differently depending on how busy the shop is.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiptDocument {
    pub shop_name: String,
    /// The picture this store prints in place of the head (0106). Not part of
    /// the document the till shows: it asks for the picture on its own.
    #[serde(skip)]
    #[cfg_attr(feature = "ts", ts(skip))]
    pub header_image: Option<crate::cloud::domain::receipt_header::ReceiptHeader>,
    pub shop_line_1: Option<String>,
    pub shop_line_2: Option<String>,
    pub site_id: String,
    pub sale_id: String,
    /// The number the customer reads back over the phone. Short, because a
    /// UUID is not something anybody says out loud.
    pub receipt_no: String,
    pub completed_at: String,
    pub cashier: String,
    pub lines: Vec<ReceiptLine>,
    /// Fees on the bill (a bag, a delivery), in the order they were rung. The
    /// receipt prints them after the goods, as the till does.
    #[serde(default)]
    pub charges: Vec<ReceiptCharge>,
    pub subtotal_minor: i64,
    /// What the promotions took off, as one figure. Positive.
    pub discount_minor: i64,
    pub total_minor: i64,
    pub tenders: Vec<ReceiptTender>,
    pub paid_minor: i64,
    pub change_minor: i64,
    pub points_earned: i64,
    /// Printed at the foot. A return has to be refused after the window, and
    /// the window is only enforceable if the customer was told.
    pub footer: Option<String>,
    /// A void or a return reprints the original with this stamped across it,
    /// so the two copies cannot be confused at the end of the day.
    pub stamp: Option<String>,
    /// The SKU of each piece on this receipt sold without a tag and not yet
    /// returned, one entry per piece: what a return may take back by its SKU
    /// (owner, 25 Oct 2026). Not printed.
    #[serde(default)]
    pub untagged_open: Vec<String>,
    /// On a return's own receipt (Hari, 28 Oct 2026): the struk the pieces
    /// were sold on — printed "Return dari". Its lines are then the pieces
    /// back (quantity −1, a negative total) followed by the replacements.
    #[serde(default)]
    pub returned_from: Option<String>,
    /// On a struk returned against: the return receipts that took pieces of
    /// it back — "Di-return di". Not printed (a struk is never reprinted).
    #[serde(default)]
    pub returned_in: Vec<String>,
    /// On a return's own receipt: what the pieces back were worth beyond the
    /// replacement, which is not paid out. Not printed: the note reads 0.
    #[serde(default)]
    pub forfeited_minor: i64,
    /// The last day this struk's pieces may come back (`YYYY-MM-DD`), as the
    /// sale wrote it — "Bisa ditukar s/d …". Null on a return's receipt,
    /// which never comes back, and on a sale from before the promise.
    #[serde(default)]
    pub exchange_until: Option<String>,
    /// The two conditions the promise asks for (postgres 1005). The terms
    /// print only the lines this shop actually requires.
    #[serde(default = "required_by_default")]
    pub require_hang_tag: bool,
    #[serde(default = "required_by_default")]
    pub require_receipt: bool,
    /// The promotions by name (sqlite 0104). Empty on a sale from before it,
    /// which prints its cuts as it always did.
    #[serde(default)]
    pub promotions: Vec<ReceiptPromotion>,
}

/// The time, as somebody at a counter reads it.
///
/// `completed_at` travels as RFC 3339 because that is what an API owes a
/// caller, and printing it raw put `2026-09-03T03:33:05.597444Z` on a receipt —
/// thirty-two columns of paper spent on a format no customer can read, which
/// then pushed its own label off the line.
///
/// Rendered in the machine's LOCAL time, and that is exactly right here rather
/// than a convenience: this node runs in the shop. The whole architecture is
/// that the till answers out of a database behind the counter, so the
/// machine's clock IS the shop's clock. A receipt in UTC would be wrong by
/// seven hours in every shop this system runs in.
/// The date (`dd/mm/yy`) and the clock (`hh:mm`) of the sale, apart, for the
/// two head rows of the 7Soft layout. Rendered in the machine's local time, which is the shop's.
fn paper_day_and_clock(iso: &str) -> (String, String) {
    match DateTime::parse_from_rfc3339(iso) {
        Ok(parsed) => {
            let local = parsed.with_timezone(&Local);
            (
                local.format("%d/%m/%y").to_string(),
                local.format("%H:%M").to_string(),
            )
        }
        Err(_) => {
            let mut parts = iso.split_whitespace();
            let day: String = parts.next().unwrap_or("").chars().take(10).collect();
            let clock: String = parts.next().unwrap_or("").chars().take(5).collect();
            (day, clock)
        }
    }
}

/// Money as a shop writes it: `1.250.000`, no decimals.
///
/// Rupiah has no minor unit anybody uses. Printing `Rp 1.250.000,00` on a
/// receipt is two characters of noise per line on paper 32 columns wide.
pub fn rupiah(minor: i64) -> String {
    let negative = minor < 0;
    let digits = minor.unsigned_abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3 + 1);
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push('.');
        }
        out.push(ch);
    }
    if negative {
        format!("-{out}")
    } else {
        out
    }
}

/// The same figure with the currency, as the customer's paper writes it:
/// "Rp 199.000" (Hari, 29 Oct 2026).
fn rp(minor: i64) -> String {
    let text = rupiah(minor);
    match text.strip_prefix('-') {
        Some(rest) => format!("-Rp {rest}"),
        None => format!("Rp {text}"),
    }
}

/// A label on the left, a figure hard against the right margin.
///
/// The one piece of layout a receipt actually needs. When the two would
/// collide the label is cut rather than the figure wrapped: a total that
/// wrapped onto a second line has stopped being a total.
fn ledger(label: &str, value: &str, columns: usize) -> String {
    let value_width = value.chars().count();
    if value_width >= columns {
        return value.to_string();
    }
    let room = columns - value_width;
    let label: String = label.chars().take(room.saturating_sub(1)).collect();
    let gap = room - label.chars().count();
    format!("{label}{}{value}", " ".repeat(gap))
}

fn centre(text: &str, columns: usize) -> String {
    let width = text.chars().count();
    if width >= columns {
        return text.chars().take(columns).collect();
    }
    format!("{}{text}", " ".repeat((columns - width) / 2))
}

fn rule(columns: usize) -> String {
    "-".repeat(columns)
}

/// A fee's name as the customer's paper says it. The till rings the bag by
/// the code head office gave it; the paper reads Indonesian, as the stall
/// does (`BAG_WORDS` in `screens/dialogs.tsx`).
fn charge_label(description: &str) -> String {
    // A bag reads like a piece, code first (pos-thermal-prototype.html BAG-*).
    let words = match description {
        "Small paper bag" => "BAG-PS Tas kertas kecil",
        "Large paper bag" => "BAG-PL Tas kertas besar",
        "Small plastic bag" => "BAG-XS Kantong plastik kecil",
        "Large plastic bag" => "BAG-XL Kantong plastik besar",
        other => other,
    };
    words.to_uppercase()
}

/// Render the receipt to the bytes a printer is handed.
///
/// `kick` is applied at the END of the document rather than the start: a
/// drawer that sprang open while the printer was still deciding whether it had
/// paper is a drawer open on a receipt that never printed.
pub fn render(document: &ReceiptDocument, paper: PaperWidth, drawer: DrawerMode) -> Vec<u8> {
    let columns = paper.columns();
    let mut out: Vec<u8> = Vec::with_capacity(1024);

    let line = |out: &mut Vec<u8>, text: &str| {
        out.extend_from_slice(text.as_bytes());
        out.push(b'\n');
    };

    out.extend_from_slice(&INIT);

    // ── Head ────────────────────────────────────────────────────────────
    // The logo band as the till's struk draws it (pos-thermal-prototype.html
    // `.th-logo`): CENTRAL large, the shop's name under it, then the address.
    // The store's own picture, when head office gave it one (0106): in place of
    // CENTRAL, the shop's name and the address, as a raster, 128 rows at a time
    // so a small printer's buffer is never asked for the whole of it.
    let dots = match paper {
        PaperWidth::Narrow => 384,
        PaperWidth::Wide => 576,
    };
    let picture = document
        .header_image
        .as_ref()
        .and_then(|header| header.for_dots(dots))
        .and_then(|picture| {
            picture
                .bytes()
                .map(|bytes| (usize::from(picture.width / 8), usize::from(picture.height), bytes))
        });
    if let Some((row_bytes, height, bytes)) = picture {
        out.extend_from_slice(&align(1));
        for start in (0..height).step_by(128) {
            let rows = (height - start).min(128);
            out.extend_from_slice(&[
                GS,
                b'v',
                b'0',
                0,
                (row_bytes & 0xFF) as u8,
                (row_bytes >> 8) as u8,
                (rows & 0xFF) as u8,
                (rows >> 8) as u8,
            ]);
            out.extend_from_slice(&bytes[start * row_bytes..(start + rows) * row_bytes]);
        }
    } else {
        out.extend_from_slice(&align(1));
        out.extend_from_slice(&size(0x11));
        out.extend_from_slice(&bold(true));
        line(&mut out, "CENTRAL");
        out.extend_from_slice(&bold(false));
        out.extend_from_slice(&size(0x00));
        // The shop by its name only: no store code ("C001 · Cikupa" prints
        // "Cikupa"; Hari, 30 Oct 2026).
        let shop = shop_without_code(&document.shop_name);
        if !shop.is_empty() && shop != "CENTRAL" {
            line(&mut out, &shop);
        }
        for extra in [&document.shop_line_1, &document.shop_line_2]
            .into_iter()
            .flatten()
        {
            line(&mut out, extra);
        }

    }

    if let Some(stamp) = &document.stamp {
        line(&mut out, "");
        out.extend_from_slice(&size(0x11));
        out.extend_from_slice(&bold(true));
        line(&mut out, stamp);
        out.extend_from_slice(&bold(false));
        out.extend_from_slice(&size(0x00));
    }

    out.extend_from_slice(&align(0));
    line(&mut out, &rule(columns));
    let (paper_day, paper_clock) = paper_day_and_clock(&document.completed_at);
    // 7Soft's two head rows. The document carries the cashier as the till
    // named it and the site as an id, so the code beside the name is the id
    // only when it is short enough to be a code.
    // No store code on the paper (Hari, 30 Oct 2026).
    let site_code = String::new();
    line(
        &mut out,
        &ledger(
            &format!("No Nota  {}", document.receipt_no),
            &paper_day,
            columns,
        ),
    );
    line(
        &mut out,
        &ledger(
            format!("Kasir    {} {}", document.cashier.to_uppercase(), site_code).trim_end(),
            &paper_clock,
            columns,
        ),
    );
    if let Some(from) = &document.returned_from {
        line(&mut out, &format!("Return dari {from}"));
    }
    line(&mut out, &rule(columns));

    // ── Goods ───────────────────────────────────────────────────────────
    //
    // The paper lists an article once, as the till's own struk does: the node
    // records every tag, but two tags of the same SKU at the same price read
    // as one line with a count (pos-thermal-prototype.html).
    let mut grouped: Vec<ReceiptLine> = Vec::new();
    for one in &document.lines {
        if let Some(seen) = grouped.iter_mut().find(|seen| {
            seen.sku_code == one.sku_code
                && seen.name == one.name
                && seen.unit_price_minor == one.unit_price_minor
                && seen.base_unit_price_minor == one.base_unit_price_minor
                && seen.quantity.signum() == one.quantity.signum()
                && seen.line_total_minor.signum() == one.line_total_minor.signum()
        }) {
            seen.quantity += one.quantity;
            seen.line_total_minor += one.line_total_minor;
        } else {
            grouped.push(one.clone());
        }
    }
    let lines = &grouped;
    //
    // "<sku> <NAME>" on its own line, the arithmetic beneath it with the
    // amount on the right margin. One line would truncate the name on
    // 32-column paper, and the name is the part a customer checks. A piece
    // coming back has a negative quantity and a negative amount.
    let mut pieces: i64 = 0;
    let mut gross: i64 = 0;
    for item in lines {
        let heading = format!("{} {}", item.sku_code, item.name.to_uppercase());
        // A long name wraps on paper; a cut name is a name nobody can check.
        for chunk in wrap(&heading, columns) {
            line(&mut out, &chunk);
        }
        let at_price = item.quantity * item.unit_price_minor;
        pieces += item.quantity;
        gross += at_price;
        line(
            &mut out,
            &ledger(
                &format!("  {} x {}", item.quantity, rp(item.unit_price_minor)),
                &rp(at_price),
                columns,
            ),
        );
        // Only when a markdown moved the price. Printing the tag price on
        // every line teaches a customer to ignore it.
        if let Some(base) = item.base_unit_price_minor {
            if base > item.unit_price_minor {
                line(&mut out, &ledger("  harga awal", &rp(base), columns));
            }
        }
        // Each promotion that came off this SKU, by name, right under it
        // (pos-thermal-prototype.html `saleLine`).
        let mut named_here = false;
        for promo in document.promotions.iter().filter(|promo| {
            promo.sku_code.as_deref() == Some(item.sku_code.as_str()) && item.quantity > 0
        }) {
            named_here = true;
            line(
                &mut out,
                &ledger(
                    &format!("  {}", promo.name),
                    &rp(-promo.benefit_minor),
                    columns,
                ),
            );
        }
        // A promotion took something off this piece and no name was kept for
        // it. A returned piece gives it back, plus.
        if !named_here && item.line_total_minor.abs() < at_price.abs() {
            line(
                &mut out,
                &ledger("  Diskon", &rp(item.line_total_minor - at_price), columns),
            );
        }
    }

    // ── Fees (a bag, a delivery) ────────────────────────────────────────
    //
    // On the bill, not merchandise: printed after the goods, counted in the
    // money, never in Total Item. Same description at the same price is one
    // line with a count, as the till draws it.
    let mut charge_groups: Vec<(String, i64, i64)> = Vec::new();
    for charge in &document.charges {
        if let Some(seen) = charge_groups
            .iter_mut()
            .find(|seen| seen.0 == charge.description && seen.2 == charge.amount_minor)
        {
            seen.1 += 1;
        } else {
            charge_groups.push((charge.description.clone(), 1, charge.amount_minor));
        }
    }
    for (description, count, amount) in &charge_groups {
        line(&mut out, &charge_label(description));
        line(
            &mut out,
            &ledger(
                &format!("  {count} x {}", rp(*amount)),
                &rp(count * amount),
                columns,
            ),
        );
        gross += count * amount;
    }

    line(&mut out, &rule(columns));

    // ── Money ───────────────────────────────────────────────────────────
    let is_return = document.returned_from.is_some();
    let items_count: i64 = if is_return {
        lines.iter().map(|one| one.quantity.abs()).sum()
    } else {
        pieces
    };
    let items_amount = if is_return {
        // A return's figure is what the note owes after the pieces back and
        // the promotions (pos-thermal-prototype.html, ret()), never below 0.
        document.total_minor.max(0)
    } else {
        gross
    };
    // A return note never shows a discount figure: the pieces back and the
    // promotions are already inside the lines (pos-thermal-prototype.html, ret()).
    let total_cut = if is_return {
        0
    } else {
        (gross - document.total_minor).max(0)
    };
    line(
        &mut out,
        &ledger(
            &format!("Total Item: {items_count} Pcs"),
            &rp(items_amount),
            columns,
        ),
    );
    // A promotion off the whole basket (member, coupon) by name, above
    // Total Disc; one naming a SKU not on the paper joins them.
    if !is_return {
        for promo in document.promotions.iter().filter(|promo| {
            promo
                .sku_code
                .as_deref()
                .is_none_or(|sku| !lines.iter().any(|one| one.sku_code == sku))
        }) {
            line(
                &mut out,
                &ledger(&promo.name, &rp(-promo.benefit_minor), columns),
            );
        }
    }
    // No discount, no discount lines: Total Item already says the total
    // (Hari, 30 Oct 2026). A return keeps them: its total is the amount owed.
    if is_return || total_cut != 0 {
        line(&mut out, &ledger("Total Disc", &rp(total_cut), columns));
        out.extend_from_slice(&bold(true));
        line(
            &mut out,
            &ledger("Setelah Disc.", &rp(document.total_minor), columns),
        );
        out.extend_from_slice(&bold(false));
    }

    // The ways it was paid under their own rule, as the struk draws them.
    line(&mut out, &rule(columns));
    for tender in &document.tenders {
        // A voucher is paper with a code the customer may read back; a card's
        // reference is an approval code, not part of the paper's promise.
        let label = match (tender.method.as_str(), tender.reference.as_deref()) {
            ("VOUCHER", Some(code)) if !code.trim().is_empty() => {
                format!("Voucher {}", code.trim())
            }
            // A point is a rupiah: "Poin 50.000", the points spent.
            ("POINTS", _) => format!("Poin {}", rupiah(tender.amount_minor)),
            _ => tender_label(tender),
        };
        line(&mut out, &ledger(&label, &rp(tender.amount_minor), columns));
    }
    line(
        &mut out,
        &ledger(
            "Kembali",
            // A return note never pays money out: with nothing due, no change.
            &rp(if is_return && document.total_minor <= 0 {
                0
            } else {
                document.change_minor
            }),
            columns,
        ),
    );
    // What a cheaper or missing replacement leaves is not printed: the struk
    // shows the note at 0 (pos-thermal-prototype.html, "Lebih murah").

    if document.points_earned != 0 {
        line(&mut out, &rule(columns));
        let sign = if document.points_earned > 0 { "+" } else { "-" };
        line(
            &mut out,
            &ledger(
                "Member point",
                &format!("{sign}{} poin", document.points_earned.abs()),
                columns,
            ),
        );
    }

    // ── Terms ───────────────────────────────────────────────────────────
    out.extend_from_slice(&align(1));
    let nothing_comes_back = !lines.is_empty() && lines.iter().all(|one| !one.exchangeable);
    let goods_going_out = lines.iter().any(|one| one.quantity > 0);
    // "SKU NAME tidak bisa ditukar", exactly as the row above names the piece
    // (Hari, 30 Oct 2026).
    let refusal = |one: &ReceiptLine| {
        format!(
            "{} {} tidak bisa ditukar",
            one.sku_code,
            one.name.to_uppercase()
        )
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
    };
    if (is_return && goods_going_out) || nothing_comes_back {
        // A struk with a return on it never comes back again, replacements
        // included; and a struk of only final pieces has nothing to promise.
        line(&mut out, &rule(columns));
        out.extend_from_slice(&bold(true));
        let named: Vec<&ReceiptLine> = if is_return {
            lines.iter().filter(|one| one.quantity > 0).collect()
        } else {
            lines.iter().collect()
        };
        for one in named {
            for chunk in wrap(&refusal(one), columns) {
                line(&mut out, &centre(&chunk, columns));
            }
        }
        out.extend_from_slice(&bold(false));
    } else {
        // What never comes back, by the piece itself (owner, 29 Oct 2026):
        // the box names the SKU and the name, as the rows above do.
        let mut refused: Vec<&ReceiptLine> = Vec::new();
        for one in lines {
            if one.no_exchange_by.is_some()
                && !refused
                    .iter()
                    .any(|seen| seen.sku_code == one.sku_code && seen.name == one.name)
            {
                refused.push(one);
            }
        }
        let deadline = document
            .exchange_until
            .as_deref()
            .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());
        // The client's own terms on every sale (29 Oct 2026), with the two
        // conditions the shop's promise asks for. A sale from before the
        // promise has no deadline: it prints the sentence the node kept.
        if deadline.is_some() || !refused.is_empty() {
            line(&mut out, &rule(columns));
        }
        if let Some(deadline) = deadline {
            line(&mut out, "Ketentuan penukaran barang:");
            for chunk in term_lines(
                "- ",
                &format!("Penukaran paling lambat tgl {}", indonesian_date(deadline)),
                columns,
            ) {
                line(&mut out, &chunk);
            }
            // Every term on every sale (Hari, 30 Oct 2026), whatever the
            // return policy's switches say: the client's own wording.
            for chunk in term_lines("- ", "Nota penjualan wajib dibawa saat penukaran", columns) {
                line(&mut out, &chunk);
            }
            for chunk in term_lines(
                "- ",
                "Hang tag dan label harga barang tidak boleh terlepas, rusak, atau hilang",
                columns,
            ) {
                line(&mut out, &chunk);
            }
            for chunk in term_lines(
                "- ",
                "Barang hanya dapat ditukar dengan barang yang sama atau lebih mahal",
                columns,
            ) {
                line(&mut out, &chunk);
            }
            for chunk in term_lines(
                "- ",
                "Penukaran barang dengan barang yang lebih murah tidak ada pengembalian uang",
                columns,
            ) {
                line(&mut out, &chunk);
            }
        } else if let Some(footer) = document
            .footer
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            for chunk in wrap(footer, columns) {
                line(&mut out, &centre(&chunk, columns));
            }
        }
        // The whole sentence in bold (Hari, 30 Oct 2026).
        out.extend_from_slice(&bold(true));
        for one in refused {
            for chunk in term_lines("- ", &refusal(one), columns) {
                line(&mut out, &chunk);
            }
        }
        out.extend_from_slice(&bold(false));
    }

    // ── Foot ────────────────────────────────────────────────────────────
    line(&mut out, &rule(columns));
    line(
        &mut out,
        &centre("Terima Kasih atas Kunjungan Anda", columns),
    );
    line(&mut out, &centre("Kritik dan saran hubungi", columns));
    line(&mut out, &centre("TLP. (0289) 4403336", columns));
    line(&mut out, "");
    line(&mut out, "");

    if matches!(drawer, DrawerMode::PrinterPulse) {
        out.extend_from_slice(&drawer_kick());
    }
    out.extend_from_slice(&CUT);
    out
}

/// "C001 · Cikupa" → "Cikupa": a leading store code and its separator off.
fn shop_without_code(name: &str) -> String {
    let name = name.trim();
    if let Some((head, rest)) = name.split_once('·') {
        let head = head.trim();
        let code = head.len() <= 10
            && head.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
            && head.chars().any(|c| c.is_ascii_digit())
            && !head.contains(' ');
        if code {
            return rest.trim().to_string();
        }
    }
    name.to_string()
}

/// A term whose wrapped lines start under the text, not under the dash
/// (pos-thermal-prototype.html, `.terms .li`).
fn term_lines(prefix: &str, text: &str, columns: usize) -> Vec<String> {
    let mut lines = wrap(&format!("{prefix}{text}"), columns);
    if lines.len() > 1 {
        let indent = " ".repeat(prefix.chars().count());
        for line in lines.iter_mut().skip(1) {
            if line.chars().count() + indent.chars().count() <= columns {
                *line = format!("{indent}{line}");
            }
        }
    }
    lines
}

/// Wrap on whitespace, never mid-word. A footer that hyphenated an address
/// would be a footer nobody could read back.
fn wrap(text: &str, columns: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        if current.is_empty() {
            current.push_str(word);
        } else if current.chars().count() + 1 + word.chars().count() <= columns {
            current.push(' ');
            current.push_str(word);
        } else {
            out.push(std::mem::take(&mut current));
            current.push_str(word);
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document() -> ReceiptDocument {
        ReceiptDocument {
            shop_name: "ITULAH".into(),
            header_image: None,
            shop_line_1: Some("Jl. Merdeka 12, Bandung".into()),
            shop_line_2: None,
            site_id: "store-01".into(),
            sale_id: "018f-…".into(),
            receipt_no: "S01-000123".into(),
            completed_at: "2026-09-03 14:22".into(),
            cashier: "siti".into(),
            lines: vec![ReceiptLine {
                name: "Kemeja Oxford Putih".into(),
                sku_code: "10000000123".into(),
                quantity: 1,
                unit_price_minor: 199_000,
                line_total_minor: 199_000,
                base_unit_price_minor: Some(249_000),
                exchangeable: true,
                no_exchange_by: None,
            }],
            subtotal_minor: 249_000,
            charges: Vec::new(),
            discount_minor: 50_000,
            total_minor: 199_000,
            tenders: vec![ReceiptTender {
                method: "CASH".into(),
                amount_minor: 200_000,
                reference: None,
                card_kind: None,
                acquirer: None,
            }],
            paid_minor: 200_000,
            change_minor: 1_000,
            points_earned: 19,
            footer: Some("Terima kasih. Penukaran maksimal 7 hari dengan struk ini.".into()),
            stamp: None,
            untagged_open: Vec::new(),
            returned_from: None,
            returned_in: Vec::new(),
            forfeited_minor: 0,
            exchange_until: None,
            require_hang_tag: true,
            require_receipt: true,
            promotions: Vec::new(),
        }
    }

    #[test]
    fn rupiah_groups_by_thousands() {
        assert_eq!(rupiah(0), "0");
        assert_eq!(rupiah(999), "999");
        assert_eq!(rupiah(1_000), "1.000");
        assert_eq!(rupiah(1_250_000), "1.250.000");
        assert_eq!(rupiah(-5_000), "-5.000");
    }

    #[test]
    fn ledger_puts_the_figure_on_the_right_margin() {
        let row = ledger("Setelah Disc.", "199.000", 32);
        assert_eq!(row.chars().count(), 32);
        assert!(row.ends_with("199.000"));
        assert!(row.starts_with("Setelah Disc."));
    }

    /// A label long enough to collide is cut; the figure is never wrapped,
    /// because a total on two lines has stopped being a total.
    #[test]
    fn ledger_sacrifices_the_label_not_the_figure() {
        let row = ledger(&"x".repeat(60), "1.000.000", 32);
        assert_eq!(row.chars().count(), 32);
        assert!(row.ends_with("1.000.000"));
    }

    /// What never comes back is named the way the rows above are: SKU then
    /// name, not a bare "Barang tidak bisa ditukar" (Hari, 30 Oct 2026). The
    /// line may wrap on 32 columns; what matters is that both parts are there.
    #[test]
    fn a_piece_that_never_comes_back_is_named_by_sku_and_name() {
        let mut doc = document();
        doc.lines[0].exchangeable = false;
        doc.lines[0].no_exchange_by = Some("Pakaian dalam".into());
        let text = String::from_utf8_lossy(&render(&doc, PaperWidth::Narrow, DrawerMode::None))
            .to_string();
        let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
        assert!(
            flat.contains("10000000123 KEMEJA OXFORD PUTIH tidak bisa ditukar"),
            "{text}"
        );
        assert!(!text.contains("* Barang tidak bisa ditukar"), "{text}");
    }

    /// Every sale with a promise prints the client's own terms, not the old
    /// one-sentence footer (pos-thermal-prototype.html, 29 Oct 2026).
    #[test]
    fn a_sale_with_a_promise_prints_the_clients_terms() {
        let mut doc = document();
        doc.exchange_until = Some("2026-09-10".into());
        let text = String::from_utf8_lossy(&render(&doc, PaperWidth::Narrow, DrawerMode::None))
            .to_string();
        let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
        assert!(flat.contains("Ketentuan penukaran barang:"), "{text}");
        assert!(
            flat.contains("- Penukaran paling lambat tgl 10 September 2026"),
            "{text}"
        );
        assert!(
            flat.contains("- Nota penjualan wajib dibawa saat penukaran"),
            "{text}"
        );
        assert!(
            flat.contains(
                "- Hang tag dan label harga barang tidak boleh terlepas, rusak, atau hilang"
            ),
            "{text}"
        );
        assert!(
            flat.contains("- Barang hanya dapat ditukar dengan barang yang sama atau lebih mahal"),
            "{text}"
        );
        assert!(
            flat.contains(
                "- Penukaran barang dengan barang yang lebih murah tidak ada pengembalian uang"
            ),
            "{text}"
        );
        assert!(
            !flat.contains("Penukaran maksimal"),
            "still the old footer: {text}"
        );
    }

    /// The node records one line per tag; the customer's paper lists an
    /// article once with a count, as the till's own struk does.
    #[test]
    fn two_tags_of_one_sku_print_as_one_line_with_a_count() {
        let mut doc = document();
        doc.lines.push(doc.lines[0].clone());
        let text = String::from_utf8_lossy(&render(&doc, PaperWidth::Narrow, DrawerMode::None))
            .to_string();
        assert_eq!(text.matches("KEMEJA OXFORD PUTIH").count(), 1, "{text}");
        assert!(text.contains("2 x Rp 199.000"), "{text}");
        assert!(text.contains("Rp 398.000"), "{text}");
    }

    /// A bag is on the bill but is not a piece: its own line and money, never
    /// in Total Item (pos-thermal-prototype.html, sale()).
    #[test]
    fn a_bag_prints_as_a_line_but_not_as_a_piece() {
        let mut doc = document();
        doc.charges = vec![
            ReceiptCharge {
                description: "Large paper bag".into(),
                amount_minor: 0,
            },
            ReceiptCharge {
                description: "Large paper bag".into(),
                amount_minor: 0,
            },
        ];
        let text = String::from_utf8_lossy(&render(&doc, PaperWidth::Narrow, DrawerMode::None))
            .to_string();
        assert!(text.contains("TAS KERTAS BESAR"), "{text}");
        assert!(text.contains("2 x Rp 0"), "{text}");
        assert!(text.contains("Total Item: 1 Pcs"), "{text}");
    }

    /// A promotion prints by name under the piece it came off, and one off
    /// the whole basket above Total Disc (pos-thermal-prototype.html, Hari 30
    /// Oct 2026).
    #[test]
    fn promotions_print_by_name() {
        let mut doc = document();
        let sku = doc.lines[0].sku_code.clone();
        doc.promotions = vec![
            ReceiptPromotion {
                name: "Gajian Oktober 30%".into(),
                sku_code: Some(sku),
                benefit_minor: 62_100,
            },
            ReceiptPromotion {
                name: "Kupon HEMAT50".into(),
                sku_code: None,
                benefit_minor: 50_000,
            },
        ];
        let text = String::from_utf8_lossy(&render(&doc, PaperWidth::Narrow, DrawerMode::None))
            .to_string();
        let promo = text
            .find("Gajian Oktober 30%")
            .expect("line promotion printed");
        let coupon = text
            .find("Kupon HEMAT50")
            .expect("basket promotion printed");
        let total_disc = text.find("Total Disc").expect("Total Disc printed");
        assert!(promo < coupon && coupon < total_disc, "{text}");
        assert!(text.contains("-Rp 62.100"), "{text}");
    }

    #[test]
    fn receipt_starts_with_a_reset_and_ends_with_a_cut() {
        let bytes = render(&document(), PaperWidth::Narrow, DrawerMode::Manual);
        assert!(bytes.starts_with(&INIT));
        assert!(bytes.ends_with(&CUT));
    }

    /// The kick rides the receipt, and only when the drawer is wired to the
    /// printer. Cash accounting never depends on it firing.
    #[test]
    fn drawer_kicks_only_on_printer_pulse() {
        let with = render(&document(), PaperWidth::Narrow, DrawerMode::PrinterPulse);
        let without = render(&document(), PaperWidth::Narrow, DrawerMode::Manual);
        assert!(with.windows(5).any(|window| window == drawer_kick()));
        assert!(!without.windows(5).any(|window| window == drawer_kick()));
    }

    /// The list price appears only when something moved it. A receipt that
    /// prints "harga awal" on every line teaches the customer to skip it.
    #[test]
    fn list_price_prints_only_when_it_differs() {
        let mut doc = document();
        let discounted =
            String::from_utf8_lossy(&render(&doc, PaperWidth::Narrow, DrawerMode::None))
                .to_string();
        assert!(discounted.contains("harga awal"));

        doc.lines[0].base_unit_price_minor = Some(doc.lines[0].unit_price_minor);
        let plain = String::from_utf8_lossy(&render(&doc, PaperWidth::Narrow, DrawerMode::None))
            .to_string();
        assert!(!plain.contains("harga awal"));
    }

    /// A receipt is read by a customer, not by a parser. Printing the wire's
    /// RFC 3339 spent the whole 32-column line on a timestamp and pushed its
    /// own label off the row — the line read `Tang 2026-09-03T03:33:05.597Z`.
    #[test]
    fn the_time_on_paper_is_readable_and_keeps_its_label() {
        let mut doc = document();
        doc.completed_at = "2026-09-03T03:33:05.597444Z".into();
        let text = String::from_utf8_lossy(&render(&doc, PaperWidth::Narrow, DrawerMode::None))
            .to_string();
        let row = text
            .lines()
            .find(|line| line.starts_with("No Nota"))
            .unwrap_or_else(|| panic!("no date row in:\n{text}"));
        assert_eq!(row.chars().count(), 32);
        assert!(!row.contains('T'), "still the wire format: {row}");
        assert!(!row.contains('Z'), "still the wire format: {row}");
        assert!(row.contains('/'), "no readable date: {row}");
        let clock = text
            .lines()
            .find(|line| line.starts_with("Kasir"))
            .unwrap_or_else(|| panic!("no clock row in:\n{text}"));
        assert_eq!(clock.chars().count(), 32);
        // hh:mm in the machine's own zone, which is the shop's.
        assert!(clock.contains(':'), "no readable clock: {clock}");
    }

    #[test]
    fn wide_paper_uses_more_columns() {
        assert_eq!(PaperWidth::Narrow.columns(), 32);
        assert_eq!(PaperWidth::Wide.columns(), 48);
        let wide =
            String::from_utf8_lossy(&render(&document(), PaperWidth::Wide, DrawerMode::None))
                .to_string();
        assert!(wide.lines().any(|line| line.chars().count() == 48));
    }

    /// A reprint has to be distinguishable from the original at a glance, or
    /// the two are counted twice at the end of the day.
    #[test]
    fn a_stamp_prints_when_present() {
        let mut doc = document();
        doc.stamp = Some("** BATAL **".into());
        let text = String::from_utf8_lossy(&render(&doc, PaperWidth::Narrow, DrawerMode::None))
            .to_string();
        assert!(text.contains("** BATAL **"));
    }

    /// A card or a QR says which it was and on whose machine (client, 25 Oct
    /// 2026); the change is "Kembali".
    #[test]
    fn a_card_names_its_kind_and_its_bank() {
        let mut doc = document();
        let tender =
            |method: &str, card_kind: Option<&str>, acquirer: Option<&str>| ReceiptTender {
                method: method.into(),
                amount_minor: 50_000,
                reference: None,
                card_kind: card_kind.map(Into::into),
                acquirer: acquirer.map(Into::into),
            };
        doc.tenders = vec![
            tender("CARD", Some("DEBIT"), Some("BCA")),
            tender("CARD", Some("CREDIT"), Some("MANDIRI")),
            tender("QRIS", None, Some("BRI")),
            tender("CASH", None, None),
        ];
        let text = String::from_utf8_lossy(&render(&doc, PaperWidth::Narrow, DrawerMode::None))
            .to_string();
        let has = |label: &str| text.lines().any(|line| line.contains(label));
        assert!(has("EDC BCA"), "{text}");
        assert!(has("EDC MANDIRI"), "{text}");
        assert!(has("QRIS BRI"), "{text}");
        assert!(has("Tunai"), "{text}");
        assert!(has("Kembali "), "{text}");
        assert!(!text.contains("Debit"), "{text}");
        assert!(!text.contains("Kembalian"), "{text}");
    }
}
