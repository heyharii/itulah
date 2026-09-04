//! What a report is allowed to be about.
//!
//! Every dataset, dimension and measure a spec may name is declared here, and
//! nothing outside this file ever reaches SQL. That is the whole safety
//! argument: a spec is a set of *keys*, the keys are looked up here, and the
//! SQL that runs is assembled from the fragments below plus bound parameters.
//! A spec naming something that is not here is refused before a query is built,
//! so there is no path from a sentence somebody typed to a table nobody meant
//! to expose.
//!
//! It is also the contract three readers share: the model picks from it when
//! it composes a report, the server validates against it, and the browser draws
//! its columns from it. One declaration, because the version where each of them
//! keeps a copy is the version where a renamed column is wrong in two of the
//! three.

/// Bumped when a dataset, dimension or measure is added, renamed or removed.
///
/// Stamped on every saved version. A spec written against an older catalogue
/// still runs — validation is what decides that, not this number — but this is
/// what lets "which reports predate the colour split" be asked at all.
///
/// 2 — the `member` dataset, which is also what a saved segment is defined
/// over.
pub const CATALOGUE_VERSION: i32 = 2;

/// What kind of question a column can be asked.
///
/// Deliberately not the SQL type: `site_id` and a memo are both text, but one
/// is a closed set you pick from and the other is prose you search. This is the
/// same vocabulary the browser's filter bar uses (`lib/filters.ts`), spelled
/// the same way, because the two ends have to agree on which operators a column
/// even offers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Text,
    Option,
    Number,
    Date,
    Boolean,
}

/// How a figure is drawn. Money is the one that matters: these are integers in
/// the smallest unit the currency actually uses, and for rupiah that is the
/// rupiah — the browser's `money()` prints the integer as-is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Money,
    Count,
    Percent,
}

pub struct Dimension {
    /// What a spec names it. Stable; renaming one is a catalogue version.
    pub key: &'static str,
    pub label: &'static str,
    /// The SQL expression, written against the dataset's own aliases.
    pub sql: &'static str,
    pub kind: Kind,
}

pub struct Measure {
    pub key: &'static str,
    pub label: &'static str,
    /// A complete aggregate expression. Written out rather than composed from
    /// an `agg` plus a column so that a measure like "unit per struk" — a ratio
    /// of two aggregates — is expressible without inventing a second language.
    pub sql: &'static str,
    pub format: Format,
}

pub struct Dataset {
    pub name: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    /// `FROM` and its joins. Every expression above is written against these
    /// aliases, and this string never contains anything a caller supplied.
    pub source: &'static str,
    /// Always true for this dataset, whatever the spec says.
    ///
    /// It is what makes a dataset mean something: `sale_line` is *what was
    /// sold*, so a basket somebody abandoned at the till is not in it, and no
    /// filter can put it back. A dataset whose meaning depends on the reader
    /// remembering to add a filter is a dataset that will be reported wrongly.
    pub base_where: Option<&'static str>,
    /// The column a period is measured against.
    pub time: &'static str,
    pub dimensions: &'static [Dimension],
    pub measures: &'static [Measure],
}

impl Dataset {
    pub fn dimension(&self, key: &str) -> Option<&'static Dimension> {
        self.dimensions.iter().find(|column| column.key == key)
    }

    pub fn measure(&self, key: &str) -> Option<&'static Measure> {
        self.measures.iter().find(|column| column.key == key)
    }
}

pub fn dataset(name: &str) -> Option<&'static Dataset> {
    DATASETS.iter().find(|dataset| dataset.name == name)
}

pub fn datasets() -> &'static [Dataset] {
    DATASETS
}

/// The datasets, in the order a menu should offer them.
///
/// Three to begin with, chosen because between them they answer most of what
/// people actually ask: what sold, what a till took, and how it was paid for.
/// Adding the fourth is this file plus a catalogue version — no new endpoint,
/// no new screen, no new query written by hand.
///
/// The fourth is `member`, and it arrived exactly that way. It is the odd one
/// out in that its rows are people rather than trade, which is why it is last:
/// somebody opening the dataset menu to ask what sold should not have to step
/// past the customer list to get there.
static DATASETS: &[Dataset] = &[SALE_LINE, SALE, SALE_PAYMENT, MEMBER];

