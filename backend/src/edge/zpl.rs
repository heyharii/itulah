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
    /// How far the label sits from the left edge of what the print head sweeps.
    ///
    /// A reel is not all label. The die-cut tag sits on a liner, and on RFID
    /// stock it is usually inset — so ink placed at x=0 lands on the backing
    /// paper and the tag comes out with its left column missing. This shifts
    /// everything the printer draws by that much; it does NOT change the
    /// layout, and the preview does not shift, because the tag is unchanged.
    /// It is where the tag IS, not what it looks like.
    pub left_offset_mm: f64,
}

impl Default for LabelSize {
    /// The stock in the machine, which is not `BASELINE_*` above: those are the
    /// ruler every coordinate is expressed against, this is what the warehouse
    /// buys. They were the same number until the reel changed.
    fn default() -> Self {
        Self {
            width_mm: 50.0,
            height_mm: 30.0,
            left_offset_mm: 0.0,
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

// ---------------------------------------------------------------------------
// The sheet: one description of a label, two ways of drawing it
// ---------------------------------------------------------------------------

/// One thing placed on the tag, in tag coordinates — dots from the top-left.
///
/// The layout functions below produce these and nothing else. Whether a label
/// then becomes ZPL on a printer socket or SVG on a screen is decided
/// afterwards, by which emitter is asked for it. That indirection exists for
/// exactly one reason: a preview drawn by a second, parallel layout would
/// agree with the printer on every ordinary day and part company on the day
/// somebody moves a field — and a preview that is allowed to drift is worse
/// than no preview at all, because somebody will trust it and print four
/// hundred tags.
#[derive(Debug)]
enum Mark {
    /// `^A0N` proportional text. `font` is the character cell height in dots,
    /// which the tag also passes as the width: nothing here is condensed.
    Text {
        x: i64,
        y: i64,
        font: i64,
        text: String,
    },
    /// Text the PRINTER right-aligns inside a block, rather than text this
    /// code placed by guessing how wide it would be.
    ///
    /// `x` is where the block starts and `width` how far it runs; the glyphs
    /// end at `x + width` whatever they spell. That matters because the width
    /// estimate this file uses elsewhere is measured at 0.62 of the cell and
    /// is honest about being an estimate — good enough to decide where the
    /// next field starts, not good enough to sit a price against an edge,
    /// where every millimetre of error is visible against the die cut.
    RightText {
        x: i64,
        y: i64,
        width: i64,
        font: i64,
        text: String,
    },
    /// Code 128 with its human readable line underneath.
    Barcode {
        x: i64,
        y: i64,
        /// The bars only. The readable line sits below this and is extra.
        height: i64,
        /// `^BY`'s narrow bar, in dots, chosen so the symbol fits the tag.
        module: i64,
        /// What the preview draws the readable line at. The printer uses its
        /// own default instead, so this is the one number on a sheet that is
        /// an estimate rather than an instruction — it is here because the
        /// line takes vertical space, and a barcode whose text falls off the
        /// bottom of the tag is a thing worth seeing before the ribbon runs.
        hri_font: i64,
        payload: String,
    },
    /// The EPC write. Not ink: it has no position and leaves no mark on the
    /// paper. It rides on the sheet anyway so that one value describes
    /// everything a label carries, and the ZPL emitter is the only thing that
    /// has to know it goes last.
    Rfid { hex: String },
}

/// One label, laid out and not yet drawn.
struct Sheet {
    w_dots: i64,
    h_dots: i64,
    /// Where the printer starts drawing. Only the two printer emitters read
    /// it: the screen draws the tag, and the tag does not move.
    offset_dots: i64,
    copies: u32,
    marks: Vec<Mark>,
}

/// Where the baseline of `^A0` text sits below its `^FO` point, as a fraction
/// of the character cell. `^FO` places the top-left of the cell; SVG places a
/// baseline. Measured off rendered output, like the 0.62 width ratio above,
/// and used only by the preview — the printer is told the corner, never the
/// baseline.
const BASELINE_RATIO: f64 = 0.78;

/// `^BY2`: the module width every barcode on these tags is set at.
const BARCODE_MODULE_DOTS: i64 = 2;

impl Sheet {
    /// The printer's copy. This is the format the field-proven Go lineage
    /// emitted and the tags already stuck to garments were written by, so the
    /// ordering and spelling here are reproduced rather than chosen.
    fn to_zpl(&self) -> String {
        let mut out = String::with_capacity(384);
        out.push_str("^XA\n");
        out.push_str(&format!("^PW{}\n", self.w_dots));
        out.push_str(&format!("^LL{}\n", self.h_dots));
        // UTF-8. Indonesian article names carry accented characters, and the
        // default code page renders them as noise.
        out.push_str("^CI28\n");
        // `^LH` moves the origin every `^FO` below is measured from. Written
        // even when it is nought: a printer remembers the last one it was
        // given, and a run that leaves it unsaid inherits whatever the
        // previous job set.
        out.push_str(&format!("^LH{},0\n", self.offset_dots));

        for mark in &self.marks {
            match mark {
                Mark::Text { x, y, font, text } => {
                    out.push_str(&format!("^FO{x},{y}^A0N,{font},{font}^FD{text}^FS\n"))
                }
                // `^FB<width>,1,0,R,0`: one line, no extra leading, right
                // justified inside the block that follows `^FO`.
                Mark::RightText {
                    x,
                    y,
                    width,
                    font,
                    text,
                } => out.push_str(&format!(
                    "^FO{x},{y}^FB{width},1,0,R,0^A0N,{font},{font}^FD{text}^FS\n"
                )),
                // ^BY sets the module width and ratio; ^BC is Code 128 with
                // the human readable line below and no ZPL-computed check
                // digit — the payload is already exactly what should be
                // scanned.
                Mark::Barcode {
                    x,
                    y,
                    height,
                    module,
                    payload,
                    ..
                } => out.push_str(&format!(
                    "^FO{x},{y}^BY{module},3,{height}^BCN,{height},Y,N,N^FD{payload}^FS\n"
                )),
                // Full form `^RFW,t,b,n,r`: hex, EPC bank, byte count, one
                // retry. The shorthand `^RFW,E` works on modern Zebra Link-OS
                // but is not guaranteed under ZGL emulation, so it is not used.
                //
                // THE PAYLOAD LEADS WITH THE PC WORD, and that is not a
                // detail. Bank 1 does not begin at the EPC: word 0 is the CRC
                // and word 1 is the Protocol Control word, which declares how
                // long the EPC is. This printer starts writing at word 0, so a
                // payload of bare EPC lands one word early — the first four
                // hex characters are eaten by the PC word and the tag reads
                // back short, padded with zeroes at the tail.
                //
                // Measured, not assumed: sending 24 hex read back as 20 of
                // ours plus `0000`; sending 28 read back as 24. Prefixing the
                // PC word read back exactly what was sent.
                Mark::Rfid { hex } => out.push_str(&format!(
                    "^RFW,H,1,{},1^FD{}{hex}^FS\n",
                    hex.len() / 2 + PC_WORD_BYTES,
                    protocol_control_word(hex)
                )),
            }
        }

        // ^PQ<qty>,<pause>,<replicates>,<override>
        out.push_str(&format!("^PQ{},0,1,Y\n", self.copies));
        out.push_str("^XZ\n");
        out
    }

    /// The same label for a TSC printer speaking its own language.
    ///
    /// Not a second layout. Every coordinate, glyph height and bar width below
    /// is the one `to_zpl` emits, because both read the same `Mark`s — which is
    /// the whole reason the marks exist. A TSPL renderer that laid the tag out
    /// again would agree with the ZPL one until somebody moved a field.
    ///
    /// TSPL puts its origin at the top-left in dots, as ZPL does, and its
    /// scalable font `"0"` takes the character cell width and height in dots —
    /// so `Mark::Text` carries over unchanged rather than being rescaled.
    ///
    /// `GAP` is the one thing here that is about the stock rather than the
    /// design: 2 mm is the ordinary die-cut gap, and a reel with a black mark
    /// instead needs `BLINE`. It is stated rather than defaulted because a
    /// wrong gap does not misprint one tag, it walks the whole reel.
    fn to_tspl(&self) -> String {
        let mut out = String::with_capacity(384);
        out.push_str(&format!(
            "SIZE {:.0} mm,{:.0} mm\n",
            self.w_dots as f64 / DOTS_PER_MM,
            self.h_dots as f64 / DOTS_PER_MM
        ));
        out.push_str("GAP 2 mm,0 mm\n");
        out.push_str("DIRECTION 1\n");
        // UTF-8, for the same reason `^CI28` is set on the ZPL side.
        out.push_str("CODEPAGE UTF-8\n");
        // TSPL's own origin shift, and stated for the same reason `^LH` is.
        out.push_str(&format!("REFERENCE {},0\n", self.offset_dots));
        out.push_str("CLS\n");

        for mark in &self.marks {
            match mark {
                Mark::Text { x, y, font, text } => out.push_str(&format!(
                    "TEXT {x},{y},\"0\",0,{font},{font},\"{}\"\n",
                    tspl_quoted(text)
                )),
                // TSPL has no field block, so the right edge is reached by
                // placing the string — the estimate is unavoidable here and
                // is at least confined to one printer language.
                Mark::RightText {
                    x,
                    y,
                    width,
                    font,
                    text,
                } => {
                    let placed = (x + width - text_dots(text.chars().count(), *font)).max(*x);
                    out.push_str(&format!(
                        "TEXT {placed},{y},\"0\",0,{font},{font},\"{}\"\n",
                        tspl_quoted(text)
                    ))
                }
                // `BARCODE x,y,"128",height,human,rotation,narrow,wide,"data"`.
                // Human readable on, rotation zero, and the same module width
                // the ZPL emitter passes to `^BY`; TSPL takes the wide bar
                // explicitly, so the 3:1 ratio `^BY` is given is written out.
                Mark::Barcode {
                    x,
                    y,
                    height,
                    module,
                    payload,
                    ..
                } => out.push_str(&format!(
                    "BARCODE {x},{y},\"128\",{height},1,0,{module},{},\"{}\"\n",
                    module * 3,
                    tspl_quoted(payload)
                )),
                // The PC word question has NOT been put to a printer in
                // TSPL mode. `RFWRITE` names its start block explicitly, so it
                // may well address the EPC directly and need no prefix — but
                // that is a guess, and the ZPL side is what the field runs.
                Mark::Rfid { hex } => out.push_str(&rfid_write_tspl(hex)),
            }
        }

        // `PRINT <sets>,<copies per set>`.
        out.push_str(&format!("PRINT 1,{}\n", self.copies));
        out
    }

    /// The screen's copy: the same marks, drawn as a picture of the paper.
    ///
    /// White paper and black ink in both light and dark themes, because that
    /// is what the operator is about to hold. A preview that inverted itself
    /// with the interface would be a picture of a screen, not of a tag.
    ///
    /// What this is exact about is geometry: every position, every glyph
    /// height and the barcode's true footprint are the numbers the printer
    /// gets, so a field that overflows here overflows there. What it
    /// approximates is the shape of the glyphs — the printer's `^A0` is a
    /// proportional font this browser does not have — and the bars, which are
    /// drawn as the block they will occupy rather than encoded. This file is
    /// not an encoder, and a barcode it invented would be a barcode nothing
    /// guarantees the printer agrees with.
    fn to_svg(&self) -> String {
        let (w, h) = (self.w_dots, self.h_dots);
        let mut out = String::with_capacity(1024);
        out.push_str(&format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" \
             preserveAspectRatio=\"xMidYMid meet\" role=\"img\">\
             <title>Label preview</title>\
             <rect width=\"{w}\" height=\"{h}\" fill=\"#ffffff\"/>"
        ));

        for mark in &self.marks {
            match mark {
                Mark::RightText {
                    x,
                    y,
                    width,
                    font,
                    text,
                } => {
                    let baseline = *y as f64 + *font as f64 * BASELINE_RATIO;
                    let edge = x + width;
                    out.push_str(&format!(
                        "<text x=\"{edge}\" y=\"{baseline:.1}\" font-size=\"{font}\" \
                         text-anchor=\"end\" \
                         font-family=\"Helvetica Neue,Helvetica,Arial,sans-serif\" \
                         fill=\"#111111\" xml:space=\"preserve\">{}</text>",
                        xml(text)
                    ));
                }
                Mark::Text { x, y, font, text } => {
                    let baseline = *y as f64 + *font as f64 * BASELINE_RATIO;
                    out.push_str(&format!(
                        "<text x=\"{x}\" y=\"{baseline:.1}\" font-size=\"{font}\" \
                         font-family=\"Helvetica Neue,Helvetica,Arial,sans-serif\" \
                         fill=\"#111111\" xml:space=\"preserve\">{}</text>",
                        xml(text)
                    ));
                }
                Mark::Barcode {
                    x,
                    y,
                    height,
                    module,
                    hri_font,
                    payload,
                } => {
                    let width = code128_dots(payload.chars().count(), *module);
                    out.push_str(&format!(
                        "<rect x=\"{x}\" y=\"{y}\" width=\"{width}\" height=\"{height}\" \
                         fill=\"#e8e8e8\"/>"
                    ));
                    // Said in words inside the block, so nobody mistakes a
                    // placeholder for something their scanner should read.
                    let caption = (*height as f64 * 0.34) as i64;
                    out.push_str(&format!(
                        "<text x=\"{}\" y=\"{:.1}\" font-size=\"{caption}\" \
                         font-family=\"Helvetica Neue,Helvetica,Arial,sans-serif\" \
                         fill=\"#9a9a9a\" text-anchor=\"middle\">CODE 128</text>",
                        x + width / 2,
                        *y as f64 + *height as f64 / 2.0 + caption as f64 * 0.36
                    ));
                    // The readable line the printer puts under the bars,
                    // centred on the symbol the same way ^BC centres it.
                    let baseline = (y + height) as f64 + *hri_font as f64 * (1.0 + BASELINE_RATIO);
                    out.push_str(&format!(
                        "<text x=\"{}\" y=\"{baseline:.1}\" font-size=\"{hri_font}\" \
                         font-family=\"Helvetica Neue,Helvetica,Arial,sans-serif\" \
                         fill=\"#111111\" text-anchor=\"middle\">{}</text>",
                        x + width / 2,
                        xml(payload)
                    ));
                }
                // Nothing to draw. The EPC is reported beside the picture, not
                // printed on it.
                Mark::Rfid { .. } => {}
            }
        }

        out.push_str("</svg>");
        out
    }
}

/// How wide a Code 128 symbol is, in dots.
///
/// Eleven modules for the start character, eleven for each character of the
/// payload, eleven for the checksum and thirteen for the stop bar. The count
/// is fixed by the symbology, so this can be known without encoding anything.
///
/// It is an upper bound, and deliberately so: a run of digits encodes two to a
/// symbol in subset C, which the printer will use and this does not model.
/// Erring wide is the safe direction for both jobs this serves — a barcode
/// drawn wider than it prints never hides an overflow, and a module chosen
/// against a wider estimate never produces one.
fn code128_dots(chars: usize, module: i64) -> i64 {
    (11 * (chars as i64 + 2) + 13) * module
}

/// The widest narrow-bar the symbol can use and still land on the tag.
///
/// `^BY` is in dots and follows nothing: every coordinate and glyph on this
/// label scales with the stock, and the barcode alone kept the width it had on
/// a 58 mm tag. On a 40 mm one that is 334 dots of barcode across 320 dots of
/// paper, and on the koli sticker a seventeen-character number overflowed at
/// the DEFAULT size — the last characters are simply not printed, and Code 128
/// carries a stop bar and a checksum, so what comes back from the scanner is
/// not a truncated number but silence.
///
/// Scanners prefer a wide module, so this takes the widest that fits rather
/// than shrinking in proportion, and never goes below one dot: at that point
/// the payload is too long for the stock, and a hairline barcode and a clipped
/// one are equally unreadable — but the hairline one at least reads close up.
fn barcode_module(chars: usize, x: i64, w_dots: i64, scale_x: f64) -> i64 {
    // The same margin on the right as the layout left on the left.
    let room = w_dots - x * 2;
    let ideal = scale_round(BARCODE_MODULE_DOTS, scale_x).max(1);
    (1..=ideal)
        .rev()
        .find(|module| code128_dots(chars, *module) <= room)
        .unwrap_or(1)
}

/// Escape for the preview's XML.
///
/// A different job from `escape` above and neither substitutes for the other:
/// that one keeps an article name from ending a ZPL field and starting a
/// command, this one keeps the same name from closing a `<text>` element in a
/// document the browser is about to parse. The strings that reach here have
/// already been through the first, which does not touch a single character
/// this one cares about.
fn xml(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            other => out.push(other),
        }
    }
    out
}

