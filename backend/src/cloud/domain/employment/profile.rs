//! What we know about the person, and who last changed it.
//!
//! # Why this is not a struct of plain fields
//!
//! Every value here is either a legal identity (`NIK`), something a payslip or
//! a BPJS filing is addressed to, or something an audit will one day ask about.
//! The failure mode is not a bad value arriving — it is a value being **quietly
//! replaced**. A changed bank account nobody noticed is the oldest payroll
//! fraud there is, and the version of it that works is the one where the field
//! is a column and the update leaves no trace.
//!
//! So a profile is not overwritten. [`Profile::amend`] appends a
//! [`ProfileAmendment`] naming what changed, who changed it and why, and the
//! current value is the fold of those amendments over the original. The same
//! shape the reference uses for `EmployeeCodeCorrection`, applied to the fields
//! that actually carry risk.
//!
//! # What is deliberately not validated
//!
//! Names. There is no length-16 rule for a human name, no character class that
//! is safe to reject, and no reordering into "first" and "last" that survives
//! contact with Indonesian names — many people have one name, and it is not a
//! surname. [`FullName`] is therefore one bounded, printable, non-empty string
//! and nothing more. A validator that rejects a real person's real name is
//! worse than no validator.
//!
//! Addresses, likewise: one bounded block of text. Parsing an address into
//! fields is a project, and every field it invents is a field that will be
//! wrong for somebody.

use super::audit::Authorization;
use super::error::EmployeeError;
use super::ids::validated_text;
use chrono::NaiveDate;

/// Bounded maximum length of a person's name.
pub const MAX_NAME_LEN: usize = 140;
/// Bounded maximum length of an address block.
pub const MAX_ADDRESS_LEN: usize = 500;
/// Bounded maximum length of a contact value.
pub const MAX_CONTACT_LEN: usize = 120;
/// Exact length of an Indonesian NIK.
pub const NIK_LEN: usize = 16;

/// A person's name, as they give it.
///
/// One field on purpose — see the module docs.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct FullName(String);

impl FullName {
    /// Validate a name: trimmed, non-empty, printable, bounded.
    pub fn try_new(raw: &str) -> Result<Self, EmployeeError> {
        validated_text("name", raw, MAX_NAME_LEN).map(FullName)
    }

    /// The name as given.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for FullName {
    type Error = EmployeeError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        FullName::try_new(&value)
    }
}

impl From<FullName> for String {
    fn from(value: FullName) -> String {
        value.0
    }
}

/// An Indonesian **Nomor Induk Kependudukan**: exactly sixteen digits.
///
/// # Why the check stops at sixteen digits
///
/// The NIK encodes a province, a regency, a district, a birth date and a
/// sequence, and the birth date has 40 added to the day for women. All of that
/// is *decodable*, and none of it is ours to decode: a person's gender and
/// birthplace are not facts to infer from an identifier when the person can
/// simply be asked, and a mismatch between the decoded value and the recorded
/// one is far more likely to be a data-entry slip in the NIK than a lie about
/// the birthday. Deriving would turn one wrong digit into a wrong gender on a
/// BPJS filing.
///
/// The digits are also **not** unique in practice — duplicate NIKs exist in the
/// national registry — so nothing keys on this value. It is recorded because
/// statutory filings ask for it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Nik(String);

impl Nik {
    /// Validate a NIK: exactly sixteen ASCII digits, after trimming.
    pub fn try_new(raw: &str) -> Result<Self, EmployeeError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(EmployeeError::Required { field: "nik" });
        }
        if trimmed.len() != NIK_LEN || !trimmed.bytes().all(|b| b.is_ascii_digit()) {
            return Err(EmployeeError::MalformedNik);
        }
        Ok(Nik(trimmed.to_owned()))
    }

    /// The sixteen digits.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for Nik {
    type Error = EmployeeError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Nik::try_new(&value)
    }
}

impl From<Nik> for String {
    fn from(value: Nik) -> String {
        value.0
    }
}

/// A bounded, printable contact value — a phone number, an email address.
///
/// Not parsed into a scheme. A regex that decides what an email address looks
/// like is a regex that eventually refuses a real one, and the only test that
/// matters is whether a message sent to it arrives.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Contact(String);

impl Contact {
    /// Validate a contact value: trimmed, non-empty, printable, bounded.
    pub fn try_new(raw: &str) -> Result<Self, EmployeeError> {
        validated_text("contact", raw, MAX_CONTACT_LEN).map(Contact)
    }

