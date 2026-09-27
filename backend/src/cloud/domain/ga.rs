//! What a build is filled in on, and what may go in it.
//!
//! # Why the fields are here and not in the database
//!
//! 0356 put the eleven FORMS on `asset_class.build`, and deliberately did not
//! put their fields anywhere. The reason it gave is the reason this module
//! exists: which keys a form accepts and what shape each value must take is
//! VALIDATION, and validation belongs next to the writer, in Rust, where a
//! wrong value is a sentence somebody reads rather than a row that silently
//! went in.
//!
//! The alternative — a `build_field` table — would put the definition of the
//! form one join away from the code that enforces it, and give a reader two
//! places to look when the two disagree. `fixed_asset.specs` stores the
//! ANSWERS; this module stores the QUESTIONS, and it is the only place either
//! is written.
//!
//! # Why it is also the client's form
//!
//! `GET /api/v1/ga/asset-builds` answers with this same table. That is not a
//! convenience: a browser that drew its own form from its own copy of this list
//! could offer a field the server refuses, or refuse one it would have taken,
//! and the disagreement would only ever be discovered by a person typing
//! something reasonable and being told no. One list, read by both halves.
//!
//! The classes that go with a build come from the register's own table rather
//! than from a list here: `AIR_CONDITIONER`, `LIFT`, `GENSET` and `INSTALASI_ME`
//! are four classes and one form, and the day somebody adds a fifth the form
//! offers it without an edit here.

use serde::{Deserialize, Serialize};

use crate::cloud::application::AppError;
use FieldKind::{Date, Text};

/// The eleven forms, in the order the picker offers them: the things a company
/// owns first — land, the building, the machines, the vehicles — then what it
/// furnishes them with, then the things that are not physical at all.
///
/// The order is asserted by `0356`'s own list and by the client's screen, so it
/// is written once here rather than sorted alphabetically anywhere: an
/// alphabetical list would open the register on `AUDIO`.
pub const BUILDS: [&str; 11] = [
    "LAND", "BUILDING", "TECH", "VEHICLE", "FFE", "IT", "AUDIO", "OE", "SOFTWARE", "DEFERRED", "CIP",
];

/// What a field's value has to BE.
///
/// Three, and there is no fourth: everything the client writes on a form is
/// either a word ("Daikin FTKC50"), a day ("2027-03-14") or a number. The
/// distinction is not cosmetic — a `Date` is what lets a warranty be asked
/// about later without parsing free text, and it is the way a typo is caught at
/// the moment somebody types it rather than a year later when a reminder fires
/// on the wrong day.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FieldKind {
    Text,
    Date,
    Number,
}

impl FieldKind {
    /// The wire spelling, which is what `GET /asset-builds` sends and what a
    /// client switches on to choose an input.
    pub fn as_str(self) -> &'static str {
        match self {
            FieldKind::Text => "TEXT",
            FieldKind::Date => "DATE",
            FieldKind::Number => "NUMBER",
        }
    }
}

/// One field of one form.
///
/// The label is the client's own Indonesian ("Luas tanah", "Garansi s/d"),
/// untranslated for the reason every label in this estate is: the person
/// filling the form in reads the words the department already uses on paper.
#[derive(Clone, Copy, Debug)]
pub struct BuildField {
    /// The key in `fixed_asset.specs` — `plate`, `warranty`, `cert`.
    pub key: &'static str,
    pub label: &'static str,
    pub kind: FieldKind,
    /// Required fields are the ones without which the row does not identify the
    /// thing: a vehicle with no plate is a vehicle nobody can find.
    pub required: bool,
}

