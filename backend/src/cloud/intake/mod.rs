//! A statement gets itself into the books.
//!
//! ```text
//! Source (a mailbox, or a watched folder)
//!   -> already seen?          bank_statement_intake
//!   -> which rule wants it?   bank_statement_source
//!   -> keep the raw bytes     the attachment store, when there is one
//!   -> read it                parse / xlsx / pdf
//!   -> import it              the 0071 import, unchanged
//!   -> write down what happened
//! ```
//!
//! Ported from `internal/store/mailgateway` in `~/Documents/retail`, which does
//! this for acquirer settlement reports at the shop. Two differences are worth
//! knowing about if you read both.
//!
//! **This ends at a bank statement, not at a settlement recon.** The Go gateway
//! hands its file to `reconv2.IngestBankFile`, which matches EDC settlement
//! against till payments. Ours hands its file to the import that has existed
//! since 0071, which puts a rekening koran in front of the matcher that scores
//! it against the ledger. Card settlement is a different reconciliation and it
//! is not built here — [`Gateway::handle`] is where a second destination would
//! attach, next to the import.
//!
//! **Nothing is retried.** A file that failed to parse gets a row saying so and
//! is never looked at again, because the fix is always a change to the source's
//! mapping and the operator can re-run the pass by hand from the screen. A
//! poller that retried a bad file every five minutes for a month would fill the
//! log with the same complaint and hide the ones that mattered.

pub mod dir;
pub mod imap;
pub mod parse;
pub mod pdf;
pub mod xlsx;

use crate::cloud::application::AppError;
use crate::cloud::attachments::AttachmentStore;
use crate::cloud::domain::{archive_key, dedup_key, match_source};
use crate::cloud::postgres::{self, ImportStatementRequest, IntakeRecord, ResolvedSource};
use parse::{ParseError, ParsedStatement};
use sqlx::PgPool;
use std::sync::Arc;

pub use crate::cloud::domain::{InboundAttachment, InboundMessage};

/// Somewhere inbound files come from.
///
/// A trait rather than an enum so that the gateway can be tested against a
/// mailbox that is a `Vec`, and so that the next source — a webhook, a bank's
/// own API — is a new file rather than a change to this one.
#[async_trait::async_trait]
pub trait Source: Send + Sync {
    /// For the log line that says what this node is polling.
    fn describe(&self) -> String;
    async fn fetch(&self) -> Result<Vec<InboundMessage>, AppError>;
}

/// Who the ledger records as having imported an automatic statement.
///
/// A name and not a person, because nobody did it. It reads as itself in the
/// audit trail and in `bank_statement.imported_by`, and it cannot be confused
/// with a username because of the prefix.
pub const ACTOR: &str = "system:statement-intake";

/// What one pass did.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct IntakeStats {
    pub messages: usize,
    pub attachments: usize,
    /// Already recorded by an earlier pass, or by another node.
    pub already_seen: usize,
    pub ingested: usize,
    pub lines: usize,
    pub skipped: usize,
    pub failed: usize,
}

pub struct Gateway {
    pool: PgPool,
    source: Box<dyn Source>,
    archive: Option<Arc<AttachmentStore>>,
}

impl Gateway {
    pub fn new(pool: PgPool, source: Box<dyn Source>) -> Self {
        Self {
            pool,
            source,
            archive: None,
        }
    }

    /// Keep the raw bytes of everything a rule accepted.
    ///
    /// Optional, and a deployment without object storage is a working one: the
    /// lines are in the database either way. What is lost without it is the
    /// ability to answer "is that what the bank actually sent?" — which is the
    /// question every disputed reconciliation ends at.
    pub fn with_archive(mut self, archive: Option<Arc<AttachmentStore>>) -> Self {
        self.archive = archive;
        self
    }

    pub fn describe(&self) -> String {
        self.source.describe()
    }

    /// One pass: fetch everything, deal with each attachment exactly once.
    pub async fn run_once(&self) -> Result<IntakeStats, AppError> {
        let messages = self.source.fetch().await?;
        let sources = postgres::active_statement_sources(&self.pool).await?;
        let rules: Vec<_> = sources.iter().map(|source| source.rule.clone()).collect();

        let mut stats = IntakeStats::default();
        for message in &messages {
            stats.messages += 1;
            for attachment in &message.attachments {
                stats.attachments += 1;
                self.handle(message, attachment, &sources, &rules, &mut stats)
                    .await?;
            }
        }
        Ok(stats)
    }

