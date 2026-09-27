//! How a machine in a shop becomes a node: the wire between the enrolment
//! code a person types and the key the node keeps.
//!
//! Shared by the cloud, which issues and approves, and by the edge, which
//! claims and waits — for the reason this module's parent gives: two copies of
//! a protocol are two protocols. The verification number in particular must be
//! computed identically on both ends, because a person reads one aloud and
//! another compares it with the second.
//!
//! # The three secrets, and why there are three
//!
//! - The **code** is what a person carries from the hub to the shop. It is
//!   short enough to type, and therefore weak: it proves only that whoever
//!   holds it was told about one enrolment. It dies on first use or after its
//!   hour, whichever comes first.
//! - The **ingest key** is what the node proves itself with for the rest of
//!   its life. It is minted *on the machine* and never shown to anybody; the
//!   claim carries only its SHA-256, which is all the cloud has ever stored for
//!   any origin (`sync_origin_credential.ingest_key_sha256`).
//! - The **verification number** binds the two. It is derived from the code
//!   and the key's digest, so the shop's screen and the hub's approval sheet
//!   show the same six digits only if the machine that claimed is the machine
//!   the shop is looking at. Someone who intercepted the code and claimed first
//!   shows head office a different number.
//!
//! # Why a code alone is not enough to guess
//!
//! Ten Crockford base-32 characters are 50 bits. At a thousand guesses a second
//! for the whole hour a code lives, an attacker makes about 2²² of them, and
//! with a handful of live codes the chance that any guess lands is around one
//! in 2²⁵. There is no per-code attempt counter because a guesser does not know
//! which code they are guessing; entropy and expiry are the defence, and a
//! person approving each claim is the defence behind that.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::security;

/// Crockford's base 32: digits and capitals without I, L, O and U, so a code
/// read over the phone cannot be mistaken for a different one.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Characters in a code, not counting the hyphen it is displayed with.
pub const CODE_LENGTH: usize = 10;

/// How long a code lives when the issuer does not say. An hour covers "print
/// it, drive to the shop, run the installer" for a nearby shop; a far one asks
/// for longer when the code is issued.
pub const DEFAULT_CODE_TTL_MINUTES: i64 = 60;

/// The longest a code may be issued for. A day is the longest a person can
/// plausibly need between issuing and typing; past that the code is a
/// credential sitting in somebody's chat history.
pub const MAX_CODE_TTL_MINUTES: i64 = 24 * 60;

/// How long a claimed enrolment waits for a person at head office. The machine
/// polls throughout; after this the claim is stale and a new code is issued.
pub const CLAIM_APPROVAL_WINDOW_HOURS: i64 = 24;

/// A fresh code, uniformly random over the alphabet.
///
/// No rejection sampling is needed: 32 divides 256, so masking a byte to five
/// bits is exactly uniform.
pub fn random_code() -> String {
    let mut bytes = [0u8; CODE_LENGTH];
    OsRng.fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|byte| ALPHABET[(byte & 0x1f) as usize] as char)
        .collect()
}

/// A code as a person typed it, reduced to the canonical form, or `None` when
/// it cannot be a code at all.
///
/// Forgiving where Crockford says to be: case, hyphens and spaces are ignored,
/// `O` is read as zero and `I`/`L` as one. Anything else outside the alphabet
/// — `U` included — is refused before it can cost the database a lookup.
pub fn normalise_code(input: &str) -> Option<String> {
    let mut code = String::with_capacity(CODE_LENGTH);
    for character in input.chars() {
        let character = match character.to_ascii_uppercase() {
            '-' | ' ' => continue,
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        };
        if !character.is_ascii() || !ALPHABET.contains(&(character as u8)) {
            return None;
        }
        code.push(character);
    }
    (code.len() == CODE_LENGTH).then_some(code)
}

/// The code the way a person reads it: `7K4P9-QX2MA`.
pub fn display_code(code: &str) -> String {
    let (head, tail) = code.split_at(code.len() / 2);
    format!("{head}-{tail}")
}

