//! The identity a piece of merchandise carries: its article code, its SKU,
//! the EPC written into its RFID tag, and the QR printed on its label.
//!
//! # Why this module exists exactly once
//!
//! Every rule here is a shared secret between things that never talk to each
//! other: the cloud that mints an EPC, the printer that writes it, the
//! handheld that reads it back, and the till that sells the item. If any two
//! of them disagree by one bit, a tag written in the warehouse cannot be
//! resolved on the sales floor — and the symptom is not "encoding bug", it is
//! **stock going missing**. Someone scans a rack, the item does not answer,
//! and it is written off as shrinkage.
//!
//! Our fleet's older systems learned this the expensive way and defended
//! themselves by keeping three copies of the codec (Go, Rust, Kotlin) and
//! testing them against each other forever. We avoid the problem instead of
//! policing it: the cloud computes every EPC and sends finished strings down.
//! Nothing at the edge encodes anything, so there is no second copy to drift.
//!
//! # Wire compatibility is not optional
//!
//! The formats below are not ours to choose. Handhelds already in the field
//! speak them, and labels already on garments carry them. The golden vectors
//! at the bottom of this file are lifted from the deployed implementations,
//! and they are the reason a tag we write today is readable by a scanner
//! bought three years ago.
//!
//! # The formats
//!
//! - **Article code** — 8 ASCII digits.
//! - **SKU code** — 11 ASCII digits: `article(8) + colour(1) + size(2)`.
//! - **EPC** — 96 bits, "retail private" header `0xA1`, then the 11 SKU
//!   digits as BCD (44 bits), then a 44-bit per-SKU serial.
//! - **QR** — `R1:<sku>`, one per SKU.
//! - **Barcode** — `8<sku>`, one per SKU.
//!
//! # The ten-colourway ceiling
//!
//! Colour is one digit, so an article can have at most ten colourways. Not
//! "awkwardly many" — ten. The eleventh cannot be expressed, because there is
//! no eleventh value of a single digit. This is inherited deliberately: it is
//! the format the warehouse, the handhelds and the printed labels already
//! speak, and changing it would strand every tag in the estate.

/// Digits in an article code.
pub const ARTICLE_CODE_LEN: usize = 8;
/// Digits of colour inside a SKU. One — hence ten colourways per article.
pub const SKU_COLOUR_LEN: usize = 1;
/// Digits of size inside a SKU.
pub const SKU_SIZE_LEN: usize = 2;
/// Digits in a SKU code: article + colour + size.
pub const SKU_LEN: usize = ARTICLE_CODE_LEN + SKU_COLOUR_LEN + SKU_SIZE_LEN;

/// Marks a tag as ours rather than a GS1 SGTIN (`0x30`), a GIAI (`0x34`) or a
/// factory TID. A reader that does not recognise this header leaves the tag
/// opaque and resolves it by exact hex lookup, which still works.
const RETAIL_PRIVATE_HEADER: u8 = 0xA1;
/// Bits of serial inside an EPC.
pub const EPC_SERIAL_BITS: u32 = 44;
/// One past the largest usable serial: 2^44, about 17.6 trillion per SKU.
pub const EPC_MAX_SERIAL: u64 = 1u64 << EPC_SERIAL_BITS;
/// Hex characters in a 96-bit EPC.
pub const EPC_HEX_LEN: usize = 24;

/// The QR payload version. `R1:` says "retail identifier, payload version 1",
/// so a scanner meeting a future `R2:` knows it is out of date instead of
/// misreading it.
const QR_PREFIX: &str = "R1:";

fn all_ascii_digits(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit())
}

/// An article code from a monotonic sequence, zero-padded to eight digits.
///
/// Zero is refused: a code of `00000000` is indistinguishable from an unset
/// field on a printed document, and the first thing anyone does with an
/// ambiguous code is guess.
pub fn article_code(sequence: u64) -> Result<String, String> {
    if sequence == 0 {
        return Err("article sequence 0 is reserved: codes start at 1".into());
    }
    if sequence > 99_999_999 {
        return Err(format!(
            "article sequence {sequence} does not fit in {ARTICLE_CODE_LEN} digits"
        ));
    }
    Ok(format!("{sequence:08}"))
}