    /// The contact value.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for Contact {
    type Error = EmployeeError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Contact::try_new(&value)
    }
}

impl From<Contact> for String {
    fn from(value: Contact) -> String {
        value.0
    }
}

/// A postal address, as one bounded block of text. See the module docs for why
/// it is not parsed into fields.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Address(String);

impl Address {
    /// Validate an address: trimmed, non-empty, printable, bounded. Newlines
    /// are permitted, because an address has lines.
    pub fn try_new(raw: &str) -> Result<Self, EmployeeError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(EmployeeError::Required { field: "address" });
        }
        if trimmed
            .chars()
            .any(|ch| ch.is_control() && ch != '\n' && ch != '\r')
        {
            return Err(EmployeeError::NotPrintable { field: "address" });
        }
        if trimmed.chars().count() > MAX_ADDRESS_LEN {
            return Err(EmployeeError::TooLong {
                field: "address",
                max: MAX_ADDRESS_LEN,
            });
        }
        Ok(Address(trimmed.to_owned()))
    }

    /// The address text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for Address {
    type Error = EmployeeError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Address::try_new(&value)
    }
}

impl From<Address> for String {
    fn from(value: Address) -> String {
        value.0
    }
}

/// Which part of a profile an amendment changed.
///
/// An enum rather than a diff of two whole profiles, so the audit answers
/// "who changed the bank-facing name?" without a reader having to compare two
/// JSON blobs and hope they spot it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "field", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProfileChange {
    /// The person's name.
    Name {
        /// What it was.
        from: FullName,
        /// What it became.
        to: FullName,
    },
    /// The NIK. Changed only to fix a transcription error — a person does not
    /// get a new one.
    Nik {
        /// What it was.
        from: Nik,
        /// What it became.
        to: Nik,
    },
    /// The date of birth. Also a correction, never an event.
    BirthDate {
        /// What it was.
        from: NaiveDate,
        /// What it became.
        to: NaiveDate,
    },
    /// The address. This one genuinely changes: people move.
    Address {
        /// What it was.
        from: Address,
        /// What it became.
        to: Address,
    },
    /// The phone number.
    Phone {
        /// What it was, if anything was recorded.
        from: Option<Contact>,
        /// What it became.
        to: Option<Contact>,
    },
    /// The email address.
    Email {
        /// What it was, if anything was recorded.
        from: Option<Contact>,
        /// What it became.
        to: Option<Contact>,
    },
}

impl ProfileChange {
    /// Stable wire code for the field this change touched.
    pub fn field(&self) -> &'static str {
        match self {
            ProfileChange::Name { .. } => "NAME",
            ProfileChange::Nik { .. } => "NIK",
            ProfileChange::BirthDate { .. } => "BIRTH_DATE",
            ProfileChange::Address { .. } => "ADDRESS",
            ProfileChange::Phone { .. } => "PHONE",
            ProfileChange::Email { .. } => "EMAIL",
        }
    }

    /// Did this change actually change anything?
    ///
    /// A no-op amendment is refused rather than recorded: an audit trail whose
    /// entries may say nothing is an audit trail nobody reads.
    fn is_effective(&self) -> bool {
        match self {
            ProfileChange::Name { from, to } => from != to,
            ProfileChange::Nik { from, to } => from != to,
            ProfileChange::BirthDate { from, to } => from != to,
            ProfileChange::Address { from, to } => from != to,
            ProfileChange::Phone { from, to } => from != to,
            ProfileChange::Email { from, to } => from != to,
        }
    }
}

/// One recorded change to a profile: what, by whom, and why.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileAmendment {
    change: ProfileChange,
    authorization: Authorization,
}

impl ProfileAmendment {
    /// What changed.
    pub fn change(&self) -> &ProfileChange {
        &self.change
    }

    /// Who changed it, and why.
    pub fn authorization(&self) -> &Authorization {
        &self.authorization
    }
}

/// The personal data held about one employee.
///
/// Current values plus the append-only list of amendments that produced them.
/// Decoding goes through [`Profile::try_new`], which re-checks that the
/// amendment chain actually leads to the current values — so a row edited by
/// hand, with the history left alone, fails to load rather than becoming the
/// answer. That is the same guarantee [`super::Employee`] gives for employment
/// status, for the same reason.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    name: FullName,
    nik: Nik,
    birth_date: NaiveDate,
    address: Address,
    phone: Option<Contact>,
    email: Option<Contact>,
    amendments: Vec<ProfileAmendment>,
}