/// What was sold, line by line.
///
/// Completed sales only, by `base_where`: an open basket is not trade and a
/// voided one was undone. Use the `sale` dataset for questions about voids.
const SALE_LINE: Dataset = Dataset {
    name: "sale_line",
    title: "Baris penjualan",
    description: "Setiap baris dari penjualan yang selesai, dengan artikel, \
warna, ukuran, divisi dan toko. Dataset untuk terlaris, kurva ukuran, dan \
matriks artikel × toko.",
    source: "FROM sale_line sl
             JOIN sale s ON s.id = sl.sale_id
             LEFT JOIN sku ON sku.id = sl.sku_id
             LEFT JOIN article a ON a.id = sku.article_id
             LEFT JOIN division dv ON dv.code = a.division_code
             LEFT JOIN article_colour ac
                    ON ac.article_id = sku.article_id
                   AND ac.colour_digit = sku.colour_digit
             LEFT JOIN colour co ON co.code = ac.colour_code
             LEFT JOIN size_code sz ON sz.code = sku.size_code
             LEFT JOIN site si ON si.id = s.site_id",
    base_where: Some("s.status = 'COMPLETED'"),
    time: "s.completed_at",
    dimensions: &[
        Dimension { key: "site_id", label: "Toko", sql: "s.site_id", kind: Kind::Option },
        Dimension { key: "site_name", label: "Nama toko", sql: "COALESCE(si.name, s.site_id)", kind: Kind::Option },
        Dimension { key: "site_kind", label: "Jenis lokasi", sql: "si.kind", kind: Kind::Option },
        Dimension { key: "channel", label: "Channel", sql: "s.channel", kind: Kind::Option },
        Dimension { key: "article_code", label: "Kode artikel", sql: "a.article_code", kind: Kind::Option },
        Dimension { key: "article_name", label: "Nama artikel", sql: "a.name", kind: Kind::Text },
        Dimension { key: "division_code", label: "Divisi", sql: "a.division_code", kind: Kind::Option },
        Dimension { key: "division_label", label: "Nama divisi", sql: "dv.label", kind: Kind::Option },
        // Colour and size resolve through two eras of this schema at once. A
        // SKU minted before the colour master carries free text; one minted
        // after carries a per-article digit that resolves through
        // `article_colour` to a master code. Both are the garment's colour, so
        // the dimension coalesces rather than reporting half the catalogue as
        // blank — which is what a join to the master alone would do.
        Dimension { key: "colour", label: "Warna", sql: "COALESCE(co.label, ac.label, sku.color)", kind: Kind::Option },
        Dimension { key: "colour_code", label: "Kode warna", sql: "ac.colour_code", kind: Kind::Option },
        Dimension { key: "size", label: "Ukuran", sql: "COALESCE(sz.label, sku.size)", kind: Kind::Option },
        Dimension { key: "size_code", label: "Kode ukuran", sql: "sku.size_code", kind: Kind::Option },
        Dimension { key: "sku_code", label: "SKU", sql: "sku.sku_code", kind: Kind::Option },
        Dimension { key: "tax_category", label: "Kategori pajak", sql: "sl.tax_category", kind: Kind::Option },
        Dimension { key: "commercial_version", label: "Versi commercial", sql: "sl.commercial_version::text", kind: Kind::Option },
        Dimension { key: "cashier", label: "Kasir", sql: "s.actor_id", kind: Kind::Option },
    ],
    measures: &[
        Measure { key: "gross", label: "Bruto", sql: "COALESCE(SUM(sl.total_minor), 0)", format: Format::Money },
        Measure { key: "net", label: "Net", sql: "COALESCE(SUM(sl.net_minor), 0)", format: Format::Money },
        Measure { key: "tax", label: "Pajak", sql: "COALESCE(SUM(sl.tax_minor), 0)", format: Format::Money },
        Measure { key: "units", label: "Unit", sql: "COALESCE(SUM(sl.quantity), 0)", format: Format::Count },
        Measure { key: "lines", label: "Baris", sql: "COUNT(*)", format: Format::Count },
        Measure { key: "sales", label: "Struk", sql: "COUNT(DISTINCT sl.sale_id)", format: Format::Count },
        Measure { key: "articles", label: "Artikel unik", sql: "COUNT(DISTINCT a.article_code)", format: Format::Count },
        // A ratio of two aggregates, which is why measures carry whole
        // expressions. `NULLIF` rather than a guard in the caller: a bucket
        // with no sales is empty, not a division by zero.
        Measure {
            key: "units_per_sale",
            label: "Unit per struk",
            sql: "ROUND(COALESCE(SUM(sl.quantity), 0)::numeric / NULLIF(COUNT(DISTINCT sl.sale_id), 0), 2)",
            format: Format::Count,
        },
    ],
};