/// The fields of one form, or none at all.
///
/// A build with no fields is `SOFTWARE`, `DEFERRED` and `CIP` — a licence, a
/// pre-opening cost and work still being built have no physical facts about
/// them, which is why their `specs` is `{}` and why the form is drawn with no
/// inputs at all rather than with a generic set nobody should fill in.
///
/// An unknown build answers empty too, and that is deliberate rather than lazy:
/// `assert_specs` will then refuse every key it is given, naming the build and
/// the fact that it takes nothing. The alternative — a special "unknown" answer
/// — would need a caller to handle it, and the only caller that can happen is a
/// class whose `build` the database's own CHECK does not allow.
pub fn build_fields(build: &str) -> &'static [BuildField] {
    match build {
        "LAND" => &[
            BuildField { key: "cert", label: "Sertifikat", kind: Text, required: true },
            BuildField { key: "area", label: "Luas tanah", kind: Text, required: false },
            BuildField { key: "expiry", label: "Hak berlaku s/d", kind: Date, required: false },
        ],
        "BUILDING" => &[
            BuildField { key: "area", label: "Luas bangunan", kind: Text, required: false },
            BuildField { key: "floors", label: "Lantai", kind: Text, required: false },
            BuildField { key: "use", label: "Penggunaan", kind: Text, required: false },
        ],
        "TECH" => &[
            BuildField { key: "make", label: "Merek / model", kind: Text, required: true },
            BuildField { key: "capacity", label: "Kapasitas", kind: Text, required: false },
            BuildField { key: "install", label: "Dipasang", kind: Date, required: false },
            BuildField { key: "warranty", label: "Garansi s/d", kind: Date, required: false },
        ],
        "VEHICLE" => &[
            BuildField { key: "make", label: "Merek / model", kind: Text, required: true },
            BuildField { key: "plate", label: "Plat", kind: Text, required: true },
            BuildField { key: "year", label: "Tahun", kind: Text, required: false },
            BuildField { key: "chassis", label: "No. rangka", kind: Text, required: false },
            BuildField { key: "engine", label: "No. mesin", kind: Text, required: false },
            BuildField { key: "odo", label: "Odometer", kind: Text, required: false },
        ],
        "FFE" => &[
            BuildField { key: "type", label: "Jenis", kind: Text, required: false },
            BuildField { key: "material", label: "Material", kind: Text, required: false },
            BuildField { key: "dim", label: "Dimensi", kind: Text, required: false },
        ],
        "IT" => &[
            BuildField { key: "device", label: "Perangkat", kind: Text, required: true },
            BuildField { key: "make", label: "Merek / model", kind: Text, required: false },
            BuildField { key: "spec", label: "Spesifikasi", kind: Text, required: false },
            BuildField { key: "host", label: "Hostname", kind: Text, required: false },
            BuildField { key: "warranty", label: "Garansi s/d", kind: Date, required: false },
        ],
        "AUDIO" => &[
            BuildField { key: "make", label: "Merek / model", kind: Text, required: false },
            BuildField { key: "power", label: "Daya", kind: Text, required: false },
            BuildField { key: "warranty", label: "Garansi s/d", kind: Date, required: false },
        ],
        "OE" => &[
            BuildField { key: "material", label: "Material", kind: Text, required: false },
            BuildField { key: "dim", label: "Ukuran", kind: Text, required: false },
            BuildField { key: "area", label: "Area toko", kind: Text, required: false },
            BuildField { key: "repl", label: "Diganti lewat replacement", kind: Text, required: false },
        ],
        _ => &[],
    }
}

/// What the type is called on a tile: "Tanah", "Peralatan teknis", "Kendaraan".
///
/// The client's own words, the same ones the sidebar and the register's filter
/// already draw, so a build does not have two names in two screens.
pub fn build_label(build: &str) -> &'static str {
    match build {
        "LAND" => "Tanah",
        "BUILDING" => "Bangunan",
        "TECH" => "Peralatan teknis",
        "VEHICLE" => "Kendaraan",
        "FFE" => "Furniture & fixtures",
        "IT" => "Perangkat IT",
        "AUDIO" => "Audio / music",
        "OE" => "Operating equipment",
        "SOFTWARE" => "Software",
        "DEFERRED" => "Pre-opening",
        "CIP" => "Proyek / CIP",
        _ => "",
    }
}