/// Place one hang tag.
///
/// The output is a complete description of the label: header geometry, every
/// field, the RFID write, and how many copies. Nothing below decides how it is
/// drawn.
/// The margin every field on the tag starts at, in baseline dots.
const MARGIN: i64 = 16;

/// A tag too short to scale the main layout down onto.
///
/// Below this the 58x40 column stops being a small version of itself and
/// starts being unreadable: the brand line lands under the font floor, the
/// barcode eats a third of the height, and the size in the corner runs off the
/// edge. 24 mm is where that was measured, not guessed — a 45x18 reel is the
/// stock this exists for.
const SHORT_TAG_MM: f64 = 24.0;

/// The hang tag for a short reel, laid out in its own dots.
///
/// Not a scaled 58x40. Four bands instead of five, and the corner belongs to
/// the PRICE rather than the size, because on a tag this small there is one
/// corner and the price is what the shopper reaches for — the size still rides
/// the colour line, where it is legible at this height and the corner is not.
///
/// Every number here is dots on THIS tag, not a baseline scaled twice. A
/// second scaling is how the brand line ended up at seven dots high.
fn lay_out_short_label(data: &LabelData<'_>, size: LabelSize, brand: LabelBrand<'_>) -> Sheet {
    let (w_dots, h_dots) = size.dots();
    // Not the same margin either side, and that is the reel rather than the
    // design: the die cut sits a little right of where the head starts, so an
    // even margin prints as an uneven one. Measured against printed tags, not
    // chosen — 34 and 12 is what came out square on the stock this exists for.
    //
    // Measured, which is why the reel's own inset is NOT added on top and this
    // sheet sets `^LH0`: 34 dots is already where the head has to start for
    // this stock to come out square. Applying the offset as well moved every
    // band 2 mm right of the tag that was approved, and shrank the room the
    // bars are fitted into until they dropped a module width.
    let left = 34;
    let right = (w_dots - 12).max(left + 40);
    let font = 18;
    let mut marks = Vec::with_capacity(6);

    // Band one: whose it is, and what it costs.
    marks.push(Mark::Text {
        x: left,
        y: 18,
        font,
        text: truncate_chars(&escape(brand.0), 14),
    });
    if data.price_minor > 0 {
        marks.push(Mark::RightText {
            x: left,
            y: 18,
            width: right - left,
            font,
            text: format!("Rp {}", format_rupiah(data.price_minor)),
        });
    }

    // Band two: what it is, and what it comes in.
    //
    // Two different facts sharing a line, the way colour and size share one on
    // the tall tag — at 18 mm a band costs more than it is worth, and the one
    // this frees goes to the bars.
    let size_label = match escape(data.size_label).trim() {
        "One Size" | "No Size" => String::new(),
        other => truncate_chars(other, 6),
    };
    let colour = ellipsize(&escape(data.colour_label), 14);
    let variant = match (colour.as_str(), size_label.as_str()) {
        ("", "") => String::new(),
        ("", s) => s.to_string(),
        (c, "") => c.to_string(),
        (c, s) => format!("{c} \u{00b7} {s}"),
    };
    let name_room = (right - left) - text_dots(variant.chars().count(), font) - 10;
    let mut name = ellipsize(&escape(data.article_name), 26);
    while !name.is_empty() && text_dots(name.chars().count(), font) > name_room.max(40) {
        name.pop();
    }
    marks.push(Mark::Text {
        x: left,
        y: 44,
        font,
        text: name,
    });
    if !variant.is_empty() {
        marks.push(Mark::RightText {
            x: left,
            y: 44,
            width: right - left,
            font,
            text: variant,
        });
    }

    // Band three: the bars, starting where the words start.
    //
    // Left-aligned at the text margin and fixed at `^BY2`, both measured off
    // the tag that was approved rather than derived. Fitting the module to the
    // room between the margins is what the tall tag does, and on 45 mm stock
    // an eleven-character symbol is 312 dots against 314 of room — two dots
    // over, so the fitter stepped down to `^BY1` and printed a hairline
    // barcode half the width, floating in the middle of the tag. The bars are
    // allowed past the right TEXT margin; what they may not pass is paper.
    let barcode_payload = escape(data.barcode_payload);
    if !barcode_payload.is_empty() {
        let chars = barcode_payload.chars().count();
        let module = (1..=BARCODE_MODULE_DOTS)
            .rev()
            .find(|module| left + code128_dots(chars, *module) <= w_dots)
            .unwrap_or(1);
        marks.push(Mark::Barcode {
            x: left,
            y: 75,
            height: 26,
            module,
            hri_font: font,
            payload: barcode_payload,
        });
    }

    if let Some(hex) = printable_epc(data.epc) {
        marks.push(Mark::Rfid { hex });
    }

    Sheet {
        w_dots,
        h_dots,
        offset_dots: 0,
        copies: data.copies.max(1),
        marks,
    }
}