/// What each till took, receipt by receipt.
///
/// Unfiltered on purpose: `status` is a dimension here, so voids and abandoned
/// baskets are reportable — which is the whole reason this dataset exists
/// beside `sale_line`.
const SALE: Dataset = Dataset {
    name: "sale",
    title: "Struk",
    description: "Satu baris per penjualan, termasuk yang void dan yang masih \
terbuka. Dataset untuk jam sibuk, void per kasir, dan nilai rata-rata struk.",
    source: "FROM sale s
             LEFT JOIN site si ON si.id = s.site_id",
    base_where: None,
    time: "s.created_at",
    dimensions: &[
        Dimension {
            key: "site_id",
            label: "Toko",
            sql: "s.site_id",
            kind: Kind::Option,
        },
        Dimension {
            key: "site_name",
            label: "Nama toko",
            sql: "COALESCE(si.name, s.site_id)",
            kind: Kind::Option,
        },
        Dimension {
            key: "site_kind",
            label: "Jenis lokasi",
            sql: "si.kind",
            kind: Kind::Option,
        },
        Dimension {
            key: "channel",
            label: "Channel",
            sql: "s.channel",
            kind: Kind::Option,
        },
        Dimension {
            key: "status",
            label: "Status",
            sql: "s.status",
            kind: Kind::Option,
        },
        Dimension {
            key: "cashier",
            label: "Kasir",
            sql: "s.actor_id",
            kind: Kind::Option,
        },
        Dimension {
            key: "currency",
            label: "Mata uang",
            sql: "s.currency::text",
            kind: Kind::Option,
        },
        Dimension {
            key: "commercial_version",
            label: "Versi commercial",
            sql: "s.commercial_version::text",
            kind: Kind::Option,
        },
        // Local hour and weekday, on the business clock rather than UTC — the
        // offset is bound as a parameter, so "jam sibuk" means the hour the
        // shop was actually busy.
        Dimension {
            key: "hour",
            label: "Jam",
            sql: "to_char(s.created_at + make_interval(mins => $OFFSET), 'HH24')",
            kind: Kind::Option,
        },
        Dimension {
            key: "weekday",
            label: "Hari",
            sql: "to_char(s.created_at + make_interval(mins => $OFFSET), 'Dy')",
            kind: Kind::Option,
        },
    ],
    measures: &[
        Measure {
            key: "sales",
            label: "Struk",
            sql: "COUNT(*)",
            format: Format::Count,
        },
        Measure {
            key: "gross",
            label: "Bruto",
            sql: "COALESCE(SUM(s.total_minor), 0)",
            format: Format::Money,
        },
        Measure {
            key: "net",
            label: "Net",
            sql: "COALESCE(SUM(s.net_minor), 0)",
            format: Format::Money,
        },
        Measure {
            key: "tax",
            label: "Pajak",
            sql: "COALESCE(SUM(s.tax_minor), 0)",
            format: Format::Money,
        },
        Measure {
            key: "paid",
            label: "Dibayar",
            sql: "COALESCE(SUM(s.paid_minor), 0)",
            format: Format::Money,
        },
        Measure {
            key: "change",
            label: "Kembalian",
            sql: "COALESCE(SUM(s.change_minor), 0)",
            format: Format::Money,
        },
        Measure {
            key: "average_sale",
            label: "Nilai rata-rata struk",
            sql: "ROUND(COALESCE(SUM(s.total_minor), 0)::numeric / NULLIF(COUNT(*), 0))",
            format: Format::Money,
        },
        Measure {
            key: "voids",
            label: "Void",
            sql: "COUNT(*) FILTER (WHERE s.status = 'VOIDED')",
            format: Format::Count,
        },
    ],
};