/// The one line under the name on a tile.
///
/// It answers the only question a tile has to: which of the register's
/// fifty-nine classes am I about to be offered. "Instalasi ME, AC, lift,
/// eskalator, genset" tells somebody that a lift is behind this door; a
/// description of what a machine is would not.
pub fn build_note(build: &str) -> &'static str {
    match build {
        "LAND" => "Tanah hak milik, HGB",
        "BUILDING" => "Bangunan utama, tambahan, mess",
        "TECH" => "Instalasi ME, AC, lift, eskalator, genset",
        "VEHICLE" => "Mobil, sepeda motor",
        "FFE" => "Office, toko & gudang, interior, exterior, mess",
        "IT" => "Komputer, laptop, printer",
        "AUDIO" => "Sound system",
        "OE" => "Rak, meja, manekin, hanger",
        "SOFTWARE" => "Lisensi aplikasi",
        "DEFERRED" => "Biaya dibayar di muka",
        "CIP" => "Pekerjaan yang belum jadi aset",
        _ => "",
    }
}

/// The keys every form takes, as a sentence for a refusal.
fn known_keys(fields: &[BuildField]) -> String {
    if fields.is_empty() {
        return "no fields at all".into();
    }
    fields
        .iter()
        .map(|field| field.key)
        .collect::<Vec<_>>()
        .join(", ")
}

fn field_of(build: &str, key: &str) -> Option<&'static BuildField> {
    build_fields(build).iter().find(|field| field.key == key)
}

/// One value, checked against the field it was given for.
///
/// `None` means "there is nothing here" — an absent key, an explicit null, or
/// the empty string. All three are dropped from the result rather than stored,
/// because a `specs` full of empty strings looks full to a reader, to a
/// `jsonb ?` test and to a form that re-fills itself from it, and none of the
/// three means anything.
fn value_for(build: &str, field: &BuildField, value: &serde_json::Value) -> Result<Option<serde_json::Value>, AppError> {
    let raw = match value {
        serde_json::Value::Null => return Ok(None),
        serde_json::Value::String(text) => text.trim().to_string(),
        // A number for a `Text` field is a client that typed into the wrong
        // input; kept as it came rather than stringified, so the refusal below
        // can show what actually arrived.
        other => other.to_string(),
    };
    if raw.is_empty() {
        return Ok(None);
    }
    match field.kind {
        FieldKind::Text => {
            if !value.is_string() {
                return Err(AppError::Validation(format!(
                    "\"{}\" ({}) is text, and {} is not",
                    field.key, field.label, raw
                )));
            }
            Ok(Some(serde_json::Value::String(raw)))
        }
        FieldKind::Date => {
            if !value.is_string() {
                return Err(AppError::Validation(format!(
                    "\"{}\" ({}) is a date as YYYY-MM-DD, and {} is not",
                    field.key, field.label, raw
                )));
            }
            chrono::NaiveDate::parse_from_str(&raw, "%Y-%m-%d").map_err(|_| {
                AppError::Validation(format!(
                    "\"{}\" ({}) is a date as YYYY-MM-DD, and {raw} is not: {build} keeps the \
                     warranty end as a day so it can be asked about, not as something to read",
                    field.key, field.label
                ))
            })?;
            Ok(Some(serde_json::Value::String(raw)))
        }
        FieldKind::Number => {
            let parsed = match value {
                serde_json::Value::Number(number) => number.as_f64(),
                serde_json::Value::String(text) => text.trim().parse::<f64>().ok(),
                _ => None,
            }
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "\"{}\" ({}) is a number, and {raw} is not",
                    field.key, field.label
                ))
            })?;
            let number = serde_json::Number::from_f64(parsed).ok_or_else(|| {
                AppError::Validation(format!(
                    "\"{}\" ({}) is a number, and {raw} is not one",
                    field.key, field.label
                ))
            })?;
            Ok(Some(serde_json::Value::Number(number)))
        }
    }
}

