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

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};

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
}

/// One way the shopper paid.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiptTender {
    pub method: String,
    pub amount_minor: i64,
    pub reference: Option<String>,
}

/// Everything printed, resolved. The renderer performs no lookups: a receipt
/// that had to reach the database while the printer waited is a receipt that
/// fails differently depending on how busy the shop is.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiptDocument {
    pub shop_name: String,
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
fn paper_time(iso: &str) -> String {
    match DateTime::parse_from_rfc3339(iso) {
        Ok(parsed) => parsed
            .with_timezone(&Local)
            .format("%d/%m/%Y %H:%M")
            .to_string(),
        // Unparseable is not a reason to refuse a receipt. Print what was
        // stored, trimmed to the day, and let somebody notice.
        Err(_) => iso.chars().take(16).collect(),
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
    out.extend_from_slice(&align(1));
    out.extend_from_slice(&size(0x11));
    out.extend_from_slice(&bold(true));
    line(&mut out, &document.shop_name);
    out.extend_from_slice(&bold(false));
    out.extend_from_slice(&size(0x00));
    for extra in [&document.shop_line_1, &document.shop_line_2]
        .into_iter()
        .flatten()
    {
        line(&mut out, extra);
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
    line(&mut out, "");
    line(&mut out, &ledger("No", &document.receipt_no, columns));
    line(
        &mut out,
        &ledger("Waktu", &paper_time(&document.completed_at), columns),
    );
    line(&mut out, &ledger("Kasir", &document.cashier, columns));
    line(&mut out, &rule(columns));

    // ── Goods ───────────────────────────────────────────────────────────
    //
    // Two lines per garment, always: the name on its own, the arithmetic
    // beneath it. One line would truncate the name on 32-column paper, and the
    // name is the part a customer checks.
    for item in &document.lines {
        line(
            &mut out,
            &item.name.chars().take(columns).collect::<String>(),
        );
        let arithmetic = format!("{} x {}", item.quantity, rupiah(item.unit_price_minor));
        line(
            &mut out,
            &ledger(
                &format!("  {arithmetic}"),
                &rupiah(item.line_total_minor),
                columns,
            ),
        );
        // Only when a promotion or a markdown moved the price. Printing the
        // list price on every line teaches a customer to ignore it.
        if let Some(base) = item.base_unit_price_minor {
            if base != item.unit_price_minor {
                line(&mut out, &ledger("  Harga normal", &rupiah(base), columns));
            }
        }
    }

    line(&mut out, &rule(columns));

    // ── Money ───────────────────────────────────────────────────────────
    line(
        &mut out,
        &ledger("Subtotal", &rupiah(document.subtotal_minor), columns),
    );
    if document.discount_minor != 0 {
        line(
            &mut out,
            &ledger(
                "Diskon",
                &format!("-{}", rupiah(document.discount_minor)),
                columns,
            ),
        );
    }
    out.extend_from_slice(&bold(true));
    line(
        &mut out,
        &ledger("TOTAL", &rupiah(document.total_minor), columns),
    );
    out.extend_from_slice(&bold(false));

    for tender in &document.tenders {
        let label = match tender.method.as_str() {
            "CASH" => "Tunai",
            "CARD" => "Kartu",
            "QRIS" => "QRIS",
            _ => "Lainnya",
        };
        line(
            &mut out,
            &ledger(label, &rupiah(tender.amount_minor), columns),
        );
        // The acquirer or approval code, for whoever reconciles this against a
        // statement. Never an instrument — `screen_reference` refuses anything
        // shaped like a card number long before it reaches paper.
        if let Some(reference) = &tender.reference {
            line(&mut out, &format!("  {reference}"));
        }
    }
    if document.change_minor > 0 {
        line(
            &mut out,
            &ledger("Kembali", &rupiah(document.change_minor), columns),
        );
    }

    if document.points_earned > 0 {
        line(&mut out, &rule(columns));
        line(
            &mut out,
            &ledger("Poin", &document.points_earned.to_string(), columns),
        );
    }

    // ── Foot ────────────────────────────────────────────────────────────
    line(&mut out, "");
    out.extend_from_slice(&align(1));
    if let Some(footer) = &document.footer {
        for chunk in wrap(footer, columns) {
            line(&mut out, &centre(&chunk, columns));
        }
    }
    line(&mut out, "");
    line(&mut out, "");

    if matches!(drawer, DrawerMode::PrinterPulse) {
        out.extend_from_slice(&drawer_kick());
    }
    out.extend_from_slice(&CUT);
    out
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
            }],
            subtotal_minor: 249_000,
            discount_minor: 50_000,
            total_minor: 199_000,
            tenders: vec![ReceiptTender {
                method: "CASH".into(),
                amount_minor: 200_000,
                reference: None,
            }],
            paid_minor: 200_000,
            change_minor: 1_000,
            points_earned: 19,
            footer: Some("Terima kasih. Penukaran maksimal 7 hari dengan struk ini.".into()),
            stamp: None,
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
        let row = ledger("TOTAL", "199.000", 32);
        assert_eq!(row.chars().count(), 32);
        assert!(row.ends_with("199.000"));
        assert!(row.starts_with("TOTAL"));
    }

    /// A label long enough to collide is cut; the figure is never wrapped,
    /// because a total on two lines has stopped being a total.
    #[test]
    fn ledger_sacrifices_the_label_not_the_figure() {
        let row = ledger(&"x".repeat(60), "1.000.000", 32);
        assert_eq!(row.chars().count(), 32);
        assert!(row.ends_with("1.000.000"));
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
    /// prints "Harga normal" on every line teaches the customer to skip it.
    #[test]
    fn list_price_prints_only_when_it_differs() {
        let mut doc = document();
        let discounted =
            String::from_utf8_lossy(&render(&doc, PaperWidth::Narrow, DrawerMode::None))
                .to_string();
        assert!(discounted.contains("Harga normal"));

        doc.lines[0].base_unit_price_minor = Some(doc.lines[0].unit_price_minor);
        let plain = String::from_utf8_lossy(&render(&doc, PaperWidth::Narrow, DrawerMode::None))
            .to_string();
        assert!(!plain.contains("Harga normal"));
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
            .find(|line| line.starts_with("Waktu"))
            .unwrap_or_else(|| panic!("no time row in:\n{text}"));
        assert_eq!(row.chars().count(), 32);
        assert!(!row.contains('T'), "still the wire format: {row}");
        assert!(!row.contains('Z'), "still the wire format: {row}");
        // 03/09/2026 in the machine's own zone, which is the shop's.
        assert!(row.contains("/2026"), "no readable date: {row}");
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
}
