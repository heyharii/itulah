//! The rest of what a KTP says, the family a PTKP is read from, who to call,
//! and the papers kept on file (owner's list, 2026-10-25).
//!
//! # Why this is not part of [`super::Profile`]
//!
//! `Profile` holds the facts statutory filings are addressed to — name, NIK,
//! date of birth, address, phone, email — each amendment folded and re-checked.
//! These are the facts a store keys in from the card and the family register.
//! They are filled in together, read together and corrected together, so they
//! are one revisioned set: every save is a new revision carrying its author and
//! reason (`employee_detail_revision`), not one amendment chain per field.
//!
//! # Gender is asked, never decoded
//!
//! The NIK carries it (the day plus forty), and [`super::Nik`] says why that is
//! not ours to decode. It is a field on this form like the others.
//!
//! # The PTKP is a hint here, never the figure
//!
//! "Married, two children" reads as K/2, and the form says so. The PTKP that
//! payroll applies stays on the payroll identity, behind head office's own key:
//! a married woman is normally TK/0 whatever her family, and only HR knows
//! which reading applies.

use super::error::EmployeeError;
use super::ids::validated_text;
use serde::{Deserialize, Serialize};

/// Bounded maximum length of one detail.
pub const MAX_DETAIL_LEN: usize = 120;
/// More children than this is a typing slip, not a family.
pub const MAX_CHILDREN: u8 = 20;

const GENDERS: [&str; 2] = ["MALE", "FEMALE"];
const RELIGIONS: [&str; 7] = [
    "ISLAM",
    "CHRISTIAN",
    "CATHOLIC",
    "HINDU",
    "BUDDHIST",
    "CONFUCIAN",
    "OTHER",
];
const MARITAL: [&str; 4] = ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"];
const BLOOD_TYPES: [&str; 4] = ["A", "B", "AB", "O"];
const NATIONALITIES: [&str; 2] = ["WNI", "WNA"];

fn wni() -> String {
    "WNI".to_owned()
}

/// One code from a closed list, upper-cased on the way in.
fn one_of(
    field: &'static str,
    raw: &str,
    allowed: &[&str],
    expected: &'static str,
) -> Result<String, EmployeeError> {
    let value = raw.trim().to_ascii_uppercase();
    if value.is_empty() {
        return Err(EmployeeError::Required { field });
    }
    if allowed.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(EmployeeError::NotOneOf { field, expected })
    }
}

/// An optional detail: blank is none, anything else is bounded printable text.
fn optional(field: &'static str, raw: Option<String>) -> Result<Option<String>, EmployeeError> {
    match raw.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(value) => validated_text(field, value, MAX_DETAIL_LEN).map(Some),
    }
}

/// What the card, the family register and the next of kin say.
///
/// Fields are public because the set has no invariant across fields — only
/// each field's own — and [`EmployeeDetails::validated`] is the one way a set
/// is written. A stored set is validated again when it is read back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmployeeDetails {
    /// *Tempat lahir*.
    pub birth_place: String,
    /// `MALE` or `FEMALE`, as the card says.
    pub gender: String,
    /// `ISLAM`, `CHRISTIAN`, `CATHOLIC`, `HINDU`, `BUDDHIST`, `CONFUCIAN` or
    /// `OTHER`.
    pub religion: String,
    /// `SINGLE`, `MARRIED`, `DIVORCED` or `WIDOWED` — the card's four.
    pub marital_status: String,
    pub children: u8,
    /// `A`, `B`, `AB` or `O`; the card often leaves it blank.
    #[serde(default)]
    pub blood_type: Option<String>,
    /// `WNI` or `WNA`.
    #[serde(default = "wni")]
    pub nationality: String,
    /// The address's parts as the card prints them. The address block itself
    /// stays on the profile, where every filing reads it.
    #[serde(default)]
    pub rt_rw: Option<String>,
    #[serde(default)]
    pub village: Option<String>,
    #[serde(default)]
    pub district: Option<String>,
    #[serde(default)]
    pub city: Option<String>,
    #[serde(default)]
    pub province: Option<String>,
    /// Who to call, and what they are to the employee.
    #[serde(default)]
    pub emergency_name: Option<String>,
    #[serde(default)]
    pub emergency_relation: Option<String>,
    #[serde(default)]
    pub emergency_phone: Option<String>,
}