/// Check a build's answers, and answer with what may be stored.
///
/// # The rule, once
///
/// Every row's `specs` is an object whose keys are the build's own field names,
/// and nothing else. The four refusals below are the whole of it:
///
///   * a key the build does not have is refused, naming the keys it does have —
///     this is the one that catches a client drawing a plate field on an air
///     conditioner;
///   * a required field that is empty is refused, because the row does not
///     identify the thing without it;
///   * a `Date` that is not a day, and a `Number` that is not a number;
///   * an empty value is DROPPED rather than stored, so `specs` says what is
///     known instead of what was left blank.
///
/// `null` is accepted as "nothing here" rather than as a type error, because
/// that is what an absent form field serialises to and refusing it would make
/// every client handle its own absence.
pub fn assert_specs(build: &str, specs: &serde_json::Value) -> Result<serde_json::Value, AppError> {
    let fields = build_fields(build);
    // An absent `specs` is an empty form, which is a legitimate answer only
    // when the form has no required field.
    let empty = serde_json::Map::new();
    let given = match specs {
        serde_json::Value::Null => &empty,
        serde_json::Value::Object(map) => map,
        _ => {
            return Err(AppError::Validation(format!(
                "the fields of a {build} are an object, one per field; {} is not an object",
                specs
            )))
        }
    };

    let mut kept = serde_json::Map::new();
    for (key, value) in given {
        let field = field_of(build, key).ok_or_else(|| {
            AppError::Validation(format!(
                "\"{key}\" is not a field of {build}; it takes {}",
                known_keys(fields)
            ))
        })?;
        if let Some(checked) = value_for(build, field, value)? {
            kept.insert(key.clone(), checked);
        }
    }

    let missing: Vec<String> = fields
        .iter()
        .filter(|field| field.required && !kept.contains_key(field.key))
        .map(|field| format!("{} ({})", field.key, field.label))
        .collect();
    if !missing.is_empty() {
        return Err(AppError::Validation(format!(
            "a {build} has to say {}: they are what identifies the thing",
            missing.join(" and ")
        )));
    }

    Ok(serde_json::Value::Object(kept))
}

/// One field, as the client draws it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaBuildField {
    pub key: String,
    pub label: String,
    /// `TEXT`, `DATE` or `NUMBER` — [`FieldKind::as_str`].
    pub kind: String,
    pub required: bool,
}

/// One of the eleven forms, as the client draws it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaBuildSpec {
    pub build: String,
    pub label: String,
    pub note: String,
    /// The register's own class codes filed on this build, by `class_code`.
    ///
    /// It is what stops the class dropdown offering all fifty-nine at once:
    /// four classes are one form, so without this list the class picker on a
    /// vehicle form would offer a lift. Read from `asset_class` and never from
    /// a list here — the table is the list.
    pub classes: Vec<String>,
    pub fields: Vec<GaBuildField>,
}

/// The eleven, in the order they are offered.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaBuildSchema {
    pub builds: Vec<GaBuildSpec>,
}