/// Check an article code without minting one — for codes that arrive from a
/// purchase order or an operator rather than from our own sequence.
pub fn validate_article_code(code: &str) -> Result<(), String> {
    if code.len() != ARTICLE_CODE_LEN || !all_ascii_digits(code) {
        return Err(format!(
            "article code {code:?} must be exactly {ARTICLE_CODE_LEN} ASCII digits"
        ));
    }
    Ok(())
}

/// Compose a SKU. This is the ONLY way a SKU is ever made: it is derived,
/// never accepted from a caller, so a malformed article code or an
/// out-of-range colour cannot reach the catalogue.
pub fn sku_code(article_code: &str, colour_digit: char, size_code: &str) -> Result<String, String> {
    validate_article_code(article_code)?;
    if !colour_digit.is_ascii_digit() {
        return Err(format!(
            "colour {colour_digit:?} must be a single ASCII digit 0-9; \
             an article can carry at most ten colourways"
        ));
    }
    if size_code.len() != SKU_SIZE_LEN || !all_ascii_digits(size_code) {
        return Err(format!(
            "size code {size_code:?} must be exactly {SKU_SIZE_LEN} ASCII digits"
        ));
    }
    let sku = format!("{article_code}{colour_digit}{size_code}");
    // Belt and braces: the parts were each checked, but the whole is what
    // travels, and it is the whole that must be 11 digits.
    debug_assert_eq!(sku.len(), SKU_LEN);
    Ok(sku)
}

/// Reject anything that is not a canonical SKU.
pub fn validate_sku_code(sku: &str) -> Result<(), String> {
    if sku.len() != SKU_LEN || !all_ascii_digits(sku) {
        return Err(format!(
            "SKU {sku:?} must be exactly {SKU_LEN} ASCII digits \
             ({ARTICLE_CODE_LEN} article + {SKU_COLOUR_LEN} colour + {SKU_SIZE_LEN} size)"
        ));
    }
    Ok(())
}

/// Split a SKU back into the three things it was made from.
pub fn sku_parts(sku: &str) -> Result<(&str, char, &str), String> {
    validate_sku_code(sku)?;
    let colour = sku[ARTICLE_CODE_LEN..ARTICLE_CODE_LEN + SKU_COLOUR_LEN]
        .chars()
        .next()
        .ok_or_else(|| format!("SKU {sku:?} has no colour digit"))?;
    Ok((
        &sku[..ARTICLE_CODE_LEN],
        colour,
        &sku[ARTICLE_CODE_LEN + SKU_COLOUR_LEN..],
    ))
}

/// What goes on the label as a QR: one per SKU, identical on every unit of
/// that SKU. The QR says WHAT this is; the EPC says WHICH ONE.
pub fn qr_payload(sku: &str) -> Result<String, String> {
    validate_sku_code(sku)?;
    Ok(format!("{QR_PREFIX}{sku}"))
}

/// The linear barcode payload, also per-SKU.
pub fn barcode_payload(sku: &str) -> Result<String, String> {
    validate_sku_code(sku)?;
    Ok(format!("8{sku}"))
}

/// Write the 11 SKU digits into the EPC as BCD: digits 0..=9 fill bytes 1..=5
/// two to a byte, and digit 10 takes the upper nibble of byte 6. The lower
/// nibble of byte 6 belongs to the serial.
fn sku_to_bcd(sku: &str, epc: &mut [u8; 12]) {
    let bytes = sku.as_bytes();
    for (i, byte) in bytes.iter().take(10).enumerate() {
        let digit = byte - b'0';
        let index = 1 + i / 2;
        if i % 2 == 0 {
            epc[index] = digit << 4;
        } else {
            epc[index] |= digit;
        }
    }
    epc[6] = (bytes[10] - b'0') << 4;
}