    async fn handle(
        &self,
        message: &InboundMessage,
        attachment: &InboundAttachment,
        sources: &[ResolvedSource],
        rules: &[crate::cloud::domain::SourceRule],
        stats: &mut IntakeStats,
    ) -> Result<(), AppError> {
        let key = dedup_key(&message.id, attachment);
        if postgres::statement_intake_seen(&self.pool, &key).await? {
            stats.already_seen += 1;
            return Ok(());
        }

        let mut record = IntakeRecord {
            dedup_key: key,
            message_id: message.id.clone(),
            sender: message.from.clone(),
            subject: message.subject.clone(),
            filename: attachment.filename.clone(),
            byte_count: attachment.content.len() as i64,
            status: "skipped_no_match",
            ..IntakeRecord::default()
        };

        let Some(rule) = match_source(message, attachment, rules) else {
            stats.skipped += 1;
            return postgres::record_statement_intake(&self.pool, &record).await;
        };
        let Some(source) = sources
            .iter()
            .find(|source| source.rule.source_id == rule.source_id)
        else {
            // Cannot happen: `rules` is built from `sources`. Handled rather
            // than unwrapped, because "cannot happen" is not a reason to take
            // the poller down if it ever does.
            stats.skipped += 1;
            return postgres::record_statement_intake(&self.pool, &record).await;
        };
        record.source_id = Some(source.rule.source_id);

        // Archive before parsing, so the file that could not be read is the
        // one still on disk to look at.
        if let Some(store) = &self.archive {
            let day = chrono::Utc::now().date_naive().to_string();
            let key = archive_key(&source.account_code, &day, attachment);
            match store
                .put(
                    &key,
                    attachment.content.clone(),
                    content_type(&attachment.filename),
                )
                .await
            {
                Ok(()) => record.object_key = key,
                // Not fatal. Losing the archive is worth a shout; losing the
                // statement because the archive is down is not.
                Err(error) => {
                    tracing::warn!(%error, file = %attachment.filename, "could not archive a bank statement")
                }
            }
        }

        let parsed = match parse::parse(
            source.format,
            &source.settings,
            &attachment.filename,
            &attachment.content,
        ) {
            Ok(parsed) => parsed,
            Err(error) => {
                stats.failed += 1;
                // A mapping fault and an empty file are things the operator
                // fixes; malformed bytes are things the bank fixes. Different
                // states, because they send you to different places.
                record.status = match error {
                    ParseError::Malformed(_) => "parse_error",
                    _ => "unparsed",
                };
                record.detail = error.to_string();
                return postgres::record_statement_intake(&self.pool, &record).await;
            }
        };

        let request = request_for(source, &parsed, &attachment.filename);
        match postgres::import_statement(&self.pool, &request, ACTOR).await {
            Ok(outcome) => {
                stats.ingested += 1;
                stats.lines += outcome.inserted as usize;
                record.status = "ingested";
                record.statement_id = Some(outcome.statement_id);
                record.line_count = outcome.inserted as i32;
                record.duplicate_count = outcome.duplicates as i32;
                record.detail = detail_for(&parsed);
            }
            Err(error) => {
                stats.failed += 1;
                record.status = "import_error";
                record.detail = error.to_string();
            }
        }
        postgres::record_statement_intake(&self.pool, &record).await
    }
}

/// The import request a parsed file becomes.
fn request_for(
    source: &ResolvedSource,
    parsed: &ParsedStatement,
    filename: &str,
) -> ImportStatementRequest {
    ImportStatementRequest {
        account_code: source.account_code.clone(),
        site_id: source.site_id.clone(),
        period_start: parsed.period_start,
        period_end: parsed.period_end,
        // A file with no running balance imports with zeroes and says so in the
        // intake log. The alternative — computing the closing figure from the
        // lines — makes the opening-to-closing check agree with itself by
        // construction, which is the one thing it must never do.
        opening_minor: parsed.opening_minor.unwrap_or(0),
        closing_minor: parsed.closing_minor.unwrap_or(0),
        source_name: Some(format!("{} — {filename}", source.rule.label)),
        lines: parsed.lines.clone(),
    }
}