/// Deserialization shim: a stored profile is re-validated on the way in.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileWire {
    name: FullName,
    nik: Nik,
    birth_date: NaiveDate,
    address: Address,
    #[serde(default)]
    phone: Option<Contact>,
    #[serde(default)]
    email: Option<Contact>,
    #[serde(default)]
    amendments: Vec<ProfileAmendment>,
}

impl<'de> serde::Deserialize<'de> for Profile {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = ProfileWire::deserialize(deserializer)?;
        Profile::try_new(
            wire.name,
            wire.nik,
            wire.birth_date,
            wire.address,
            wire.phone,
            wire.email,
            wire.amendments,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl Profile {
    /// Record a person for the first time. No amendments yet, by definition.
    pub fn enrol(name: FullName, nik: Nik, birth_date: NaiveDate, address: Address) -> Self {
        Profile {
            name,
            nik,
            birth_date,
            address,
            phone: None,
            email: None,
            amendments: Vec::new(),
        }
    }

    /// Rebuild a stored profile, re-running the chain check.
    ///
    /// Every amendment's `from` must equal what the chain held for that field
    /// at that point, and the last value of each amended field must equal the
    /// current one. A profile whose current name nobody is recorded as having
    /// set does not load.
    pub fn try_new(
        name: FullName,
        nik: Nik,
        birth_date: NaiveDate,
        address: Address,
        phone: Option<Contact>,
        email: Option<Contact>,
        amendments: Vec<ProfileAmendment>,
    ) -> Result<Self, EmployeeError> {
        // Replay forwards from the *first* recorded `from` of each field, then
        // check the result is what the record claims.
        let mut names: Vec<&FullName> = Vec::new();
        let mut niks: Vec<&Nik> = Vec::new();
        let mut births: Vec<NaiveDate> = Vec::new();
        let mut addresses: Vec<&Address> = Vec::new();
        let mut phones: Vec<&Option<Contact>> = Vec::new();
        let mut emails: Vec<&Option<Contact>> = Vec::new();

        for amendment in &amendments {
            // The gate the live path applies, applied again on the way in. A
            // rule only `amend` enforces is a rule that a round trip through
            // storage removes — and an amendment nobody had the grant to make
            // is not history, it is a defect.
            if !amendment.authorization.authorizes_profile_change() {
                return Err(EmployeeError::ActionForbidsProfileChange {
                    action_key: amendment.authorization.action_key().to_owned(),
                });
            }
            if !amendment.change.is_effective() {
                return Err(EmployeeError::ProfileAmendmentChangesNothing {
                    field: amendment.change.field(),
                });
            }
            match &amendment.change {
                ProfileChange::Name { from, to } => {
                    check_link(names.last().copied(), from, amendment.change.field())?;
                    names.push(to);
                }
                ProfileChange::Nik { from, to } => {
                    check_link(niks.last().copied(), from, amendment.change.field())?;
                    niks.push(to);
                }
                ProfileChange::BirthDate { from, to } => {
                    check_link(births.last(), from, amendment.change.field())?;
                    births.push(*to);
                }
                ProfileChange::Address { from, to } => {
                    check_link(addresses.last().copied(), from, amendment.change.field())?;
                    addresses.push(to);
                }
                ProfileChange::Phone { from, to } => {
                    check_link(phones.last().copied(), from, amendment.change.field())?;
                    phones.push(to);
                }
                ProfileChange::Email { from, to } => {
                    check_link(emails.last().copied(), from, amendment.change.field())?;
                    emails.push(to);
                }
            }
        }

        check_final(names.last().copied(), &name, "NAME")?;
        check_final(niks.last().copied(), &nik, "NIK")?;
        check_final(births.last(), &birth_date, "BIRTH_DATE")?;
        check_final(addresses.last().copied(), &address, "ADDRESS")?;
        check_final(phones.last().copied(), &phone, "PHONE")?;
        check_final(emails.last().copied(), &email, "EMAIL")?;

        Ok(Profile {
            name,
            nik,
            birth_date,
            address,
            phone,
            email,
            amendments,
        })
    }

    /// Apply a change, recording who made it and why.
    ///
    /// The caller states only the new value; the `from` half is read from the
    /// profile itself, so an amendment cannot claim a previous value the record
    /// never held.
    pub fn amend(
        &mut self,
        to: ProfileField,
        authorization: Authorization,
    ) -> Result<&ProfileAmendment, EmployeeError> {
        if !authorization.authorizes_profile_change() {
            return Err(EmployeeError::ActionForbidsProfileChange {
                action_key: authorization.action_key().to_owned(),
            });
        }
        let change = match to {
            ProfileField::Name(to) => ProfileChange::Name {
                from: self.name.clone(),
                to,
            },
            ProfileField::Nik(to) => ProfileChange::Nik {
                from: self.nik.clone(),
                to,
            },
            ProfileField::BirthDate(to) => ProfileChange::BirthDate {
                from: self.birth_date,
                to,
            },
            ProfileField::Address(to) => ProfileChange::Address {
                from: self.address.clone(),
                to,
            },
            ProfileField::Phone(to) => ProfileChange::Phone {
                from: self.phone.clone(),
                to,
            },
            ProfileField::Email(to) => ProfileChange::Email {
                from: self.email.clone(),
                to,
            },
        };
        if !change.is_effective() {
            return Err(EmployeeError::ProfileAmendmentChangesNothing {
                field: change.field(),
            });
        }
        match &change {
            ProfileChange::Name { to, .. } => self.name = to.clone(),
            ProfileChange::Nik { to, .. } => self.nik = to.clone(),
            ProfileChange::BirthDate { to, .. } => self.birth_date = *to,
            ProfileChange::Address { to, .. } => self.address = to.clone(),
            ProfileChange::Phone { to, .. } => self.phone = to.clone(),
            ProfileChange::Email { to, .. } => self.email = to.clone(),
        }
        self.amendments.push(ProfileAmendment {
            change,
            authorization,
        });
        Ok(&self.amendments[self.amendments.len() - 1])
    }

    /// The current name.
    pub fn name(&self) -> &FullName {
        &self.name
    }
    /// The current NIK.
    pub fn nik(&self) -> &Nik {
        &self.nik
    }
    /// The recorded date of birth.
    pub fn birth_date(&self) -> NaiveDate {
        self.birth_date
    }
    /// The current address.
    pub fn address(&self) -> &Address {
        &self.address
    }
    /// The current phone number, if one is recorded.
    pub fn phone(&self) -> Option<&Contact> {
        self.phone.as_ref()
    }
    /// The current email address, if one is recorded.
    pub fn email(&self) -> Option<&Contact> {
        self.email.as_ref()
    }
    /// Every recorded change, oldest first.
    pub fn amendments(&self) -> &[ProfileAmendment] {
        &self.amendments
    }

    /// The person's age on a given date, in whole years.
    ///
    /// Supplied rather than computed from "today": this crate has no clock, and
    /// an age is only ever asked as of some date that matters — a contract
    /// start, a payroll period, a statutory threshold.
    pub fn age_on(&self, date: NaiveDate) -> i32 {
        use chrono::Datelike;
        let mut age = date.year() - self.birth_date.year();
        if (date.month(), date.day()) < (self.birth_date.month(), self.birth_date.day()) {
            age -= 1;
        }
        age
    }
}

/// The new value for one profile field, as handed to [`Profile::amend`].
///
/// One variant per field so a caller cannot pass "here is a whole new profile"
/// and have the kernel work out what moved — which is how a change to two
/// fields ends up recorded as a change to one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileField {
    /// A new name.
    Name(FullName),
    /// A corrected NIK.
    Nik(Nik),
    /// A corrected date of birth.
    BirthDate(NaiveDate),
    /// A new address.
    Address(Address),
    /// A new phone number, or none.
    Phone(Option<Contact>),
    /// A new email address, or none.
    Email(Option<Contact>),
}

fn check_link<T: PartialEq>(
    previous: Option<&T>,
    claimed_from: &T,
    field: &'static str,
) -> Result<(), EmployeeError> {
    match previous {
        // The first amendment to a field may claim any `from`: the value before
        // it is the enrolment value, which the record no longer holds.
        None => Ok(()),
        Some(actual) if actual == claimed_from => Ok(()),
        Some(_) => Err(EmployeeError::ProfileHistoryBroken { field }),
    }
}

fn check_final<T: PartialEq>(
    last: Option<&T>,
    current: &T,
    field: &'static str,
) -> Result<(), EmployeeError> {
    match last {
        // Never amended: the current value is the enrolment value.
        None => Ok(()),
        Some(produced) if produced == current => Ok(()),
        Some(_) => Err(EmployeeError::ProfileHistoryBroken { field }),
    }
}
