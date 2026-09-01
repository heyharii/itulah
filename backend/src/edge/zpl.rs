//! ZPL II rendering for garment hang tags, and the RFID write that goes with
//! them.
//!
//! The target printer is a Printronix T6204e running ZGL, which is a strict
//! subset of ZPL II. Only commands confirmed to work under that emulation are
//! emitted here: `^XA ^XZ ^PW ^LL ^CI ^FO ^A0 ^FD ^FS ^BY ^BC ^PQ ^RFW`.
//! Reaching for a richer command because a Zebra would accept it is how a label
//! run dies at 3 a.m. on the only printer the DC owns. That set has no rules,
//! no boxes and no reversed text, so the hang tag is built out of type alone:
//! hierarchy here is size and space, never a line or a filled block.
//!
//! # The hang tag
//!
//! A shopper reads this tag in one pass while holding the garment on a rail,
//! and reads it in a fixed order: whose is it, what is it, will it fit, what
//! does it cost. The layout is that order, top to bottom, in one left-aligned
//! column, with the two things anyone actually squints at — the size and the
//! price — set large enough to read at arm's length.
//!
//! The size sits on its own line rather than inside the colour line because a
//! rail is shopped by size: it is the one field a person looks for before
//! deciding to touch the garment at all.
//!
//! Geometry is expressed against one baseline tag — 58 x 40 mm at 203 DPI —
//! that every coordinate below was rendered and checked against. Other tag
//! sizes scale from it, so a second form factor does not mean a second layout
//! to keep in step.
//!
//! # What is inherited and not ours to change
//!
//! The layout is ours; the payloads are not. The escaping and the `^RFW` full
//! form are reproduced from the field-proven Go renderer deliberately: tags
//! already stuck to garments were written by that code, and a reader that
//! disagrees with them reports missing stock rather than a bug.

/// 58 mm at 203 DPI. The width every baseline coordinate below assumes.
const BASELINE_WIDTH_DOTS: i64 = 464;
/// 40 mm at 203 DPI.
const BASELINE_HEIGHT_DOTS: i64 = 320;
const DOTS_PER_MM: f64 = 203.0 / 25.4;

/// The smallest glyph height worth emitting. Below this the text is present in
/// the ZPL and unreadable on the tag, which is worse than absent.
const MIN_FONT_DOTS: i64 = 6;

/// What the shop is called on the tag.
///
/// Carried as a parameter rather than a constant because the legacy lineage
/// disagrees with itself: the current Go renderer prints one name and tags
/// recovered from the field print another. Whoever calls this must state which.
pub struct LabelBrand<'a>(pub &'a str);

/// One label's worth of content, already resolved. Nothing here is looked up
/// at render time — a reprint must reproduce the label that was printed, not
/// the one today's catalogue would produce.
pub struct LabelData<'a> {
    pub sku_code: &'a str,
    pub article_name: &'a str,
    /// What the shopper calls the colour — "Navy", not the digit inside the
    /// SKU. Empty is allowed: the tag simply does not claim a colour, which is
    /// what a run queued before this field existed has to do.
    pub colour_label: &'a str,
    /// The size as it is worn: "L", "XXL", "28". Empty is allowed on the same
    /// terms, and costs the tag the one line a rail is shopped by.
    pub size_label: &'a str,
    /// What the barcode encodes. Not necessarily the SKU: the two lineages
    /// differ, so the caller decides and this renderer prints what it is given.
    pub barcode_payload: &'a str,
    /// Whole rupiah, matching how the till and the receipt render money. Zero
    /// suppresses the price line rather than printing "Rp 0", which reads on a
    /// shop floor as a free garment.
    pub price_minor: i64,
    /// 24 hex characters for EPC-96, 32 for EPC-128. Anything else is not
    /// written to the tag at all — a half-written EPC is an unreadable tag.
    pub epc: &'a str,
    pub copies: u32,
}

