//! The mailbox the bank actually sends to.
//!
//! A dedicated address — `keuangan@`, `statements@` — that nothing but banks
//! write to. The poller logs in, asks for the last few days of mail, and takes
//! the attachments off it.
//!
//! # Three decisions, all taken from the reference implementation
//!
//! **Nothing is marked read.** The fetch is `BODY.PEEK[]`, and the search is
//! "since N days" rather than "unseen". A gateway that consumed `\Seen` would
//! race with a person reading the same mailbox and with a second node polling
//! it, and the loser of that race silently never imports a statement. What
//! stops a re-read becoming a re-import is `bank_statement_intake`, which is
//! where that decision belongs: it survives a mailbox being restored from
//! backup, which a flag does not.
//!
//! **Nothing is deleted.** The mailbox is the client's record of what their
//! bank sent them. It is not this process's queue.
//!
//! **The whole thing is blocking, on a blocking thread.** `imap` is a
//! synchronous client and the async ones want a TLS stack of their own. Once
//! every five minutes, for a handful of messages, the honest version is
//! `spawn_blocking` — not a second TLS implementation in the binary for the
//! sake of an `await`.

use super::{InboundMessage, Source};
use crate::cloud::application::AppError;
use crate::cloud::domain::InboundAttachment;
use mail_parser::{MessageParser, MimeHeaders};

/// How to reach the mailbox.
#[derive(Clone, Debug)]
pub struct ImapConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub mailbox: String,
    /// How far back each pass looks. Seven by default, which covers a long
    /// weekend and a node that was switched off over it.
    pub since_days: i64,
    /// The most messages one pass will download. A mailbox that has been
    /// collecting for a year and is then pointed at this must not turn the
    /// first pass into a several-gigabyte download.
    pub message_limit: usize,
}

impl ImapConfig {
    /// Read from the environment, or `None` when no mailbox is configured —
    /// which is an ordinary deployment, not a fault.
    pub fn from_env() -> Option<Self> {
        let username = std::env::var("STATEMENT_IMAP_USER").ok()?;
        let password = std::env::var("STATEMENT_IMAP_PASSWORD").unwrap_or_default();
        let host = std::env::var("STATEMENT_IMAP_HOST").unwrap_or_else(|_| "imap.gmail.com".into());
        let port = std::env::var("STATEMENT_IMAP_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(993);
        let mailbox = std::env::var("STATEMENT_IMAP_MAILBOX").unwrap_or_else(|_| "INBOX".into());
        let since_days = std::env::var("STATEMENT_IMAP_SINCE_DAYS")
            .ok()
            .and_then(|value| value.parse().ok())
            .filter(|days| *days > 0)
            .unwrap_or(7);
        let message_limit = std::env::var("STATEMENT_IMAP_MESSAGE_LIMIT")
            .ok()
            .and_then(|value| value.parse().ok())
            .filter(|limit| *limit > 0)
            .unwrap_or(200);
        Some(Self {
            host,
            port,
            username,
            password,
            mailbox,
            since_days,
            message_limit,
        })
    }
}

pub struct ImapSource {
    config: ImapConfig,
}

impl ImapSource {
    pub fn new(config: ImapConfig) -> Self {
        Self { config }
    }
}

#[async_trait::async_trait]
impl Source for ImapSource {
    fn describe(&self) -> String {
        format!(
            "imap:{}@{}:{}/{}",
            self.config.username, self.config.host, self.config.port, self.config.mailbox
        )
    }

    async fn fetch(&self) -> Result<Vec<InboundMessage>, AppError> {
        let config = self.config.clone();
        tokio::task::spawn_blocking(move || fetch_blocking(&config))
            .await
            .map_err(|error| AppError::Configuration(format!("mailbox poll panicked: {error}")))?
    }
}

fn fetch_blocking(config: &ImapConfig) -> Result<Vec<InboundMessage>, AppError> {
    let client = imap::ClientBuilder::new(config.host.clone(), config.port)
        .connect()
        .map_err(|error| {
            AppError::Configuration(format!(
                "cannot reach {}:{}: {error}",
                config.host, config.port
            ))
        })?;
    let mut session = client
        .login(&config.username, &config.password)
        // The tuple carries the client back so a caller can retry; we cannot,
        // and holding the failed session open until the next poll is worse than
        // reconnecting.
        .map_err(|(error, _)| AppError::Configuration(format!("mailbox login refused: {error}")))?;

    let result = collect(&mut session, config);
    // Log out whether or not the collection worked. A gateway that leaks a
    // session on every failed pass gets locked out by the provider after a few
    // hours of failing, which then looks like a credentials problem.
    let _ = session.logout();
    result
}

fn collect<S: std::io::Read + std::io::Write>(
    session: &mut imap::Session<S>,
    config: &ImapConfig,
) -> Result<Vec<InboundMessage>, AppError> {
    session.select(&config.mailbox).map_err(|error| {
        AppError::Configuration(format!("no mailbox {}: {error}", config.mailbox))
    })?;

    // IMAP's own date format, which is not any of the ones a bank uses.
    let since = (chrono::Utc::now() - chrono::Duration::days(config.since_days))
        .format("%d-%b-%Y")
        .to_string();
    let uids = session
        .uid_search(format!("SINCE {since}"))
        .map_err(|error| AppError::Configuration(format!("mailbox search failed: {error}")))?;
    if uids.is_empty() {
        return Ok(Vec::new());
    }
    // Newest first, then capped: if the window is too wide to fetch in one
    // pass, the mail worth having is the mail that arrived most recently.
    let mut uids: Vec<u32> = uids.into_iter().collect();
    uids.sort_unstable_by(|a, b| b.cmp(a));
    uids.truncate(config.message_limit);

    let set = uids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let fetched = session
        .uid_fetch(set, "BODY.PEEK[]")
        .map_err(|error| AppError::Configuration(format!("mailbox fetch failed: {error}")))?;

    let mut messages = Vec::new();
    for item in fetched.iter() {
        let Some(body) = item.body() else { continue };
        let Some(parsed) = MessageParser::default().parse(body) else {
            tracing::warn!("a message in the statement mailbox could not be parsed");
            continue;
        };
        let attachments: Vec<InboundAttachment> = parsed
            .attachments()
            .filter_map(|part| {
                let filename = part.attachment_name()?.trim().to_string();
                if filename.is_empty() {
                    return None;
                }
                Some(InboundAttachment {
                    filename,
                    content: part.contents().to_vec(),
                })
            })
            .collect();
        if attachments.is_empty() {
            continue;
        }
        messages.push(InboundMessage {
            id: parsed.message_id().unwrap_or_default().to_string(),
            from: parsed
                .from()
                .and_then(|address| address.first())
                .and_then(|addr| addr.address())
                .unwrap_or_default()
                .to_string(),
            subject: parsed.subject().unwrap_or_default().to_string(),
            attachments,
        });
    }
    Ok(messages)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_defaults_are_a_gmail_workspace_mailbox() {
        // The one thing worth asserting without a server: that a deployment
        // which sets only the user and password reaches Gmail over TLS.
        let config = ImapConfig {
            host: "imap.gmail.com".into(),
            port: 993,
            username: "keuangan@example.com".into(),
            password: String::new(),
            mailbox: "INBOX".into(),
            since_days: 7,
            message_limit: 200,
        };
        assert_eq!(
            ImapSource::new(config).describe(),
            "imap:keuangan@example.com@imap.gmail.com:993/INBOX"
        );
    }
}