/// Encode one EPC: header, SKU as BCD, then the serial.
///
/// The serial bound is `serial < EPC_MAX_SERIAL`, checked before anything is
/// allocated. An older implementation in this estate checked it after
/// advancing its counter, which both refused the last legitimate serial and
/// burned the range it had just refused to issue.
pub fn encode_epc(sku: &str, serial: u64) -> Result<String, String> {
    validate_sku_code(sku)?;
    if serial >= EPC_MAX_SERIAL {
        return Err(format!(
            "serial {serial} overflows the {EPC_SERIAL_BITS}-bit field (max {})",
            EPC_MAX_SERIAL - 1
        ));
    }
    let mut epc = [0u8; 12];
    epc[0] = RETAIL_PRIVATE_HEADER;
    sku_to_bcd(sku, &mut epc);
    // Serial: top 4 bits into the low nibble of byte 6, the rest big-endian.
    epc[6] |= ((serial >> 40) & 0x0F) as u8;
    epc[7] = (serial >> 32) as u8;
    epc[8] = (serial >> 24) as u8;
    epc[9] = (serial >> 16) as u8;
    epc[10] = (serial >> 8) as u8;
    epc[11] = serial as u8;
    // Uppercase, because that is this system's canonical rendering and there
    // is a database constraint that says so. Hex case is not part of the
    // identity — an EPC is 96 bits, and the deployed encoders in this estate
    // already disagree with each other about case while interoperating fine —
    // so every reader here normalises rather than comparing raw strings.
    Ok(epc.iter().map(|b| format!("{b:02X}")).collect())
}

/// Encode a contiguous run of serials for one SKU — what a tagging job needs.
///
/// The whole range is validated before a single string is produced, so a run
/// that would overflow fails without leaving half a job behind.
pub fn encode_epc_range(sku: &str, start: u64, count: u64) -> Result<Vec<String>, String> {
    validate_sku_code(sku)?;
    if count == 0 {
        return Err("a tagging run of zero units is not a run".into());
    }
    let end = start
        .checked_add(count)
        .ok_or_else(|| format!("serial range {start}+{count} overflows"))?;
    if end > EPC_MAX_SERIAL {
        return Err(format!(
            "serial range {start}..{end} overflows the {EPC_SERIAL_BITS}-bit field \
             (max {})",
            EPC_MAX_SERIAL - 1
        ));
    }
    (start..end).map(|serial| encode_epc(sku, serial)).collect()
}

/// Read a tag back: which SKU, and which unit of it.
pub fn decode_epc(hex: &str) -> Result<(String, u64), String> {
    let normalised = hex.trim().to_ascii_lowercase();
    if normalised.len() != EPC_HEX_LEN || !normalised.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(format!(
            "EPC {hex:?} must be exactly {EPC_HEX_LEN} hex characters"
        ));
    }
    let mut epc = [0u8; 12];
    for (index, byte) in epc.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&normalised[index * 2..index * 2 + 2], 16)
            .map_err(|e| format!("EPC {hex:?} is not hex: {e}"))?;
    }
    if epc[0] != RETAIL_PRIVATE_HEADER {
        return Err(format!(
            "EPC {hex:?} is not one of ours: header {:#04x}, expected {RETAIL_PRIVATE_HEADER:#04x}",
            epc[0]
        ));
    }
    let mut sku = String::with_capacity(SKU_LEN);
    for i in 0..10 {
        let index = 1 + i / 2;
        let nibble = if i % 2 == 0 {
            epc[index] >> 4
        } else {
            epc[index] & 0x0F
        };
        if nibble > 9 {
            return Err(format!(
                "EPC {hex:?} carries {nibble:#x} where a decimal digit belongs"
            ));
        }
        sku.push((b'0' + nibble) as char);
    }
    let last = epc[6] >> 4;
    if last > 9 {
        return Err(format!(
            "EPC {hex:?} carries {last:#x} where a decimal digit belongs"
        ));
    }
    sku.push((b'0' + last) as char);

    let serial = u64::from(epc[6] & 0x0F) << 40
        | u64::from(epc[7]) << 32
        | u64::from(epc[8]) << 24
        | u64::from(epc[9]) << 16
        | u64::from(epc[10]) << 8
        | u64::from(epc[11]);
    Ok((sku, serial))
}