fn lay_out_label(data: &LabelData<'_>, size: LabelSize, brand: LabelBrand<'_>) -> Sheet {
    let l = Layout::resolve(size);
    if size.height_mm < SHORT_TAG_MM {
        return lay_out_short_label(data, size, brand);
    }
    let mut marks = Vec::with_capacity(7);

    // The shop's name, and the SMALLEST thing on the tag.
    //
    // It used to be the largest after the price, which is backwards on a rail
    // where every tag says the same word: the one line nobody needs to read
    // was taking the space the ones they do need were fighting over. Fixed
    // rather than fitted now — at this size even an eighteen-character name
    // clears the column, so the shrink-to-fit the brand font did has nothing
    // left to solve.
    marks.push(Mark::Text {
        x: l.x(MARGIN),
        y: l.y(8),
        font: l.font(17),
        text: truncate_chars(&escape(brand.0), 18),
    });

    marks.push(Mark::Text {
        x: l.x(MARGIN),
        y: l.y(32),
        font: l.font(25),
        text: ellipsize(&escape(data.article_name), 32),
    });

    // Colour and size on ONE line, joined by a middle dot.
    //
    // They were two fields at two weights sharing a baseline, which spent the
    // width of a 44-dot size and bought nothing. The size still gets its own
    // large setting in the corner — this line is what survives when the corner
    // is under a thumb.
    let colour_label = ellipsize(&escape(data.colour_label), 18);
    // A garment that comes in one size has no size to print.
    //
    // `One Size` and `No Size` are how the master spells "this does not vary",
    // and a tag is read at arm's length off a rail: the corner is for the word
    // somebody is hunting for, and here there is nothing to hunt. Printed, it
    // was worse than useless — the corner is set at 64 dots for one or two
    // characters, so eight of them ran off the edge and came out as `One Si`.
    let size_label = match escape(data.size_label).trim() {
        "One Size" | "No Size" => String::new(),
        other => truncate_chars(other, 6),
    };
    let colour_size = match (colour_label.as_str(), size_label.as_str()) {
        ("", "") => String::new(),
        ("", size) => size.to_string(),
        (colour, "") => colour.to_string(),
        (colour, size) => format!("{colour} \u{00b7} {size}"),
    };
    if !colour_size.is_empty() {
        marks.push(Mark::Text {
            x: l.x(MARGIN),
            y: l.y(64),
            font: l.font(20),
            text: colour_size,
        });
    }

    if data.price_minor > 0 {
        marks.push(Mark::Text {
            x: l.x(MARGIN),
            y: l.y(99),
            font: l.font(43),
            text: format!("Rp {}", format_rupiah(data.price_minor)),
        });
    }

    // The size again, alone in the corner and the biggest thing on the tag.
    //
    // This corner used to hold the SKU in eleven small digits — a number
    // already printed under the barcode — set exactly where the one glance a
    // person makes while pulling a garment off a rail lands. Size is what that
    // glance is looking for.
    if !size_label.is_empty() {
        marks.push(Mark::Text {
            x: l.x(318),
            y: l.y(11),
            font: l.font(64),
            text: size_label.clone(),
        });
    }

    let barcode_payload = escape(data.barcode_payload);
    if !barcode_payload.is_empty() {
        marks.push(Mark::Barcode {
            x: l.x(MARGIN),
            y: l.y(157),
            height: scale_round(117, l.scale_y),
            module: barcode_module(
                barcode_payload.chars().count(),
                l.x(MARGIN),
                l.w_dots,
                l.scale_x,
            ),
            hri_font: l.font(24),
            payload: barcode_payload,
        });
    }

    if let Some(hex) = printable_epc(data.epc) {
        marks.push(Mark::Rfid { hex });
    }

    Sheet {
        w_dots: l.w_dots,
        h_dots: l.h_dots,
        offset_dots: scale_round(1, size.left_offset_mm.max(0.0) * DOTS_PER_MM),
        copies: data.copies.max(1),
        marks,
    }
}