/// How the money arrived.
const SALE_PAYMENT: Dataset = Dataset {
    name: "sale_payment",
    title: "Pembayaran",
    description: "Satu baris per pembayaran pada penjualan yang selesai. \
Dataset untuk komposisi tender tunai vs kartu.",
    source: "FROM sale_payment sp
             JOIN sale s ON s.id = sp.sale_id
             LEFT JOIN site si ON si.id = s.site_id",
    base_where: Some("s.status = 'COMPLETED'"),
    time: "sp.recorded_at",
    dimensions: &[
        Dimension {
            key: "method",
            label: "Metode",
            sql: "sp.method",
            kind: Kind::Option,
        },
        Dimension {
            key: "site_id",
            label: "Toko",
            sql: "s.site_id",
            kind: Kind::Option,
        },
        Dimension {
            key: "site_name",
            label: "Nama toko",
            sql: "COALESCE(si.name, s.site_id)",
            kind: Kind::Option,
        },
        Dimension {
            key: "channel",
            label: "Channel",
            sql: "s.channel",
            kind: Kind::Option,
        },
        Dimension {
            key: "cashier",
            label: "Kasir",
            sql: "sp.actor_id",
            kind: Kind::Option,
        },
    ],
    measures: &[
        Measure {
            key: "amount",
            label: "Nilai",
            sql: "COALESCE(SUM(sp.amount_minor), 0)",
            format: Format::Money,
        },
        Measure {
            key: "payments",
            label: "Jumlah pembayaran",
            sql: "COUNT(*)",
            format: Format::Count,
        },
        Measure {
            key: "sales",
            label: "Struk",
            sql: "COUNT(DISTINCT sp.sale_id)",
            format: Format::Count,
        },
    ],
};

