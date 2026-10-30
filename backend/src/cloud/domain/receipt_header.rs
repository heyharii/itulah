//! The picture at the top of a store's receipt (postgres 1009).
//!
//! One bit a dot, row after row, most significant bit first, 1 for black; a
//! row is `width / 8` bytes. Two widths because the paper has two: 576 dots
//! for 80 mm and 384 for 58 mm. The bits travel as base64 on the auth policy.

use base64::Engine;
use serde::{Deserialize, Serialize};

/// Dots across 80 mm paper.
pub const WIDE_DOTS: u16 = 576;
/// Dots across 58 mm paper.
pub const NARROW_DOTS: u16 = 384;
/// The tallest head, in rows: 50 mm on wide paper, 33 mm on narrow.
pub const WIDE_MAX_ROWS: u16 = 400;
pub const NARROW_MAX_ROWS: u16 = 270;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeaderBitmap {
    pub width: u16,
    pub height: u16,
    pub bits_b64: String,
}

impl HeaderBitmap {
    /// The bytes, when the picture is what it says it is.
    pub fn bytes(&self) -> Option<Vec<u8>> {
        if self.width == 0 || self.width % 8 != 0 || self.height == 0 {
            return None;
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(self.bits_b64.as_bytes())
            .ok()?;
        (bytes.len() == usize::from(self.width / 8) * usize::from(self.height)).then_some(bytes)
    }

    pub fn from_bytes(width: u16, height: u16, bytes: &[u8]) -> Self {
        Self {
            width,
            height,
            bits_b64: base64::engine::general_purpose::STANDARD.encode(bytes),
        }
    }

    /// Why this picture cannot be a head of `width` dots, or `None` when it can.
    pub fn problem(&self, width: u16, max_rows: u16) -> Option<String> {
        if self.width != width {
            return Some(format!("the picture must be {width} dots wide"));
        }
        if self.height < 8 || self.height > max_rows {
            return Some(format!("the picture must be 8 to {max_rows} rows tall"));
        }
        if self.bytes().is_none() {
            return Some("the picture's bits do not match its size".into());
        }
        None
    }
}

/// What a node holds: each width, or nothing.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiptHeader {
    #[serde(default)]
    pub wide: Option<HeaderBitmap>,
    #[serde(default)]
    pub narrow: Option<HeaderBitmap>,
}

impl ReceiptHeader {
    /// The picture for paper of `width_dots` across (the widest that fits).
    pub fn for_dots(&self, width_dots: usize) -> Option<&HeaderBitmap> {
        [self.wide.as_ref(), self.narrow.as_ref()]
            .into_iter()
            .flatten()
            .filter(|picture| usize::from(picture.width) <= width_dots)
            .max_by_key(|picture| picture.width)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_is_its_size_in_bits() {
        let picture = HeaderBitmap::from_bytes(16, 3, &[0u8; 6]);
        assert!(picture.bytes().is_some());
        assert!(HeaderBitmap::from_bytes(16, 3, &[0u8; 5]).bytes().is_none());
        assert!(picture.problem(16, 10).is_none());
        assert!(picture.problem(8, 10).is_some());
    }

    #[test]
    fn the_widest_picture_that_fits_is_chosen() {
        let header = ReceiptHeader {
            wide: Some(HeaderBitmap::from_bytes(576, 8, &vec![0u8; 72 * 8])),
            narrow: Some(HeaderBitmap::from_bytes(384, 8, &vec![0u8; 48 * 8])),
        };
        assert_eq!(header.for_dots(576).map(|p| p.width), Some(576));
        assert_eq!(header.for_dots(464).map(|p| p.width), Some(384));
        assert_eq!(header.for_dots(200).map(|p| p.width), None);
    }
}