/// The digest of an ingest key, in the form the cloud stores it.
pub fn key_digest(ingest_key: &str) -> String {
    security::sha256_hex(ingest_key)
}

/// Whether a string is a well-formed key digest: 64 lowercase hex characters.
pub fn is_key_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The six digits the shop reads to head office.
///
/// An HMAC keyed by the code over the key digest: the shop can compute it
/// because it holds both, the cloud because the claim delivers both, and
/// nobody else because the code is secret until it is spent. Reduced modulo a
/// million from 32 bits, which leaves a bias of about one part in four
/// thousand — irrelevant for a number whose only job is to differ.
pub fn verification_number(code: &str, key_sha256: &str) -> String {
    let mac = security::hmac_sha256_hex(code.as_bytes(), key_sha256.as_bytes());
    let value = u32::from_str_radix(&mac[..8], 16).expect("hex from hmac_sha256_hex");
    format!("{:06}", value % 1_000_000)
}

/// What the machine says about itself when it claims. Shown to the person
/// approving, so they can tell the shop's PC from somebody else's; never
/// trusted for anything else.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct MachineFacts {
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub os: String,
    #[serde(default)]
    pub arch: String,
    /// The node software's version.
    #[serde(default)]
    pub version: String,
}

impl MachineFacts {
    /// This machine, as far as the standard library can tell.
    pub fn here() -> Self {
        // Windows exports its name; a Unix shell usually does not export
        // `HOSTNAME` to a service, so ask the system the way a person would.
        let hostname = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .ok()
            .filter(|name| !name.trim().is_empty())
            .or_else(|| {
                std::process::Command::new("hostname")
                    .output()
                    .ok()
                    .and_then(|output| String::from_utf8(output.stdout).ok())
                    .map(|name| name.trim().to_owned())
            })
            .unwrap_or_default();
        Self {
            hostname,
            os: std::env::consts::OS.to_owned(),
            arch: std::env::consts::ARCH.to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
        }
    }

    /// Bounded, so a claim cannot park a megabyte of "hostname" in the table.
    pub fn clamped(mut self) -> Self {
        for field in [
            &mut self.hostname,
            &mut self.os,
            &mut self.arch,
            &mut self.version,
        ] {
            if field.chars().count() > 120 {
                *field = field.chars().take(120).collect();
            }
        }
        self
    }
}

/// `POST /api/v1/sync/enroll/claim`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimRequest {
    pub code: String,
    /// SHA-256 of the ingest key the machine minted, lowercase hex.
    pub key_sha256: String,
    #[serde(default)]
    pub machine: MachineFacts,
}

/// The answer to a claim that was accepted. The node shows `verification` and
/// then waits.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClaimAnswer {
    pub enrolment_id: Uuid,
    pub origin_id: String,
    /// Internal, like every site id: the node is configured with it and
    /// never shows it.
    pub site_id: String,
    pub node_role: String,
    pub verification: String,
    /// What the setup page shows instead: the site's code and name
    /// (`C003-TOKO`, `Purbalingga`). Absent from a cloud older than them.
    #[serde(default)]
    pub site_code: Option<String>,
    #[serde(default)]
    pub site_name: Option<String>,
}

impl ClaimAnswer {
    /// "C003-TOKO · Purbalingga", as much of it as the cloud said, and the
    /// site id only when it said neither.
    pub fn site_label(&self) -> String {
        site_label(
            self.site_code.as_deref(),
            self.site_name.as_deref(),
            &self.site_id,
        )
    }
}

/// A site as a person reads it: its code and name, joined by a middle dot,
/// falling back to its internal id only when neither is known.
pub fn site_label(code: Option<&str>, name: Option<&str>, site_id: &str) -> String {
    let parts: Vec<&str> = [code, name]
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    if parts.is_empty() {
        site_id.to_owned()
    } else {
        parts.join(" · ")
    }
}