/// Render one label.
///
/// The output is a complete ZPL job: header, fields, RFID write, quantity,
/// footer. It is safe to concatenate several of these onto one printer socket.
/// The two settings that belong to the machine, not to the label.
///
/// Darkness and speed describe the ribbon, the stock and the head — things
/// that change when somebody loads a reel, and never because of what is being
/// printed. So they go out ONCE per pass, ahead of the labels, rather than
/// riding every format: a printer told the same thing forty times is forty
/// chances for one of them to land mid-feed.
///
/// Absent means silence. This node cannot read the machine's stored values back
/// over a one-way queue, so a bench that has not chosen keeps whatever it was
/// calibrated to rather than being overwritten by a default nobody picked.
///
/// `~SD` is an immediate command and persists in the printer; `^PR` is a format
/// command, so it needs a format of its own to travel in. On a TSC pretending
/// to be a Zebra both are accepted — whether both are HONOURED is a separate
/// question, and the only way to see what the machine settled on is to make it
/// print its configuration label.
pub fn machine_prelude(
    language: PrinterLanguage,
    darkness: Option<i64>,
    speed_ips: Option<i64>,
) -> String {
    let mut out = String::new();
    match language {
        PrinterLanguage::Zpl => {
            if let Some(value) = darkness {
                out.push_str(&format!("~SD{value:02}\n"));
            }
            if let Some(value) = speed_ips {
                out.push_str(&format!("^XA^PR{value},{value},{value}^XZ\n"));
            }
        }
        PrinterLanguage::Tspl => {
            // TSPL counts density 0-15 against ZPL's 0-30, so the figure the
            // bench typed is halved rather than sent through a scale it does
            // not share. One number on the screen, two machines that mean
            // different things by it.
            if let Some(value) = darkness {
                out.push_str(&format!("DENSITY {}\r\n", (value / 2).clamp(0, 15)));
            }
            if let Some(value) = speed_ips {
                out.push_str(&format!("SPEED {value}\r\n"));
            }
        }
    }
    out
}