/// The forms, with the classes each one covers.
///
/// `classes` is `(class_code, build)` pairs read from `asset_class` — passed in
/// rather than read here because this module holds no database handle and
/// should not: what it owns is the shape of an answer, and the register owns
/// which classes exist.
pub fn build_schema(classes: &[(String, String)]) -> GaBuildSchema {
    GaBuildSchema {
        builds: BUILDS
            .iter()
            .map(|build| GaBuildSpec {
                build: (*build).to_string(),
                label: build_label(build).to_string(),
                note: build_note(build).to_string(),
                classes: classes
                    .iter()
                    .filter(|(_, of_build)| of_build == build)
                    .map(|(class_code, _)| class_code.clone())
                    .collect(),
                fields: build_fields(build)
                    .iter()
                    .map(|field| GaBuildField {
                        key: field.key.to_string(),
                        label: field.label.to_string(),
                        kind: field.kind.as_str().to_string(),
                        required: field.required,
                    })
                    .collect(),
            })
            .collect(),
    }
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/// The seventeen kinds of deal, as `(code, client's name, group)` — brief
/// §9.2, in the order the prototype's `TYPES` offers them.
///
/// A constant here rather than a read from `contract_type` on every write,
/// for the reason this module's header gives twice already: which kinds exist
/// is VALIDATION, and the refusal a person reads must come from the same
/// table the validation was written beside. The database keeps the same
/// seventeen (0360 seeds them; the foreign key on `ga_contract.contract_type`
/// is the last word), and this list is what names the seventeen in a refusal
/// and what the register's filter offers before anything is stored. When the
/// client's vocabulary grows, both lists move in one change or the tests say
/// which half was forgotten.
pub const CONTRACT_TYPES: &[(&str, &str, &str)] = &[
    ("SEWA_TANAH", "Sewa tanah", "SEWA"),
    ("SEWA_TOKO", "Sewa toko/gudang/kantor", "SEWA"),
    ("SEWA_RUMAH", "Sewa rumah/mess", "SEWA"),
    ("SEWA_KENDARAAN", "Sewa kendaraan", "SEWA"),
    ("JASA_MAINTENANCE", "Kontrak maintenance", "JASA"),
    ("JASA_CLEANING", "Cleaning", "JASA"),
    ("ASURANSI_PROPERTI", "Asuransi properti", "ASURANSI"),
    ("ASURANSI_KENDARAAN", "Asuransi kendaraan", "ASURANSI"),
    ("IZIN_USAHA", "Izin usaha", "IZIN"),
    ("IZIN_KENDARAAN", "STNK / KIR", "IZIN"),
    ("PAJAK_PBB", "PBB", "IZIN"),
    ("PAJAK_REKLAME", "Pajak reklame", "IZIN"),
    ("LANGGANAN_LISTRIK", "Listrik", "LANGGANAN"),
    ("LANGGANAN_AIR", "Air", "LANGGANAN"),
    ("LANGGANAN_TELEKOM", "Telepon / internet", "LANGGANAN"),
    ("DISEWAKAN_GEDUNG", "Sewa ruang/gedung", "DISEWAKAN"),
    ("DISEWAKAN_PERALATAN", "Sewa peralatan", "DISEWAKAN"),
];

/// The contract types whose deal can honestly cover MORE THAN ONE PLACE —
/// every store at once, or every site — rather than one address on the map.
///
/// A shop lease is about ONE shop; a cleaning service is about every shop the
/// crew walks through, and a property insurance policy is about the building
/// whatever shelf the asset sits on. For the other thirteen types the caller
/// must name the `site_id`, because a subscription that refuses to say which
/// meter it belongs to is a bill nobody can trace. The database cannot hold
/// this list — its CHECK sees columns, not the type's meaning — so it lives
/// beside [`CONTRACT_TYPES`], where the writer that refuses a misplaced
/// scope can quote it.
pub const CONTRACT_SCOPE_TYPES: &[&str] =
    &["SEWA_TOKO", "JASA_MAINTENANCE", "JASA_CLEANING", "ASURANSI_PROPERTI"];

/// The `prepaid_kind` category a type's advance payments land in, as
/// `(contract type, prepaid_kind category)`.
///
/// `prepaid_expense` in `account_link` is sourced by `prepaid_kind` — the
/// family 0287 keeps — and NOT by contract type; two vocabularies on one key
/// would be two languages in one index, and `prepaid_schedule_create` reads
/// only one of them. This is the bridge between the two words. It is a list
/// and not a `format!` suffix because the client's own names do not compose:
/// a maintenance contract pays into KONTRAK_MAINTENANCE_BAYAR_DIMUKA, an
/// izin into BIAYA_IJIN_USAHA_BAYAR_DIMUKA, and both insurance kinds share
/// the one ASURANSI_BAYAR_DIMUKA. A type absent here has no prepaid account —
/// the map simply has nothing for it to resolve to.
pub const CONTRACT_PREPAID_KINDS: &[(&str, &str)] = &[
    ("SEWA_TANAH", "SEWA_TANAH_BAYAR_DIMUKA"),
    ("SEWA_TOKO", "SEWA_TOKO_BAYAR_DIMUKA"),
    ("SEWA_RUMAH", "SEWA_RUMAH_BAYAR_DIMUKA"),
    ("SEWA_KENDARAAN", "SEWA_KENDARAAN_BAYAR_DIMUKA"),
    ("JASA_MAINTENANCE", "KONTRAK_MAINTENANCE_BAYAR_DIMUKA"),
    ("ASURANSI_PROPERTI", "ASURANSI_BAYAR_DIMUKA"),
    ("ASURANSI_KENDARAAN", "ASURANSI_BAYAR_DIMUKA"),
    ("IZIN_USAHA", "BIAYA_IJIN_USAHA_BAYAR_DIMUKA"),
];

/// Where a contract stands TODAY, as the register and the overview read it.
///
/// Pure, and deliberately database-free: the standing is arithmetic on the
/// contract's own window, and a rule this simple is tested directly rather
/// than through a database that could only repeat it.
///
/// The order of the questions is the answer: a TERMINATED contract is
/// DIHENTIKAN even inside its window, because a deal somebody ended is not
/// "about to end" — the ending already happened. A contract that has not
/// started is BELUM_MULAI even if its window is short. Then, and only then,
/// the window: past the end is HABIS, within the contract's OWN
/// `reminder_days` of it is SEGERA_HABIS, and everything else is AKTIF. A
/// contract with no end is AKTIF forever, which is what "no end" means.
///
/// `days_to_end` is the raw count — negative once the end has passed, absent
/// when there is no end — because a screen that wants "3 hari lagi" and a
/// screen that wants "12 hari terlambat" read the same number.
pub fn contract_standing(
    status: &str,
    starts_on: chrono::NaiveDate,
    ends_on: Option<chrono::NaiveDate>,
    reminder_days: i32,
    today: chrono::NaiveDate,
) -> (&'static str, Option<i64>) {
    let days_to_end = ends_on.map(|end| (end - today).num_days());
    match status {
        "DRAFT" => ("DRAFT", days_to_end),
        "TERMINATED" => ("DIHENTIKAN", days_to_end),
        _ if today < starts_on => ("BELUM_MULAI", days_to_end),
        _ => match days_to_end {
            None => ("AKTIF", None),
            Some(days) if days < 0 => ("HABIS", Some(days)),
            Some(days) if days <= i64::from(reminder_days) => ("SEGERA_HABIS", Some(days)),
            Some(days) => ("AKTIF", Some(days)),
        },
    }
}

// ---------------------------------------------------------------------------
// Maintenance: the objects a repair is charged to, the ladder it climbs, and
// the day its service next comes due
// ---------------------------------------------------------------------------

/// The three interval units a maintenance task may be scheduled in — brief §6's
/// "hari/bulan/km". Written here rather than read per write for the same reason
/// [`CONTRACT_TYPES`] is: it is the list a refusal names.
pub const TASK_INTERVAL_KINDS: &[&str] = &["DAYS", "MONTHS", "KM"];

/// The words an inspection's result may take. The client's own three (brief §6),
/// in the order a walk-round sheet offers them.
pub const INSPECTION_RESULTS: &[&str] = &["BAIK", "PERHATIAN", "RUSAK"];

/// The repair ladder's rungs, in order. The MOVES between them are
/// [`repair_may_move`]; this list only names the vocabulary.
pub const REPAIR_STATUSES: &[&str] =
    &["OPEN", "APPROVED", "IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED"];

/// The replacement ladder's rungs, in order.
pub const REPLACEMENT_STATUSES: &[&str] =
    &["PROPOSED", "APPROVED", "PURCHASED", "INSTALLED", "CLOSED"];

/// The disposal ladder's rungs, in order.
pub const DISPOSAL_STATUSES: &[&str] = &["REQUESTED", "APPROVED", "POSTED", "REJECTED"];

/// The four ways a thing can leave the register (brief §6).
pub const DISPOSAL_METHODS: &[&str] = &["SOLD", "SCRAPPED", "DONATED", "LOST"];

/// The repair object a class's repairs are charged to, or `None` when the class
/// does not say.
///
/// # Why the object is derived and not typed
///
/// Every repair carries an `objek`, and the person filing one should not have to
/// answer "which expense account is this" — GA names the KIND of thing, and
/// Finance's map turns the kind into an account. When the repair is on an asset,
/// the class already says what kind of thing it is, so the object is DERIVED
/// from the class and the person confirms rather than chooses.
///
/// # Why it takes two arguments
///
/// `class_code` is specific and `class_kind` is the fallback for the classes
/// that are one thing told many ways: the thirty-six operating-equipment
/// sub-types (`OE_RAK_1`, `OE_PATUNG_KEPALA_ANAK`, ...) share one object, and
/// the thirty-seventh is the same thing again. Reading them by prefix would
/// mean enumerating a list that grows; the class's own `kind` says it once.
///
/// An unknown class answers `None` and the CALLER decides — a repair with no
/// asset, or on a class nobody has mapped, lets a person pick the object by
/// hand rather than guessing an account.
///
/// The mapping is 0360's `ga_repair_object` vocabulary and the prototype's
/// `CLASSES[].objek`; the `FFE_*` family is caught last so its two exceptions
/// (`FFE_KOMPUTER`, `FFE_STAFF_HOUSE_MESS`) are named before the general rule.
pub fn repair_object_for_class(class_kind: &str, class_code: &str) -> Option<&'static str> {
    let kind = class_kind.trim().to_ascii_uppercase();
    let code = class_code.trim().to_ascii_uppercase();
    // Operating equipment is one thing across its thirty-six classes.
    if kind == "OE" {
        return Some("FFE");
    }
    match code.as_str() {
        "AIR_CONDITIONER" => Some("AC"),
        "LIFT" | "ESKALATOR" => Some("LIFT"),
        "GENSET" => Some("POWER_PLANT"),
        "MOBIL" | "SEPEDA_MOTOR" => Some("KENDARAAN"),
        // The two FFE exceptions, named before the `FFE_*` catch below.
        "FFE_KOMPUTER" => Some("KOMPUTER"),
        "FFE_STAFF_HOUSE_MESS" | "BANGUNAN_STAFF_HOUSE_MESS" => Some("STAFF_HOUSE"),
        "SEVENTH_SOFT_APPLICATION" | "OPTI_TEX_SYSTEM" => Some("SOFTWARE"),
        "INSTALASI_MEKANIKAL_ELEKTRIKAL" | "BANGUNAN_UTAMA" | "BANGUNAN_TAMBAHAN"
        | "TANAH_HAK_MILIK" | "HAK_SEWA_TANAH_HGB" => Some("BANGUNAN"),
        _ if code.starts_with("FFE_") => Some("FFE"),
        _ if kind == "INTANGIBLE" => Some("SOFTWARE"),
        _ => None,
    }
}