/// Everybody holding a card, and what they have done with it.
///
/// One row per member, never one per sale: the spend, the visit count and the
/// days since the last purchase are already rolled up by the source, so they
/// are ordinary columns a filter can compare against rather than aggregates a
/// `HAVING` would be needed for. That is what makes a *segment* expressible as
/// a plain list of clauses — "lapsing, and has spent at least five million" is
/// two comparisons on one row.
///
/// **Its labels are English, unlike the three datasets above.** That is not an
/// oversight and not a preference: these labels are printed on the Members
/// screens, whose prose is English throughout — a written segment's card says
/// "Segment is Lapsing · Spent is at least Rp 5.000.000" — and half a sentence
/// in each language reads worse than a dataset menu with one English entry in
/// it. The older three are Indonesian because they were written for the
/// Reports screen alone; that they disagree is a wart worth one pass over all
/// four, not worth changing three datasets from inside this one.
///
/// The source and the three expressions below are `postgres/membership.rs`'s
/// own, imported rather than restated. The directory screen, the six derived
/// segments and this dataset therefore cannot disagree about what "lapsing"
/// means or how a day is counted, which they would within a week of being
/// written out twice.
const MEMBER: Dataset = Dataset {
    name: "member",
    title: "Member",
    description: "One row per member: the card, what has been spent on it, how \
many visits, what is left on vouchers, and how long since the last purchase. \
The dataset for questions about the person rather than the goods — and what a \
saved segment is defined over.",
    source: crate::cloud::postgres::MEMBER_SOURCE,
    // Every enrolled card, including the ones nobody has ever used. A member
    // who has never bought is not missing data — they are the most fixable
    // thing in the scheme, and a dataset that hid them would say enrolment was
    // working.
    base_where: None,
    time: "m.joined_on",
    dimensions: &[
        Dimension {
            key: "member_id",
            label: "Card number",
            sql: "m.member_id",
            kind: Kind::Option,
        },
        Dimension {
            key: "display_name",
            label: "Name",
            sql: "m.display_name",
            kind: Kind::Text,
        },
        // The six, by the one definition there is. Offering them here is what
        // lets a saved segment start from one and narrow it, instead of
        // restating "ninety days" in somebody's own clause and drifting from
        // the screen that prints the word.
        Dimension {
            key: "segment",
            label: "Segment",
            sql: crate::cloud::postgres::SEGMENT_CASE,
            kind: Kind::Option,
        },
        Dimension {
            key: "days_since_purchase",
            label: "Days since last purchase",
            sql: crate::cloud::postgres::DAYS_SINCE_PURCHASE,
            kind: Kind::Number,
        },
        Dimension {
            key: "spent_minor",
            label: "Spent",
            sql: "COALESCE(s.spent_minor, 0)",
            kind: Kind::Number,
        },
        Dimension {
            key: "saved_minor",
            label: "Saved by promotions",
            sql: "COALESCE(s.saved_minor, 0)",
            kind: Kind::Number,
        },
        Dimension {
            key: "transaction_count",
            label: "Sales",
            sql: "COALESCE(s.transaction_count, 0)",
            kind: Kind::Number,
        },
        Dimension {
            key: "points_earned_total",
            label: "Points earned",
            sql: "COALESCE(s.points_earned_total, 0)",
            kind: Kind::Number,
        },
        Dimension {
            key: "voucher_balance_minor",
            label: "Voucher balance",
            sql: "COALESCE(h.voucher_balance_minor, 0)",
            kind: Kind::Number,
        },
        // The difference between a customer the shop can reach and one it can
        // only serve — and therefore the difference between a segment worth a
        // message and a segment worth a poster.
        Dimension {
            key: "paired",
            label: "Paired to the app",
            sql: crate::cloud::postgres::PAIRED,
            kind: Kind::Boolean,
        },
        Dimension {
            key: "blocked",
            label: "Membership stopped",
            sql: "(m.blocked_at IS NOT NULL)",
            kind: Kind::Boolean,
        },
        Dimension {
            key: "joined_on",
            label: "Joined",
            sql: "m.joined_on",
            kind: Kind::Date,
        },
        Dimension {
            key: "first_purchase_at",
            label: "First purchase",
            sql: "s.first_purchase_at",
            kind: Kind::Date,
        },
        Dimension {
            key: "last_purchase_at",
            label: "Last purchase",
            sql: "s.last_purchase_at",
            kind: Kind::Date,
        },
    ],
    measures: &[
        Measure {
            key: "members",
            label: "Members",
            sql: "COUNT(*)",
            format: Format::Count,
        },
        Measure {
            key: "spent",
            label: "Spent",
            sql: "COALESCE(SUM(s.spent_minor), 0)",
            format: Format::Money,
        },
        Measure {
            key: "saved",
            label: "Saved by promotions",
            sql: "COALESCE(SUM(s.saved_minor), 0)",
            format: Format::Money,
        },
        Measure {
            key: "sales",
            label: "Sales",
            sql: "COALESCE(SUM(s.transaction_count), 0)",
            format: Format::Count,
        },
        Measure {
            key: "voucher_balance",
            label: "Voucher balance",
            sql: "COALESCE(SUM(h.voucher_balance_minor), 0)",
            format: Format::Money,
        },
        // Per member, not per sale. The figure that says whether a segment is
        // worth a campaign at all: a thousand lapsed members averaging nothing
        // are not worth a message, two hundred averaging a million are.
        Measure {
            key: "average_spend",
            label: "Average each",
            sql: "COALESCE(SUM(s.spent_minor), 0) / GREATEST(COUNT(*), 1)",
            format: Format::Money,
        },
    ],
};