/// Physical tag size in millimetres.
#[derive(Clone, Copy)]
pub struct LabelSize {
    pub width_mm: f64,
    pub height_mm: f64,
}

impl Default for LabelSize {
    fn default() -> Self {
        Self {
            width_mm: 58.0,
            height_mm: 40.0,
        }
    }
}

impl LabelSize {
    fn dots(self) -> (i64, i64) {
        (
            scale_round(1, self.width_mm * DOTS_PER_MM),
            scale_round(1, self.height_mm * DOTS_PER_MM),
        )
    }
}

struct Layout {
    w_dots: i64,
    h_dots: i64,
    scale_x: f64,
    scale_y: f64,
}

impl Layout {
    fn resolve(size: LabelSize) -> Self {
        let (w_dots, h_dots) = size.dots();
        Self {
            w_dots,
            h_dots,
            scale_x: w_dots as f64 / BASELINE_WIDTH_DOTS as f64,
            scale_y: h_dots as f64 / BASELINE_HEIGHT_DOTS as f64,
        }
    }

    fn x(&self, base: i64) -> i64 {
        scale_round(base, self.scale_x)
    }

    fn y(&self, base: i64) -> i64 {
        scale_round(base, self.scale_y)
    }

    /// Glyph dimensions scale by the *smaller* axis, so text never overflows the
    /// narrow side of a small tag, and never shrinks below legibility.
    fn font(&self, base: i64) -> i64 {
        let scale = self.scale_x.min(self.scale_y);
        scale_round(base, scale).max(MIN_FONT_DOTS)
    }
}

/// Roughly how wide a string of `chars` glyphs is at height `font`.
///
/// `^A0` is proportional, so this is an estimate and is only ever used to
/// decide where the NEXT field starts — never to centre or right-align, which
/// would turn the estimate's error into visible drift. 0.62 is the ratio
/// measured off rendered output for the sizes this tag uses.
fn text_dots(chars: usize, font: i64) -> i64 {
    (chars as f64 * font as f64 * 0.62 + 0.5) as i64
}

fn scale_round(base: i64, scale: f64) -> i64 {
    let scale = if scale <= 0.0 { 1.0 } else { scale };
    (base as f64 * scale + 0.5) as i64
}