impl EmployeeDetails {
    /// The set, trimmed and checked field by field. Codes are upper-cased; a
    /// blank optional is none.
    pub fn validated(self) -> Result<Self, EmployeeError> {
        if self.children > MAX_CHILDREN {
            return Err(EmployeeError::TooLong {
                field: "children",
                max: usize::from(MAX_CHILDREN),
            });
        }
        let blood_type = match self.blood_type.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(raw) => Some(one_of("blood_type", raw, &BLOOD_TYPES, "A, B, AB or O")?),
        };
        let emergency_name = optional("emergency_name", self.emergency_name)?;
        let emergency_phone = optional("emergency_phone", self.emergency_phone)?;
        // A name nobody can ring, or a number for nobody, is half a contact.
        if emergency_name.is_some() != emergency_phone.is_some() {
            return Err(EmployeeError::Required {
                field: if emergency_name.is_some() {
                    "emergency_phone"
                } else {
                    "emergency_name"
                },
            });
        }
        Ok(EmployeeDetails {
            birth_place: validated_text("birth_place", &self.birth_place, MAX_DETAIL_LEN)?,
            gender: one_of("gender", &self.gender, &GENDERS, "MALE or FEMALE")?,
            religion: one_of(
                "religion",
                &self.religion,
                &RELIGIONS,
                "ISLAM, CHRISTIAN, CATHOLIC, HINDU, BUDDHIST, CONFUCIAN or OTHER",
            )?,
            marital_status: one_of(
                "marital_status",
                &self.marital_status,
                &MARITAL,
                "SINGLE, MARRIED, DIVORCED or WIDOWED",
            )?,
            children: self.children,
            blood_type,
            nationality: one_of(
                "nationality",
                &self.nationality,
                &NATIONALITIES,
                "WNI or WNA",
            )?,
            rt_rw: optional("rt_rw", self.rt_rw)?,
            village: optional("village", self.village)?,
            district: optional("district", self.district)?,
            city: optional("city", self.city)?,
            province: optional("province", self.province)?,
            emergency_name,
            emergency_relation: optional("emergency_relation", self.emergency_relation)?,
            emergency_phone,
        })
    }

    /// The PTKP status the family reads as — `K/2`, `TK/0` — with dependants
    /// capped at three, as the rule caps them. A hint for HR; see the module
    /// docs for why it is not the figure payroll applies.
    pub fn ptkp_hint(&self) -> String {
        let dependants = self.children.min(3);
        if self.marital_status == "MARRIED" {
            format!("K/{dependants}")
        } else {
            format!("TK/{dependants}")
        }
    }
}

/// A paper kept on an employee's file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DocumentKind {
    /// The face on the record.
    Photo,
    /// A scan of the KTP.
    Ktp,
    /// A scan of the *kartu keluarga*.
    Kk,
    /// The police certificate, as a PDF.
    Skck,
    /// The signed employment contract, as a PDF.
    Contract,
    Npwp,
    Bpjs,
    Other,
}

impl DocumentKind {
    pub const ALL: [DocumentKind; 8] = [
        DocumentKind::Photo,
        DocumentKind::Ktp,
        DocumentKind::Kk,
        DocumentKind::Skck,
        DocumentKind::Contract,
        DocumentKind::Npwp,
        DocumentKind::Bpjs,
        DocumentKind::Other,
    ];

    pub fn parse(raw: &str) -> Option<Self> {
        let raw = raw.trim().to_ascii_uppercase();
        Self::ALL.into_iter().find(|kind| kind.code() == raw)
    }

    /// Stable wire code.
    pub fn code(self) -> &'static str {
        match self {
            DocumentKind::Photo => "PHOTO",
            DocumentKind::Ktp => "KTP",
            DocumentKind::Kk => "KK",
            DocumentKind::Skck => "SKCK",
            DocumentKind::Contract => "CONTRACT",
            DocumentKind::Npwp => "NPWP",
            DocumentKind::Bpjs => "BPJS",
            DocumentKind::Other => "OTHER",
        }
    }

    /// The KTP and the KK scans are required on every file (owner,
    /// 2026-10-25: "scan ktp, scan kk wajib").
    pub fn required(self) -> bool {
        matches!(self, DocumentKind::Ktp | DocumentKind::Kk)
    }

    /// Whether a file holds one of these at a time, so a new one replaces the
    /// last. Only `OTHER` may pile up.
    pub fn single(self) -> bool {
        !matches!(self, DocumentKind::Other)
    }

    /// Whether a stored file of this content type may be filed as this kind: a
    /// photo is an image, every other paper is an image or a PDF.
    pub fn accepts(self, content_type: &str) -> bool {
        let image = content_type.starts_with("image/");
        match self {
            DocumentKind::Photo => image,
            _ => image || content_type == "application/pdf",
        }
    }
}

/// The required kinds a file does not have, in the order the form asks for
/// them.
pub fn missing_documents(have: &[DocumentKind]) -> Vec<&'static str> {
    DocumentKind::ALL
        .into_iter()
        .filter(|kind| kind.required() && !have.contains(kind))
        .map(DocumentKind::code)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> EmployeeDetails {
        EmployeeDetails {
            birth_place: " Bandung ".into(),
            gender: "female".into(),
            religion: "islam".into(),
            marital_status: "married".into(),
            children: 4,
            blood_type: Some(" ".into()),
            nationality: "wni".into(),
            rt_rw: Some("003/007".into()),
            village: None,
            district: None,
            city: None,
            province: None,
            emergency_name: Some("Siti".into()),
            emergency_relation: Some("Ibu".into()),
            emergency_phone: Some("0812".into()),
        }
    }

    #[test]
    fn a_set_is_trimmed_and_its_codes_upper_cased() {
        let details = sample()
            .validated()
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(details.birth_place, "Bandung");
        assert_eq!(details.gender, "FEMALE");
        assert_eq!(details.blood_type, None);
        assert_eq!(details.ptkp_hint(), "K/3");
    }

    #[test]
    fn half_an_emergency_contact_is_refused() {
        let mut details = sample();
        details.emergency_phone = None;
        assert!(matches!(
            details.validated(),
            Err(EmployeeError::Required {
                field: "emergency_phone"
            })
        ));
    }

    #[test]
    fn the_ktp_and_the_kk_are_the_required_papers() {
        assert_eq!(missing_documents(&[DocumentKind::Ktp]), vec!["KK"]);
        assert!(missing_documents(&[DocumentKind::Kk, DocumentKind::Ktp]).is_empty());
        assert!(!DocumentKind::Photo.accepts("application/pdf"));
        assert!(DocumentKind::Skck.accepts("application/pdf"));
    }
}