/// The JSON schema a model fills in to compose a report.
///
/// Generated from the catalogue rather than written out, for the reason the
/// catalogue exists at all: a dataset added above appears here the same day,
/// and a model cannot name a column that is no longer declared. The legend in
/// the description is the only thing the model is told about this business's
/// data — it never sees a row while composing.
pub fn spec_schema() -> serde_json::Value {
    use serde_json::json;

    let legend = DATASETS
        .iter()
        .map(|dataset| {
            format!(
                "{} — {}\n  dimensions: {}\n  measures: {}",
                dataset.name,
                dataset.description,
                dataset
                    .dimensions
                    .iter()
                    .map(|dimension| dimension.key)
                    .collect::<Vec<_>>()
                    .join(", "),
                dataset
                    .measures
                    .iter()
                    .map(|measure| measure.key)
                    .collect::<Vec<_>>()
                    .join(", "),
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    json!({
        "type": "object",
        "description": format!(
            "A report definition. Dimensions and measures must come from the \
    dataset you name — mixing them across datasets is refused.\n\n{legend}"
        ),
        "properties": {
            "dataset": {
                "type": "string",
                "enum": DATASETS.iter().map(|dataset| dataset.name).collect::<Vec<_>>(),
            },
            "period": {
                "type": "object",
                "description": "Prefer relative: a saved report holding fixed \
    dates is frozen the day it is written.",
                "properties": {
                    "kind": { "type": "string", "enum": ["relative", "absolute", "all"] },
                    "last": { "type": "integer", "minimum": 1 },
                    "unit": { "type": "string", "enum": ["day", "week", "month"] },
                    "from": { "type": "string", "description": "YYYY-MM-DD, absolute only." },
                    "to": { "type": "string", "description": "YYYY-MM-DD, absolute only." },
                },
                "required": ["kind"],
            },
            "grain": {
                "type": "string",
                "enum": ["none", "day", "week", "month"],
                "description": "The time axis. `none` for a ranking; a chart needs one of the others.",
            },
            "group_by": {
                "type": "array",
                "description": "At most two dimension keys.",
                "items": { "type": "string" },
                "maxItems": 2,
            },
            "measures": {
                "type": "array",
                "description": "Measure keys, in the order the table shows them.",
                "items": { "type": "string" },
                "minItems": 1,
            },
            "filters": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "column": { "type": "string", "description": "A dimension key." },
                        "op": {
                            "type": "string",
                            "enum": [
                                "Is", "IsNot", "IsAnyOf", "IsNoneOf", "IsEmpty", "IsNotEmpty",
                                "Contains", "NotContains", "StartsWith", "Gt", "Gte", "Lt",
                                "Lte", "Between",
                            ],
                        },
                        "values": { "type": "array", "items": { "type": "string" } },
                    },
                    "required": ["column", "op"],
                },
            },
            "sort": {
                "type": "object",
                "properties": {
                    "key": { "type": "string", "description": "A measure or dimension key." },
                    "desc": { "type": "boolean" },
                },
                "required": ["key"],
            },
            "limit": { "type": "integer", "minimum": 1, "maximum": 5000 },
            "present": {
                "type": "object",
                "description": "How it is drawn. KPIs are computed over the whole period.",
                "properties": {
                    "kpis": { "type": "array", "items": { "type": "string" } },
                    "chart": {
                        "type": "array",
                        "description": "At most two measures; needs a grain.",
                        "items": { "type": "string" },
                        "maxItems": 2,
                    },
                    "table": { "type": "array", "items": { "type": "string" } },
                },
            },
        },
        "required": ["dataset", "measures"],
    })
}