/// Render one label.
///
/// The output is a complete ZPL job: header, fields, RFID write, quantity,
/// footer. It is safe to concatenate several of these onto one printer socket.
pub fn render_label(data: &LabelData<'_>, size: LabelSize, brand: LabelBrand<'_>) -> String {
    let l = Layout::resolve(size);
    let copies = data.copies.max(1);
    let mut out = String::with_capacity(384);

    out.push_str("^XA\n");
    out.push_str(&format!("^PW{}\n", l.w_dots));
    out.push_str(&format!("^LL{}\n", l.h_dots));
    // UTF-8. Indonesian article names carry accented characters, and the
    // default code page renders them as noise.
    out.push_str("^CI28\n");

    // The name of the shop, set as the largest thing on the tag after the
    // price. It shrinks for a long name rather than growing into the SKU
    // beside it: the brand is a parameter, and a tag that renders one shop's
    // name cleanly and overprints another's is worse than one that sets a long
    // name smaller.
    let brand_text = truncate_chars(&escape(brand.0), 18);
    let brand_font = brand_font_dots(brand_text.chars().count());
    out.push_str(&format!(
        "^FO{},{}^A0N,{},{}^FD{}^FS\n",
        l.x(16),
        l.y(14),
        l.font(brand_font),
        l.font(brand_font),
        brand_text
    ));

    // The SKU rides in the top-right corner, small: it is for the person
    // holding a stock list, not for the shopper, and every one of its eleven
    // digits is already under the barcode for anyone who needs to read it.
    out.push_str(&format!(
        "^FO{},{}^A0N,{},{}^FD{}^FS\n",
        l.x(300),
        l.y(28),
        l.font(16),
        l.font(16),
        truncate_chars(&escape(data.sku_code), 16)
    ));

    let name = ellipsize(&escape(data.article_name), 32);
    out.push_str(&format!(
        "^FO{},{}^A0N,{},{}^FD{}^FS\n",
        l.x(16),
        l.y(84),
        l.font(21),
        l.font(21),
        name
    ));

    // Size and colour share a baseline at two weights: the size is what a rail
    // is shopped by, the colour merely confirms what the eye already sees.
    let size_label = truncate_chars(&escape(data.size_label), 6);
    let mut colour_x = l.x(16);
    if !size_label.is_empty() {
        out.push_str(&format!(
            "^FO{},{}^A0N,{},{}^FD{}^FS\n",
            l.x(16),
            l.y(116),
            l.font(44),
            l.font(44),
            size_label
        ));
        colour_x = l.x(16 + text_dots(size_label.chars().count(), 44) + 16);
    }
    let colour_label = ellipsize(&escape(data.colour_label), 18);
    if !colour_label.is_empty() {
        // Sitting on the size's baseline rather than its cap height, so the two
        // read as one line instead of as a heading and a stray word.
        out.push_str(&format!(
            "^FO{},{}^A0N,{},{}^FD{}^FS\n",
            colour_x,
            l.y(134),
            l.font(17),
            l.font(17),
            colour_label
        ));
    }

    if data.price_minor > 0 {
        out.push_str(&format!(
            "^FO{},{}^A0N,{},{}^FDRp {}^FS\n",
            l.x(16),
            l.y(178),
            l.font(48),
            l.font(48),
            format_rupiah(data.price_minor)
        ));
    }

    if !data.barcode_payload.is_empty() {
        // ^BY sets the module width and ratio; ^BC is Code 128 with the human
        // readable line below and no ZPL-computed check digit — the payload is
        // already exactly what should be scanned.
        let bar_height = scale_round(50, l.scale_y);
        out.push_str(&format!(
            "^FO{},{}^BY2,3,{}^BCN,{},Y,N,N^FD{}^FS\n",
            l.x(16),
            l.y(238),
            bar_height,
            bar_height,
            escape(data.barcode_payload)
        ));
    }

    if let Some(epc) = printable_epc(data.epc) {
        // Full form `^RFW,t,b,n,r`: hex, EPC bank, byte count, one retry.
        // The shorthand `^RFW,E` works on modern Zebra Link-OS but is not
        // guaranteed under T6204e ZGL emulation, so it is not used.
        out.push_str(&format!("^RFW,H,1,{},1^FD{}^FS\n", epc.len() / 2, epc));
    }

    // ^PQ<qty>,<pause>,<replicates>,<override>
    out.push_str(&format!("^PQ{copies},0,1,Y\n"));
    out.push_str("^XZ\n");

    out
}

/// How large the shop name may be set before it runs into the SKU beside it.
///
/// The brand block owns the left 260 dots of the top line. Up to eight
/// characters fit there at full size, which is what the name on these tags
/// actually is; anything longer is set down to fit rather than clipped,
/// because a half-printed shop name looks like a printer fault.
fn brand_font_dots(chars: usize) -> i64 {
    const BRAND_WIDTH_DOTS: f64 = 260.0;
    const FULL: i64 = 48;
    if chars <= 8 {
        return FULL;
    }
    let fitted = (BRAND_WIDTH_DOTS / (chars as f64 * 0.62)) as i64;
    fitted.clamp(MIN_FONT_DOTS, FULL)
}

/// What goes on the sticker stuck to the outside of a box.
pub struct KoliLabelData<'a> {
    pub koli_number: &'a str,
    pub destination_store_id: &'a str,
    pub unit_count: i64,
    pub sealed_at: Option<&'a str>,
}