pub fn render_label(data: &LabelData<'_>, size: LabelSize, brand: LabelBrand<'_>) -> String {
    render_label_in(data, size, brand, PrinterLanguage::Zpl)
}

/// The same label, in whichever language the bench's printer speaks.
///
/// One layout, two emitters. The preview on the screen is drawn from the same
/// marks again, so a TSC bench sees the tag it is about to print rather than a
/// picture of what a Zebra would have done.
pub fn render_label_in(
    data: &LabelData<'_>,
    size: LabelSize,
    brand: LabelBrand<'_>,
    language: PrinterLanguage,
) -> String {
    let sheet = lay_out_label(data, size, brand);
    match language {
        PrinterLanguage::Zpl => sheet.to_zpl(),
        PrinterLanguage::Tspl => sheet.to_tspl(),
    }
}

/// The same label, drawn for a screen.
///
/// Returned as a standalone SVG document with a `viewBox` and no fixed size,
/// so whatever shows it decides how big the picture is while the tag keeps its
/// true proportions.
pub fn preview_label(data: &LabelData<'_>, size: LabelSize, brand: LabelBrand<'_>) -> String {
    lay_out_label(data, size, brand).to_svg()
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
    /// What is printed for the destination. Callers pass the shop's display
    /// code as head office gave it (`C007-TOKO`, `edge::site_profile`), not
    /// its internal id; the field keeps its old name so the layout code and
    /// its tests are untouched.
    pub destination_store_id: &'a str,
    pub unit_count: i64,
    pub sealed_at: Option<&'a str>,
}