/// What the log should say about a statement that imported cleanly.
fn detail_for(parsed: &ParsedStatement) -> String {
    let mut notes = Vec::new();
    if parsed.opening_minor.is_none() || parsed.closing_minor.is_none() {
        notes.push(
            "the file carried no running balance, so the opening and closing figures are zero"
                .to_string(),
        );
    }
    notes.extend(parsed.warnings.iter().cloned());
    notes.join("; ")
}

fn content_type(filename: &str) -> &'static str {
    let lower = filename.to_lowercase();
    if lower.ends_with(".pdf") {
        "application/pdf"
    } else if lower.ends_with(".xlsx") {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    } else if lower.ends_with(".csv") {
        "text/csv"
    } else {
        "application/octet-stream"
    }
}

/// Which source this node polls, if any.
///
/// A mailbox when one is configured, otherwise a watched directory, otherwise
/// nothing at all — which is the default and is a perfectly good deployment.
/// Both cannot run at once on purpose: two sources feeding one log is two
/// places to look when a statement does not arrive.
pub fn source_from_env() -> Option<Box<dyn Source>> {
    if let Some(config) = imap::ImapConfig::from_env() {
        return Some(Box::new(imap::ImapSource::new(config)));
    }
    std::env::var("STATEMENT_INTAKE_DIR")
        .ok()
        .filter(|directory| !directory.trim().is_empty())
        .map(|directory| Box::new(dir::DirSource::new(directory)) as Box<dyn Source>)
}

/// How often the poller runs. Five minutes, unless told otherwise.
pub fn interval_from_env() -> std::time::Duration {
    let seconds = std::env::var("STATEMENT_INTAKE_INTERVAL_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|seconds| *seconds >= 30)
        .unwrap_or(5 * 60);
    std::time::Duration::from_secs(seconds)
}

/// Poll until the process ends.
pub async fn run_agent(gateway: Gateway, interval: std::time::Duration) {
    let mut ticker = tokio::time::interval(interval);
    loop {
        ticker.tick().await;
        match gateway.run_once().await {
            // Silence when there was nothing, because a poller that logs every
            // five minutes forever is a poller nobody reads.
            Ok(stats) if stats.attachments == 0 => {}
            Ok(stats) => tracing::info!(
                messages = stats.messages,
                attachments = stats.attachments,
                ingested = stats.ingested,
                lines = stats.lines,
                skipped = stats.skipped,
                already_seen = stats.already_seen,
                failed = stats.failed,
                "bank statement intake pass"
            ),
            Err(error) => tracing::error!(%error, "bank statement intake pass failed"),
        }
    }
}

/// A source that yields what it was given, for tests.
#[cfg(test)]
pub struct FixedSource(pub Vec<InboundMessage>);

#[cfg(test)]
#[async_trait::async_trait]
impl Source for FixedSource {
    fn describe(&self) -> String {
        "fixed".into()
    }
    async fn fetch(&self) -> Result<Vec<InboundMessage>, AppError> {
        Ok(self.0.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::postgres::ImportStatementLine;
    use chrono::NaiveDate;

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap_or_default()
    }

    fn parsed(
        opening: Option<i64>,
        closing: Option<i64>,
        warnings: Vec<String>,
    ) -> ParsedStatement {
        ParsedStatement {
            period_start: day("2026-06-01"),
            period_end: day("2026-06-30"),
            opening_minor: opening,
            closing_minor: closing,
            lines: vec![ImportStatementLine {
                value_date: day("2026-06-01"),
                description: "SETORAN".into(),
                reference: None,
                debit_minor: 0,
                credit_minor: 5_000_000,
            }],
            warnings,
        }
    }

    #[test]
    fn a_statement_with_no_balances_imports_with_zeroes_and_says_why() {
        let parsed = parsed(None, None, Vec::new());
        let detail = detail_for(&parsed);
        assert!(detail.contains("no running balance"), "{detail}");
    }

    #[test]
    fn a_clean_statement_with_balances_has_nothing_to_report() {
        let parsed = parsed(Some(10_000_000), Some(15_000_000), Vec::new());
        assert!(detail_for(&parsed).is_empty());
    }

    #[test]
    fn every_row_the_reader_skipped_reaches_the_log() {
        let parsed = parsed(
            Some(1),
            Some(2),
            vec!["row 9: cannot read \"TOTAL\" as a date".into()],
        );
        assert!(detail_for(&parsed).contains("row 9"));
    }

    #[test]
    fn the_importer_is_named_as_a_system_and_never_as_a_person() {
        assert!(ACTOR.starts_with("system:"));
    }
}