/// Is this hex one of our tags at all? Cheap enough to run on every read.
pub fn is_retail_private_epc(hex: &str) -> bool {
    let normalised = hex.trim().to_ascii_lowercase();
    normalised.len() == EPC_HEX_LEN
        && normalised.bytes().all(|b| b.is_ascii_hexdigit())
        && normalised.starts_with("a0")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Golden vectors ---------------------------------------------------
    //
    // These are not our numbers. They are lifted from the implementations
    // already deployed across this estate — the Go encoder, its Rust port and
    // the Kotlin one running on the handhelds. A change that breaks any line
    // below strands physical tags on physical garments, so these tests exist
    // to make that break loud and immediate rather than discovered on a
    // warehouse floor six months later.

    #[test]
    fn sku_golden_vectors_match_the_deployed_encoder() {
        for (article, colour, size, expected) in [
            ("00000123", '4', "05", "00000123405"),
            ("12345678", '0', "01", "12345678001"),
            ("99999999", '9', "99", "99999999999"),
            ("00000000", '0', "00", "00000000000"),
            ("12345678", '3', "02", "12345678302"),
        ] {
            let sku = sku_code(article, colour, size)
                .unwrap_or_else(|e| panic!("{article}/{colour}/{size}: {e}"));
            assert_eq!(sku, expected);
            assert_eq!(sku.len(), SKU_LEN);
        }
    }

    #[test]
    fn epc_golden_vector_matches_the_deployed_encoder() {
        // The single most load-bearing assertion in this module: the bits we
        // write must be identical to the ones the existing handhelds write.
        //
        // The comparison ignores hex case because case is a rendering choice,
        // not part of the 96-bit value — the deployed encoders themselves
        // differ on it. Every other digit must match exactly.
        let ours = encode_epc("12345678123", 100).unwrap_or_else(|e| panic!("encode: {e}"));
        assert!(
            ours.eq_ignore_ascii_case("a11234567812300000000064"),
            "our encoding {ours} is not the one already on garments in the estate"
        );
    }

    #[test]
    fn an_epc_round_trips_through_decode() {
        for (sku, serial) in [
            ("12345678123", 0u64),
            ("12345678123", 100),
            ("00000000000", 1),
            ("99999999999", EPC_MAX_SERIAL - 1),
            ("12345678302", 0x0F_FFFF_FFFF),
        ] {
            let hex = encode_epc(sku, serial).unwrap_or_else(|e| panic!("encode {sku}: {e}"));
            let (back, back_serial) =
                decode_epc(&hex).unwrap_or_else(|e| panic!("decode {hex}: {e}"));
            assert_eq!(back, sku, "sku did not survive {hex}");
            assert_eq!(back_serial, serial, "serial did not survive {hex}");
        }
    }

    #[test]
    fn the_last_legitimate_serial_is_usable() {
        // An older encoder in this estate refused this value and burned the
        // range while refusing it. One-off errors at the top of a counter are
        // invisible until the day the counter gets there.
        let top = EPC_MAX_SERIAL - 1;
        let hex = encode_epc("12345678123", top).unwrap_or_else(|e| panic!("top serial: {e}"));
        assert_eq!(decode_epc(&hex).map(|(_, s)| s), Ok(top));
        assert!(encode_epc("12345678123", EPC_MAX_SERIAL).is_err());
    }

    #[test]
    fn a_range_that_would_overflow_produces_nothing_at_all() {
        let start = EPC_MAX_SERIAL - 3;
        assert!(encode_epc_range("12345678123", start, 3).is_ok());
        // Four would step past the ceiling; the whole run must fail rather
        // than hand back three tags and a problem.
        assert!(encode_epc_range("12345678123", start, 4).is_err());
        assert!(encode_epc_range("12345678123", 0, 0).is_err());
    }

    #[test]
    fn a_range_is_contiguous_and_distinct() {
        let run = encode_epc_range("12345678302", 500, 4).unwrap_or_else(|e| panic!("range: {e}"));
        assert_eq!(run.len(), 4);
        let serials: Vec<u64> = run
            .iter()
            .map(|hex| decode_epc(hex).unwrap_or_else(|e| panic!("{hex}: {e}")).1)
            .collect();
        assert_eq!(serials, vec![500, 501, 502, 503]);
        let unique: std::collections::HashSet<&String> = run.iter().collect();
        assert_eq!(unique.len(), 4, "two units must never share an EPC");
    }

    #[test]
    fn two_skus_never_share_an_epc_even_at_the_same_serial() {
        // The serial counter is per-SKU, so serial 7 exists many times over.
        // What keeps tags distinct is that the SKU is inside the EPC.
        let a = encode_epc("12345678302", 7).unwrap_or_else(|e| panic!("{e}"));
        let b = encode_epc("12345678303", 7).unwrap_or_else(|e| panic!("{e}"));
        assert_ne!(a, b);
    }

    // ---- Refusals ---------------------------------------------------------

    #[test]
    fn a_non_eight_digit_article_code_cannot_mint_a_sku() {
        for bad in ["1234567", "123456789", "ABCDEFGH", "1234567A", ""] {
            assert!(
                sku_code(bad, '1', "02").is_err(),
                "{bad:?} should not have produced a SKU"
            );
        }
    }

    #[test]
    fn a_size_code_must_be_two_digits() {
        for bad in ["2", "002", "M", "0M"] {
            assert!(sku_code("12345678", '1', bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn a_non_digit_colour_is_refused() {
        for bad in ['A', '-', ' ', 'あ'] {
            assert!(sku_code("12345678", bad, "02").is_err(), "{bad:?}");
        }
    }

    #[test]
    fn full_width_unicode_digits_are_not_digits() {
        // `is_ascii_digit` is deliberate: a full-width ３ looks like a 3 on a
        // screen and is a different byte sequence on a tag.
        assert!(validate_sku_code("１２３４５６７８３０２").is_err());
        assert!(validate_article_code("１２３４５６７８").is_err());
    }

    #[test]
    fn a_foreign_tag_is_refused_rather_than_misread() {
        // A GS1 SGTIN-96 begins 0x30. Decoding it with our layout would
        // produce a plausible-looking SKU that means nothing.
        let sgtin = "30".to_string() + &"1".repeat(22);
        assert!(decode_epc(&sgtin).is_err());
        assert!(!is_retail_private_epc(&sgtin));
        assert!(is_retail_private_epc("a11234567812300000000064"));
    }

    #[test]
    fn a_tag_carrying_hex_where_a_digit_belongs_is_refused() {
        // BCD nibbles above 9 are not decimal digits. Reading one as a digit
        // would silently invent a SKU.
        assert!(decode_epc("a1ff34567812300000000064").is_err());
    }

    #[test]
    fn epc_case_and_whitespace_do_not_change_identity() {
        // A tag read by a handheld that renders hex in the other case is the
        // same tag. Refusing it would strand real stock over a formatting
        // difference.
        for rendering in [
            "  A11234567812300000000064  ",
            "a11234567812300000000064",
            "A11234567812300000000064",
        ] {
            let (sku, serial) =
                decode_epc(rendering).unwrap_or_else(|e| panic!("decode {rendering}: {e}"));
            assert_eq!(sku, "12345678123");
            assert_eq!(serial, 100);
        }
    }

    // ---- Article codes and label payloads ---------------------------------

    #[test]
    fn article_codes_are_padded_and_bounded() {
        assert_eq!(article_code(1).as_deref(), Ok("00000001"));
        assert_eq!(article_code(12_345_678).as_deref(), Ok("12345678"));
        assert_eq!(article_code(99_999_999).as_deref(), Ok("99999999"));
        assert!(article_code(0).is_err(), "0 is reserved");
        assert!(article_code(100_000_000).is_err());
    }

    #[test]
    fn qr_and_barcode_are_per_sku_not_per_unit() {
        // Every unit of a SKU carries the same QR. That is the point: the QR
        // answers "what is this", and the EPC answers "which one".
        assert_eq!(qr_payload("12345678102").as_deref(), Ok("R1:12345678102"));
        assert_eq!(
            barcode_payload("12345678102").as_deref(),
            Ok("812345678102")
        );
        assert!(qr_payload("123").is_err());
    }

    #[test]
    fn sku_parts_recovers_what_composed_it() {
        let sku = sku_code("12345678", '3', "02").unwrap_or_else(|e| panic!("{e}"));
        let (article, colour, size) = sku_parts(&sku).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(article, "12345678");
        assert_eq!(colour, '3');
        assert_eq!(size, "02");
    }
}