/// `POST /api/v1/sync/enroll/status`, sent with the minted key as
/// `x-sync-key` — the claim already told the cloud its digest, so only the
/// machine that claimed can ask.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusRequest {
    pub enrolment_id: Uuid,
}

/// Where a claimed enrolment stands.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StatusAnswer {
    /// Nobody at head office has decided yet.
    Pending { verification: String },
    /// Registered. Everything the node needs to write its configuration.
    Approved {
        origin_id: String,
        site_id: String,
        node_role: String,
        active_generation: i64,
        label: Option<String>,
    },
    /// Head office said no, withdrew the code, or waited too long. The node
    /// forgets the key it minted and asks for a new code.
    Refused { reason: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_code_is_canonical() {
        for _ in 0..200 {
            let code = random_code();
            assert_eq!(code.len(), CODE_LENGTH);
            assert_eq!(normalise_code(&code).as_deref(), Some(code.as_str()));
        }
    }

    #[test]
    fn a_code_survives_being_read_aloud_and_typed_badly() {
        assert_eq!(normalise_code("7k4p9-qx2ma").as_deref(), Some("7K4P9QX2MA"));
        assert_eq!(
            normalise_code(" 7K4P9 QX2MA ").as_deref(),
            Some("7K4P9QX2MA")
        );
        // O for zero, I and L for one, as Crockford intends.
        assert_eq!(normalise_code("O0IL1-ABCDE").as_deref(), Some("00111ABCDE"));
    }

    #[test]
    fn what_cannot_be_a_code_is_refused_before_the_database() {
        assert_eq!(normalise_code(""), None);
        assert_eq!(normalise_code("7K4P9-QX2M"), None, "one short");
        assert_eq!(normalise_code("7K4P9-QX2MAB"), None, "one long");
        assert_eq!(
            normalise_code("7K4P9-QX2MU"),
            None,
            "U is not in the alphabet"
        );
        assert_eq!(normalise_code("7K4P9-QX2M!"), None);
        assert_eq!(normalise_code("7K4P9-QX2MÄ"), None);
    }

    #[test]
    fn a_code_is_displayed_in_two_halves() {
        assert_eq!(display_code("7K4P9QX2MA"), "7K4P9-QX2MA");
    }

    #[test]
    fn the_verification_number_is_six_digits_and_binds_both_halves() {
        let digest = key_digest("a key minted on the shop machine, long enough");
        let number = verification_number("7K4P9QX2MA", &digest);
        assert_eq!(number.len(), 6);
        assert!(number.bytes().all(|b| b.is_ascii_digit()));
        // Same inputs, same number: the shop and the hub must agree.
        assert_eq!(number, verification_number("7K4P9QX2MA", &digest));
        // A different machine (key) or a different code shows a different one.
        let other = key_digest("somebody else's key, minted somewhere else");
        assert_ne!(number, verification_number("7K4P9QX2MA", &other));
        assert_ne!(number, verification_number("7K4P9QX2MB", &digest));
    }

    #[test]
    fn a_key_digest_is_lowercase_hex_of_the_right_length() {
        assert!(is_key_digest(&key_digest("x")));
        assert!(!is_key_digest(&key_digest("x").to_uppercase()));
        assert!(!is_key_digest("abc"));
    }

    #[test]
    fn the_status_answer_is_tagged_the_way_the_edge_reads_it() {
        let pending = serde_json::to_value(StatusAnswer::Pending {
            verification: "123456".into(),
        })
        .unwrap();
        assert_eq!(pending["status"], "PENDING");
        let refused: StatusAnswer =
            serde_json::from_str(r#"{"status":"REFUSED","reason":"EXPIRED"}"#).unwrap();
        assert_eq!(
            refused,
            StatusAnswer::Refused {
                reason: "EXPIRED".into()
            }
        );
    }

    #[test]
    fn machine_facts_are_bounded() {
        let facts = MachineFacts {
            hostname: "x".repeat(500),
            ..MachineFacts::default()
        }
        .clamped();
        assert_eq!(facts.hostname.chars().count(), 120);
    }
}