/// Render the koli sticker.
///
/// Deliberately no QR. `^BQ` never appears anywhere in the field-proven Go
/// lineage, so it is not among the commands known to survive the Printronix
/// ZGL emulation, and a sticker that prints as garbage is discovered at the
/// loading bay. Code 128 carries the koli number instead — the same command
/// the garment tags already use. The QR belongs on the packing list, which is
/// printed from a browser where any encoder works.
///
/// No `^RFW` either: a cardboard box is not an RFID tag.
pub fn render_koli_label(
    data: &KoliLabelData<'_>,
    size: LabelSize,
    brand: LabelBrand<'_>,
) -> String {
    let l = Layout::resolve(size);
    let mut out = String::with_capacity(256);

    out.push_str("^XA\n");
    out.push_str(&format!("^PW{}\n", l.w_dots));
    out.push_str(&format!("^LL{}\n", l.h_dots));
    out.push_str("^CI28\n");

    out.push_str(&format!(
        "^FO{},{}^A0N,{},{}^FD{}^FS\n",
        l.x(10),
        l.y(10),
        l.font(14),
        l.font(14),
        escape(brand.0)
    ));

    // The number is the identity of the box, so it is the biggest thing on it:
    // this is what someone reads across a loading bay.
    out.push_str(&format!(
        "^FO{},{}^A0N,{},{}^FD{}^FS\n",
        l.x(10),
        l.y(36),
        l.font(26),
        l.font(26),
        escape(data.koli_number)
    ));

    out.push_str(&format!(
        "^FO{},{}^A0N,{},{}^FD{} - {} pcs^FS\n",
        l.x(10),
        l.y(74),
        l.font(18),
        l.font(18),
        escape(data.destination_store_id),
        data.unit_count
    ));

    let bar_height = scale_round(72, l.scale_y);
    out.push_str(&format!(
        "^FO{},{}^BY2,3,{}^BCN,{},Y,N,N^FD{}^FS\n",
        l.x(30),
        l.y(112),
        bar_height,
        bar_height,
        escape(data.koli_number)
    ));

    out.push_str("^PQ1,0,1,Y\n");
    out.push_str("^XZ\n");
    out
}

/// Strip everything that could end a field and begin a command.
///
/// `^` and `~` introduce ZPL commands; a control character on a raw printer
/// socket can do the same. An article name is operator-supplied text, so it is
/// the obvious way to get arbitrary ZPL onto the printer.
fn escape(value: &str) -> String {
    value
        .chars()
        .filter(|c| *c != '^' && *c != '~' && *c >= ' ' && *c != '\u{7f}')
        .collect()
}