/// Place the koli sticker.
///
/// Deliberately no QR. `^BQ` never appears anywhere in the field-proven Go
/// lineage, so it is not among the commands known to survive the Printronix
/// ZGL emulation, and a sticker that prints as garbage is discovered at the
/// loading bay. Code 128 carries the koli number instead — the same command
/// the garment tags already use. The QR belongs on the packing list, which is
/// printed from a browser where any encoder works.
///
/// No RFID write either: a cardboard box is not an RFID tag.
fn lay_out_koli(data: &KoliLabelData<'_>, size: LabelSize, brand: LabelBrand<'_>) -> Sheet {
    let l = Layout::resolve(size);
    let mut marks = Vec::with_capacity(4);

    marks.push(Mark::Text {
        x: l.x(10),
        y: l.y(10),
        font: l.font(14),
        text: escape(brand.0),
    });

    // The number is the identity of the box, so it is the biggest thing on it:
    // this is what someone reads across a loading bay.
    marks.push(Mark::Text {
        x: l.x(10),
        y: l.y(36),
        font: l.font(26),
        text: escape(data.koli_number),
    });

    marks.push(Mark::Text {
        x: l.x(10),
        y: l.y(74),
        font: l.font(18),
        text: format!(
            "{} - {} pcs",
            escape(data.destination_store_id),
            data.unit_count
        ),
    });

    let koli_number = escape(data.koli_number);
    marks.push(Mark::Barcode {
        x: l.x(30),
        y: l.y(112),
        height: scale_round(72, l.scale_y),
        module: barcode_module(koli_number.chars().count(), l.x(30), l.w_dots, l.scale_x),
        hri_font: l.font(18),
        payload: koli_number,
    });

    Sheet {
        w_dots: l.w_dots,
        h_dots: l.h_dots,
        offset_dots: scale_round(1, size.left_offset_mm.max(0.0) * DOTS_PER_MM),
        copies: 1,
        marks,
    }
}

/// Render the koli sticker for the printer.
pub fn render_koli_label(
    data: &KoliLabelData<'_>,
    size: LabelSize,
    brand: LabelBrand<'_>,
) -> String {
    lay_out_koli(data, size, brand).to_zpl()
}

/// The same sticker, drawn for a screen.
pub fn preview_koli_label(
    data: &KoliLabelData<'_>,
    size: LabelSize,
    brand: LabelBrand<'_>,
) -> String {
    lay_out_koli(data, size, brand).to_svg()
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

/// TSPL delimits strings with double quotes and has no escape for one inside
/// them, so a quote in an article name would end the argument early and leave
/// the rest of the name as a syntax error the printer answers with silence.
/// Replaced rather than escaped, because a tag that prints the name with a
/// straight quote turned into a typographic one is right, and a tag that does
/// not print at all is not.
fn tspl_quoted(text: &str) -> String {
    text.replace('"', "\u{201d}")
}

/// The EPC write, in TSPL.
///
/// THIS IS THE ONE LINE IN THIS FILE THAT HAS NOT BEEN PUT IN FRONT OF A
/// PRINTER. Everything else here is geometry the ZPL side has printed and had
/// checked; the RFID command differs between TSC families and firmware
/// revisions, and the manual for the machine in the building is the authority.
/// It is a function of its own so that correcting it is one edit, and
/// `scripts/label-sink.py` prints exactly what was emitted so the comparison
/// against the manual takes a minute.
///
/// The form below mirrors what the ZPL side asks for: bank 1 (EPC), starting
/// at the first block, `hex.len() / 2` bytes, written as hexadecimal.
///
/// The failure to watch for is not a refusal. A TSC that does not recognise
/// this simply ignores the line and prints a perfect tag with an empty chip —
/// which is why a printed tag is not evidence and a tag read back is.
fn rfid_write_tspl(hex: &str) -> String {
    format!("RFWRITE 1,0,{},\"{hex}\"\n", hex.len() / 2)
}

/// The CRC and PC words that sit in front of the EPC in bank 1.
const PC_WORD_BYTES: usize = 2;

/// The Protocol Control word for an EPC of this length.
///
/// Its top five bits are the EPC's length in 16-bit words, and a reader
/// believes it over anything else: a tag whose PC word says six words returns
/// 96 bits no matter what the rest of the bank holds. Writing the EPC without
/// it leaves whatever the previous owner declared, which is how a tag comes
/// back with somebody else's trailing bytes attached.
fn protocol_control_word(hex: &str) -> String {
    let words = hex.len() / 4;
    format!("{:04X}", (words as u16) << 11)
}

/// Which language to hand the printer.
///
/// A fact about the machine at the bench, not about the label: the same tag
/// goes to a Printronix in ZGL and to a TSC in TSPL, and the difference is a
/// setting rather than a design.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum PrinterLanguage {
    /// The strict ZPL II subset this file was built and proven against.
    #[default]
    #[serde(rename = "ZPL")]
    Zpl,
    /// TSC's own language, for a machine with no ZPL emulation to switch into.
    #[serde(rename = "TSPL")]
    Tspl,
}