/// Whether a repair may move from one state to the next.
///
/// # Why this is not a CHECK
///
/// A CHECK can say which states EXIST; it cannot say which move is legal,
/// because that depends on where the row has been. The ladder is one-way and
/// its two ends are terminal: CLOSED is done, CANCELLED was abandoned, and
/// neither climbs back. CANCELLED comes off the three live rungs — a completed
/// repair is not cancelled after the fact, it is corrected by a new repair.
///
/// Pure and deliberately database-free, so the whole matrix can be tested
/// directly rather than through a database that could only repeat it.
pub fn repair_may_move(from: &str, to: &str) -> bool {
    let from = from.trim().to_ascii_uppercase();
    let to = to.trim().to_ascii_uppercase();
    matches!(
        (from.as_str(), to.as_str()),
        ("OPEN", "APPROVED")
            | ("OPEN", "CANCELLED")
            | ("APPROVED", "IN_PROGRESS")
            | ("APPROVED", "CANCELLED")
            | ("IN_PROGRESS", "COMPLETED")
            | ("IN_PROGRESS", "CANCELLED")
            | ("COMPLETED", "CLOSED")
    )
}

/// The day a task's service comes due, given its interval and the day it is
/// being counted from.
///
/// # Why KM has no date
///
/// A day interval and a month interval are arithmetic on a calendar and this
/// answers both. `KM` is a DISTANCE, and a distance becomes a date only when
/// somebody divides it by an odometer reading this system does not hold — so
/// the honest answer is `None`, and the screen shows "by distance" rather than
/// a date it would have had to invent. An unknown kind or a non-positive
/// interval answers `None` for the same reason: it cannot say when.
///
/// `checked_add_months` and `checked_add_days` answer `None` on overflow rather
/// than panicking, which is the one thing a date arithmetic must not do.
pub fn next_due_from(
    interval_kind: &str,
    interval_value: i32,
    from: chrono::NaiveDate,
) -> Option<chrono::NaiveDate> {
    if interval_value <= 0 {
        return None;
    }
    match interval_kind.trim().to_ascii_uppercase().as_str() {
        "DAYS" => from.checked_add_days(chrono::Days::new(u64::try_from(interval_value).ok()?)),
        "MONTHS" => from.checked_add_months(chrono::Months::new(u32::try_from(interval_value).ok()?)),
        // KM, and anything unknown: no odometer, no date.
        _ => None,
    }
}