fn truncate_chars(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

/// Shorten to `max` characters, marking that something was cut. Counted in
/// characters, not bytes: cutting a multi-byte name mid-sequence produces a
/// label the printer renders as a replacement glyph.
fn ellipsize(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    let kept: String = value.chars().take(max.saturating_sub(3)).collect();
    format!("{kept}...")
}

/// Indonesian thousands grouping: 89000 becomes "89.000".
fn format_rupiah(amount: i64) -> String {
    let digits = amount.abs().to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    let head = digits.len() % 3;
    if head > 0 {
        grouped.push_str(&digits[..head]);
    }
    let mut index = head;
    while index < digits.len() {
        if index > 0 {
            grouped.push('.');
        }
        grouped.push_str(&digits[index..index + 3]);
        index += 3;
    }
    if amount < 0 {
        format!("-{grouped}")
    } else {
        grouped
    }
}

/// Accept only an EPC the printer can actually write: hexadecimal, and either
/// 96 or 128 bits. Returned uppercase, which is how the tag reads back.
fn printable_epc(epc: &str) -> Option<String> {
    let trimmed = epc.trim();
    if trimmed.len() != 24 && trimmed.len() != 32 {
        return None;
    }
    if !trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(trimmed.to_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample<'a>() -> LabelData<'a> {
        LabelData {
            sku_code: "12345678123",
            article_name: "SB Eric rain pants",
            colour_label: "Navy",
            size_label: "L",
            barcode_payload: "812345678123",
            price_minor: 89_000,
            // The golden EPC from the shared codec: encode("12345678123", 100).
            epc: "a01234567812300000000064",
            copies: 1,
        }
    }

    #[test]
    fn a_baseline_tag_renders_the_layout_the_field_printers_were_tuned_against() {
        let zpl = render_label(&sample(), LabelSize::default(), LabelBrand("CENTRAL"));
        let expected = concat!(
            "^XA\n",
            "^PW464\n",
            "^LL320\n",
            "^CI28\n",
            "^FO16,14^A0N,48,48^FDCENTRAL^FS\n",
            "^FO300,28^A0N,16,16^FD12345678123^FS\n",
            "^FO16,84^A0N,21,21^FDSB Eric rain pants^FS\n",
            "^FO16,116^A0N,44,44^FDL^FS\n",
            "^FO59,134^A0N,17,17^FDNavy^FS\n",
            "^FO16,178^A0N,48,48^FDRp 89.000^FS\n",
            "^FO16,238^BY2,3,50^BCN,50,Y,N,N^FD812345678123^FS\n",
            "^RFW,H,1,12,1^FDA01234567812300000000064^FS\n",
            "^PQ1,0,1,Y\n",
            "^XZ\n",
        );
        assert_eq!(zpl, expected);
    }

    #[test]
    fn the_colour_starts_after_the_size_however_long_the_size_is() {
        let mut data = sample();
        data.size_label = "XXL";
        let zpl = render_label(&data, LabelSize::default(), LabelBrand("CENTRAL"));
        assert!(zpl.contains("^FO16,116^A0N,44,44^FDXXL^FS"), "{zpl}");
        assert!(zpl.contains("^FO114,134^A0N,17,17^FDNavy^FS"), "{zpl}");
    }

    #[test]
    fn a_run_queued_before_the_tag_knew_its_size_still_prints() {
        // The columns are nullable and labels queued before they existed have
        // neither. The tag loses a line rather than printing an empty one, and
        // the colour slides back to the margin instead of floating in from
        // where the size would have ended.
        let mut data = sample();
        data.size_label = "";
        data.colour_label = "";
        let zpl = render_label(&data, LabelSize::default(), LabelBrand("CENTRAL"));
        assert!(!zpl.contains("^A0N,44,44"), "{zpl}");
        assert!(!zpl.contains(",134^A0N"), "{zpl}");

        data.colour_label = "Navy";
        let zpl = render_label(&data, LabelSize::default(), LabelBrand("CENTRAL"));
        assert!(zpl.contains("^FO16,134^A0N,17,17^FDNavy^FS"), "{zpl}");
    }

    #[test]
    fn a_long_shop_name_is_set_smaller_rather_than_printed_over_the_sku() {
        let zpl = render_label(
            &sample(),
            LabelSize::default(),
            LabelBrand("Wira Makmur Sentosa"),
        );
        let brand = zpl
            .lines()
            .find(|line| line.contains("Wira Makmur"))
            .unwrap_or_else(|| panic!("no brand line in {zpl}"));
        // Truncated to the 18 characters the block can hold, and set down from
        // 48 so that what remains ends before the SKU at x=300.
        assert!(brand.contains("^FDWira Makmur Sentos^FS"), "{brand}");
        assert!(brand.contains("^A0N,23,23"), "{brand}");
    }

    #[test]
    fn an_article_name_cannot_smuggle_a_command_onto_the_printer_socket() {
        let mut data = sample();
        data.article_name = "Jacket^XZ~JA\nDELETE";
        let zpl = render_label(&data, LabelSize::default(), LabelBrand("CENTRAL"));

        // One job in, one job out: the injected terminator must not have
        // created a second ^XZ or a second ^XA.
        assert_eq!(zpl.matches("^XZ").count(), 1);
        assert_eq!(zpl.matches("^XA").count(), 1);
        assert!(zpl.contains("^FDJacketXZJADELETE^FS"), "{zpl}");
    }

    #[test]
    fn a_malformed_epc_is_left_off_the_tag_rather_than_half_written() {
        for bad in ["", "A0123", "not-hexadecimal-at-all-xx", &"A".repeat(25)] {
            let mut data = sample();
            data.epc = bad;
            let zpl = render_label(&data, LabelSize::default(), LabelBrand("CENTRAL"));
            assert!(!zpl.contains("^RFW"), "unexpected RFID write for {bad:?}");
        }
    }

    #[test]
    fn a_128_bit_epc_asks_the_printer_for_sixteen_bytes() {
        let mut data = sample();
        let epc = "A0".repeat(16);
        data.epc = &epc;
        let zpl = render_label(&data, LabelSize::default(), LabelBrand("CENTRAL"));
        assert!(zpl.contains("^RFW,H,1,16,1^FD"));
    }

    #[test]
    fn a_free_garment_is_never_printed() {
        let mut data = sample();
        data.price_minor = 0;
        let zpl = render_label(&data, LabelSize::default(), LabelBrand("CENTRAL"));
        assert!(!zpl.contains("Rp"));
    }

    #[test]
    fn rupiah_groups_in_threes_from_the_right() {
        assert_eq!(format_rupiah(0), "0");
        assert_eq!(format_rupiah(999), "999");
        assert_eq!(format_rupiah(1_000), "1.000");
        assert_eq!(format_rupiah(89_000), "89.000");
        assert_eq!(format_rupiah(1_250_000), "1.250.000");
    }

    #[test]
    fn a_smaller_tag_scales_the_layout_instead_of_overflowing_it() {
        let small = LabelSize {
            width_mm: 40.0,
            height_mm: 30.0,
        };
        let zpl = render_label(&sample(), small, LabelBrand("CENTRAL"));
        assert!(zpl.contains("^PW320\n"), "{zpl}");
        assert!(zpl.contains("^LL240\n"), "{zpl}");
        // Glyphs follow the narrower axis: the brand line shrinks with the tag.
        assert!(zpl.contains("^FO11,11^A0N,33,33^FDCENTRAL^FS"), "{zpl}");
    }

    #[test]
    fn a_long_article_name_is_cut_with_a_visible_mark() {
        let mut data = sample();
        data.article_name = "Kemeja lengan panjang katun premium warna biru tua";
        let zpl = render_label(&data, LabelSize::default(), LabelBrand("CENTRAL"));
        assert!(zpl.contains("Kemeja lengan panjang katun p...^FS"), "{zpl}");
    }

    #[test]
    fn a_koli_sticker_leads_with_the_number_and_carries_no_rfid_write() {
        let zpl = render_koli_label(
            &KoliLabelData {
                koli_number: "KOLI-dc-01-000901",
                destination_store_id: "toko-a",
                unit_count: 40,
                sealed_at: None,
            },
            LabelSize::default(),
            LabelBrand("CENTRAL"),
        );
        assert!(
            zpl.contains("^FO10,36^A0N,26,26^FDKOLI-dc-01-000901^FS"),
            "{zpl}"
        );
        assert!(zpl.contains("^FDtoko-a - 40 pcs^FS"), "{zpl}");
        // Code 128 only: ^BQ is not known to survive the ZGL emulation.
        assert!(zpl.contains("^BCN,"), "{zpl}");
        assert!(!zpl.contains("^BQ"), "{zpl}");
        // A cardboard box carries no tag to encode.
        assert!(!zpl.contains("^RFW"), "{zpl}");
    }

    #[test]
    fn a_koli_number_cannot_smuggle_a_command_either() {
        let zpl = render_koli_label(
            &KoliLabelData {
                koli_number: "KOLI^XZ~JA",
                destination_store_id: "toko-a",
                unit_count: 1,
                sealed_at: None,
            },
            LabelSize::default(),
            LabelBrand("CENTRAL"),
        );
        assert_eq!(zpl.matches("^XZ").count(), 1, "{zpl}");
    }
}