impl PrinterLanguage {
    /// What the column holds. The check constraint on `print_session.lang`
    /// names these two exactly, so this is the one spelling both sides agree on.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Zpl => "ZPL",
            Self::Tspl => "TSPL",
        }
    }

    /// Read back from the session row. An unrecognised value cannot reach the
    /// database — the check constraint refuses it — so anything else here means
    /// a row written by something that is not this code, and ZPL is the answer
    /// that prints rather than the answer that guesses.
    pub fn parse(value: &str) -> Self {
        if value.trim().eq_ignore_ascii_case("tspl") {
            Self::Tspl
        } else {
            Self::Zpl
        }
    }

    /// The node-wide default, for a bench that has not said.
    ///
    /// `PRINTER_LANGUAGE=TSPL` sets it; anything else, including unset, is ZPL
    /// — the language every tag in the field so far was written in, and
    /// therefore the only safe answer when nobody has chosen.
    pub fn from_env() -> Self {
        match std::env::var("PRINTER_LANGUAGE") {
            Ok(value) if value.trim().eq_ignore_ascii_case("tspl") => Self::Tspl,
            _ => Self::Zpl,
        }
    }
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
            epc: "a11234567812300000000064",
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
            "^RFW,H,1,12,1^FDA11234567812300000000064^FS\n",
            "^PQ1,0,1,Y\n",
            "^XZ\n",
        );
        assert_eq!(zpl, expected);
    }

    #[test]
    fn the_short_tag_reproduces_the_label_the_owner_approved() {
        // Byte for byte against the ZPL that was sent by hand to the bridge
        // and held up as right. Written down because it was arrived at on the
        // bench, one printed tag at a time, and nothing in the code says why
        // 34 and 314 and `^BY2` rather than anything else: the next change
        // that looks reasonable in isolation has to break this to land.
        let data = LabelData {
            sku_code: "00000011008",
            article_name: "D",
            colour_label: "Black",
            size_label: "One Size",
            barcode_payload: "00000011008",
            price_minor: 480_000,
            epc: "a00000001100800000000001",
            copies: 1,
        };
        let size = LabelSize {
            width_mm: 45.0,
            height_mm: 18.0,
            left_offset_mm: 2.0,
        };
        let expected = concat!(
            "^XA\n",
            "^PW360\n",
            "^LL144\n",
            "^CI28\n",
            "^LH0,0\n",
            "^FO34,18^A0N,18,18^FDCENTRAL^FS\n",
            "^FO34,18^FB314,1,0,R,0^A0N,18,18^FDRp 480.000^FS\n",
            "^FO34,44^A0N,18,18^FDD^FS\n",
            "^FO34,44^FB314,1,0,R,0^A0N,18,18^FDBlack^FS\n",
            "^FO34,75^BY2,3,26^BCN,26,Y,N,N^FD00000011008^FS\n",
            "^RFW,H,1,14,1^FD3000A00000001100800000000001^FS\n",
            "^PQ1,0,1,Y\n",
            "^XZ\n",
        );
        assert_eq!(render_label(&data, size, LabelBrand("CENTRAL")), expected);
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
    fn the_rfid_write_leads_with_the_protocol_control_word() {
        let data = sample();
        let zpl = render_label(&data, LabelSize::default(), LabelBrand("CENTRAL"));

        // 12 bytes of EPC plus the 2-byte PC word, and the payload is the PC
        // word followed by the EPC exactly as given.
        assert!(
            zpl.contains("^RFW,H,1,14,1^FD3000A11234567812300000000064^FS"),
            "{zpl}"
        );

        // Measured on a TSC MB241: without the prefix the first four hex
        // characters are eaten by the PC word and the tag reads back short.
        assert!(
            !zpl.contains("^RFW,H,1,12,1^FDA0"),
            "the bare EPC form writes one word early: {zpl}"
        );
    }

    #[test]
    fn the_control_word_states_the_epc_length_in_words() {
        // Top five bits are the length in 16-bit words: six for EPC-96,
        // eight for EPC-128. A reader believes this over the bank's contents.
        assert_eq!(protocol_control_word(&"A".repeat(24)), "3000");
        assert_eq!(protocol_control_word(&"A".repeat(32)), "4000");
    }

    #[test]
    fn tspl_draws_the_same_tag_the_zpl_emitter_does() {
        let data = sample();
        let size = LabelSize::default();
        let tspl = render_label_in(&data, size, LabelBrand("CENTRAL"), PrinterLanguage::Tspl);
        let zpl = render_label_in(&data, size, LabelBrand("CENTRAL"), PrinterLanguage::Zpl);

        // The frame the printer is told to expect.
        assert!(tspl.starts_with("SIZE 58 mm,40 mm\n"), "{tspl}");
        assert!(tspl.contains("CLS\n"), "{tspl}");
        assert!(tspl.ends_with("PRINT 1,1\n"), "{tspl}");
        assert!(
            !tspl.contains("^XA"),
            "ZPL leaked into the TSPL job: {tspl}"
        );

        // Same words, same EPC. Whatever the ZPL emitter puts on the tag, this
        // one puts there too — that is the point of sharing the marks.
        for word in ["CENTRAL", "SB Eric rain pants", "Navy", "L", "Rp 89.000"] {
            assert!(tspl.contains(word), "{word} missing from {tspl}");
            assert!(zpl.contains(word), "{word} missing from {zpl}");
        }
        assert!(tspl.contains("A11234567812300000000064"), "{tspl}");

        // Every text mark carries over at the height the ZPL side uses, so a
        // field that fits one printer fits the other.
        let heights: Vec<&str> = zpl
            .lines()
            .filter_map(|line| line.split("^A0N,").nth(1))
            .filter_map(|rest| rest.split(',').next())
            .collect();
        for height in heights {
            assert!(
                tspl.contains(&format!(",\"0\",0,{height},{height},")),
                "glyph height {height} not carried into {tspl}"
            );
        }
    }

    #[test]
    fn a_quote_in_a_name_cannot_end_a_tspl_argument_early() {
        let mut data = sample();
        data.article_name = "The 5\" Short";
        let tspl = render_label_in(
            &data,
            LabelSize::default(),
            LabelBrand("CENTRAL"),
            PrinterLanguage::Tspl,
        );
        // Exactly two quotes on the line: the ones that delimit the argument.
        let line = tspl
            .lines()
            .find(|line| line.contains("Short"))
            .unwrap_or_default();
        assert_eq!(line.matches('"').count(), 4, "{line}");
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
            left_offset_mm: 0.0,
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

    // -----------------------------------------------------------------------
    // The same layout, drawn for a screen
    // -----------------------------------------------------------------------

    #[test]
    fn a_preview_puts_every_field_where_the_printer_is_told_to_put_it() {
        let svg = preview_label(&sample(), LabelSize::default(), LabelBrand("CENTRAL"));

        // The tag's own dots are the picture's coordinate system, so a
        // position read off one is a position on the other.
        assert!(svg.contains("viewBox=\"0 0 464 320\""), "{svg}");

        // Brand: ^FO16,14 at 48 dots, so a baseline at 14 + 48 × 0.78.
        assert!(
            svg.contains("x=\"16\" y=\"51.4\" font-size=\"48\""),
            "{svg}"
        );
        // The price, which is the other thing anybody squints at.
        assert!(svg.contains("Rp 89.000"), "{svg}");
        // And the size, at the weight the rail is shopped by.
        assert!(svg.contains("font-size=\"44\""), "{svg}");
    }

    #[test]
    fn a_preview_and_a_print_are_one_layout_asked_twice() {
        // Not a comparison of two renderings — a demonstration that both come
        // from the same pass. Every text the ZPL carries appears in the
        // picture, and at the same size.
        let mut data = sample();
        data.article_name = "Kemeja katun";
        let zpl = render_label(&data, LabelSize::default(), LabelBrand("CENTRAL"));
        let svg = preview_label(&data, LabelSize::default(), LabelBrand("CENTRAL"));

        for field in [
            "CENTRAL",
            "12345678123",
            "Kemeja katun",
            "L",
            "Navy",
            "Rp 89.000",
        ] {
            assert!(zpl.contains(field), "missing from the job: {field}");
            assert!(svg.contains(field), "missing from the picture: {field}");
        }
        for font in ["48", "16", "21", "44", "17"] {
            assert!(
                svg.contains(&format!("font-size=\"{font}\"")),
                "picture is missing {font} dot type: {svg}"
            );
        }
    }

    #[test]
    fn a_preview_of_a_smaller_tag_is_a_smaller_picture() {
        let svg = preview_label(
            &sample(),
            LabelSize {
                width_mm: 40.0,
                height_mm: 30.0,
                left_offset_mm: 0.0,
            },
            LabelBrand("CENTRAL"),
        );
        assert!(svg.contains("viewBox=\"0 0 320 240\""), "{svg}");
        assert!(svg.contains("font-size=\"33\""), "{svg}");
    }

    #[test]
    fn a_name_that_would_close_the_element_it_is_drawn_into_cannot() {
        // `escape` guards the printer's field terminator and leaves XML alone,
        // because ZPL does not care about it. The picture does: this is the
        // second escape, and it is not the same job as the first.
        let mut data = sample();
        data.article_name = "Jaket <b>&\"biru\"</b>";
        let svg = preview_label(&data, LabelSize::default(), LabelBrand("CENTRAL"));
        assert!(
            svg.contains("Jaket &lt;b&gt;&amp;&quot;biru&quot;"),
            "{svg}"
        );
        assert!(!svg.contains("<b>"), "{svg}");
        // One document out, and it still closes exactly once.
        assert_eq!(svg.matches("</svg>").count(), 1, "{svg}");
    }

    #[test]
    fn a_preview_draws_the_barcode_footprint_the_symbology_actually_needs() {
        // Twelve payload characters: start, twelve, checksum and stop, at two
        // dots a module. Drawn rather than encoded, but drawn at true size, so
        // a payload too wide for the tag is visible here before it is
        // discovered on paper.
        let svg = preview_label(&sample(), LabelSize::default(), LabelBrand("CENTRAL"));
        let width = code128_dots(12, 2);
        assert_eq!(width, (11 * 14 + 13) * 2);
        assert!(
            svg.contains(&format!("width=\"{width}\" height=\"50\"")),
            "{svg}"
        );
        // Said in words, so nobody tries to scan the screen.
        assert!(svg.contains("CODE 128"), "{svg}");
        // And the readable line the printer puts under the bars.
        assert!(svg.contains(">812345678123</text>"), "{svg}");
    }

    #[test]
    fn a_barcode_is_narrowed_to_stay_on_a_tag_rather_than_running_off_it() {
        // `^BY` is in dots and scales with nothing, so the barcode was the one
        // field on this label that kept its 58 mm width on a 40 mm tag: 334
        // dots of symbol across 320 dots of paper. A clipped Code 128 has no
        // stop bar, so it does not scan as a shortened number — it does not
        // scan.
        let small = LabelSize {
            width_mm: 40.0,
            height_mm: 30.0,
            left_offset_mm: 0.0,
        };
        let zpl = render_label(&sample(), small, LabelBrand("CENTRAL"));
        assert!(zpl.contains("^BY1,3,"), "{zpl}");

        let svg = preview_label(&sample(), small, LabelBrand("CENTRAL"));
        let (w_dots, _) = small.dots();
        let width = code128_dots(12, 1);
        assert!(11 + width <= w_dots, "{width} dots does not fit {w_dots}");
        assert!(svg.contains(&format!("width=\"{width}\"")), "{svg}");
    }

    #[test]
    fn the_tag_the_layout_was_tuned_against_still_gets_the_wide_module() {
        // The narrowing must not reach the stock everything was checked on:
        // a scanner prefers a wide bar, and 58 × 40 has the room.
        let zpl = render_label(&sample(), LabelSize::default(), LabelBrand("CENTRAL"));
        assert!(zpl.contains("^BY2,3,50"), "{zpl}");
    }

    #[test]
    fn a_koli_number_long_enough_to_overflow_its_own_default_stock_does_not() {
        // Found by drawing it: seventeen characters at two dots a module is
        // 444 dots of barcode starting 30 dots in, on a 464 dot sticker. This
        // was overflowing at the DEFAULT size, on every carton, before the
        // preview made it visible.
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
        assert!(zpl.contains("^BY1,3,"), "{zpl}");
        let (w_dots, _) = LabelSize::default().dots();
        assert!(30 + code128_dots(17, 1) <= w_dots);
    }

    #[test]
    fn a_preview_draws_ink_and_not_the_rfid_write() {
        // The EPC leaves no mark on the paper. Showing it on the picture would
        // be drawing something the operator will never find on the tag.
        let svg = preview_label(&sample(), LabelSize::default(), LabelBrand("CENTRAL"));
        assert!(!svg.to_uppercase().contains("A1123456781230"), "{svg}");
        assert!(!svg.contains("RFW"), "{svg}");
    }

    #[test]
    fn a_koli_sticker_can_be_looked_at_too() {
        let data = KoliLabelData {
            koli_number: "KOLI-dc-01-000901",
            destination_store_id: "toko-a",
            unit_count: 40,
            sealed_at: None,
        };
        let svg = preview_koli_label(&data, LabelSize::default(), LabelBrand("CENTRAL"));
        assert!(svg.contains("KOLI-dc-01-000901"), "{svg}");
        assert!(svg.contains("toko-a - 40 pcs"), "{svg}");
        assert!(svg.contains("viewBox=\"0 0 464 320\""), "{svg}");
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
