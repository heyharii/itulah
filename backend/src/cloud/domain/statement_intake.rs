//! Which rule wants this attachment, and whether we have seen it before.
//!
//! The two decisions a mail gateway makes that are worth testing without a
//! mailbox, a database or a clock. Everything else it does — connect, fetch,
//! archive, import — is I/O, and lives in `cloud::intake`.
//!
//! Ported in shape from `internal/store/mailgateway/rules.go` in
//! `~/Documents/retail`, with two deliberate differences.
//!
//! **The first rule wins, and the order is a stored number.** The Go version
//! also takes the first match, but its order is whatever the database happened
//! to return, which means two overlapping rules reconcile into different
//! accounts depending on the query plan. Here `priority` is a column, the
//! caller sorts by it, and the tie is broken by creation time so the answer is
//! total.
//!
//! **A rule that matches nothing is not silently the same as no rules.** The
//! caller records the miss (see `bank_statement_intake.status`), because a
//! mailbox quietly discarding a bank's mail looks exactly like a mailbox
//! nobody is sending to.

use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// One file pulled out of a message.
#[derive(Clone, Debug)]
pub struct InboundAttachment {
    pub filename: String,
    pub content: Vec<u8>,
}

/// One inbound message, carrying nought or more attachments.
///
/// There is no date on it, and that is on purpose. The Go gateway derives the
/// business date from the email's date because an acquirer's settlement report
/// does not say which day it covers. A bank statement does: the window comes
/// out of the file, from the value dates on its own lines. Taking it from the
/// envelope instead would mean a forwarded email dates a statement by when it
/// was forwarded.
#[derive(Clone, Debug, Default)]
pub struct InboundMessage {
    /// The provider's id, when there is one. Empty for a dropped file.
    pub id: String,
    pub from: String,
    pub subject: String,
    pub attachments: Vec<InboundAttachment>,
}

/// The matching half of a `bank_statement_source` row.
///
/// Only the fields the decision needs. What the rule points AT — the account,
/// the unit, the parser and its settings — is the caller's business, fetched
/// by `source_id` once a rule has won.
#[derive(Clone, Debug, Serialize)]
pub struct SourceRule {
    pub source_id: Uuid,
    pub label: String,
    /// Case-insensitive substring of the sender. Empty matches anything.
    pub from_pattern: String,
    /// Case-insensitive substring of the subject. Empty matches anything.
    pub subject_pattern: String,
    /// A glob over the filename: `*` for any run, `?` for one character.
    /// Empty matches anything.
    pub filename_pattern: String,
}

/// The first rule that wants this attachment.
///
/// `rules` must already be in the order the caller means — enabled only, and
/// sorted. This does not sort, because a function that quietly reorders its
/// argument is a function whose answer depends on something the caller cannot
/// see.
pub fn match_source<'a>(
    message: &InboundMessage,
    attachment: &InboundAttachment,
    rules: &'a [SourceRule],
) -> Option<&'a SourceRule> {
    let from = message.from.to_lowercase();
    let subject = message.subject.to_lowercase();
    let filename = attachment.filename.to_lowercase();

    rules.iter().find(|rule| {
        contains_fold(&from, &rule.from_pattern)
            && contains_fold(&subject, &rule.subject_pattern)
            && glob_fold(&filename, &rule.filename_pattern)
    })
}

/// An empty pattern matches anything; otherwise a plain substring.
fn contains_fold(haystack_lower: &str, pattern: &str) -> bool {
    pattern.is_empty() || haystack_lower.contains(&pattern.to_lowercase())
}

/// An empty pattern matches anything; otherwise a `*`/`?` glob.
fn glob_fold(name_lower: &str, pattern: &str) -> bool {
    pattern.is_empty() || glob_match(&pattern.to_lowercase(), name_lower)
}

/// `*` matches any run including none, `?` matches exactly one character.
///
/// Written out rather than pulled in, because this is the whole of what a
/// filename rule needs and a glob crate brings character classes, negation and
/// path semantics that a bank's filename has never contained. Iterative with a
/// backtrack point, so `*a*b*c*` on a long name cannot go exponential.
fn glob_match(pattern: &str, name: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let name: Vec<char> = name.chars().collect();
    let (mut p, mut n) = (0usize, 0usize);
    // Where to resume if the run we chose for the last `*` turns out too short.
    let mut star: Option<(usize, usize)> = None;

    while n < name.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == name[n]) {
            p += 1;
            n += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some((p, n));
            p += 1;
        } else if let Some((star_p, star_n)) = star {
            // Give the star one more character and try again from there.
            p = star_p + 1;
            n = star_n + 1;
            star = Some((star_p, star_n + 1));
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|c| *c == '*')
}

/// What makes this attachment the same attachment next time.
///
/// The message id when the provider gave one, because a mailbox that keeps its
/// mail hands us the same message on every poll. The hash of the bytes when it
/// did not, because a file dropped into a directory has no identity but its
/// content. Either way the filename is part of it: one email routinely carries
/// one report per account.
pub fn dedup_key(message_id: &str, attachment: &InboundAttachment) -> String {
    if !message_id.trim().is_empty() {
        return format!("{}|{}", message_id.trim(), attachment.filename);
    }
    format!(
        "sha256:{}|{}",
        digest(&attachment.content),
        attachment.filename
    )
}

/// Where the raw bytes are kept, when there is somewhere to keep them.
///
/// Grouped by account and then by the day we took delivery, because the two
/// questions anybody asks of an archive are "what did this bank send us" and
/// "what came in on the day the figure changed". The digest is in the name so
/// that two files with one name and different contents cannot overwrite one
/// another.
pub fn archive_key(account_code: &str, day: &str, attachment: &InboundAttachment) -> String {
    let short: String = digest(&attachment.content).chars().take(16).collect();
    let safe: String = attachment
        .filename
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("bank-statements/{account_code}/{day}/{short}-{safe}")
}

fn digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(label: &str, from: &str, subject: &str, filename: &str) -> SourceRule {
        SourceRule {
            source_id: Uuid::new_v4(),
            label: label.into(),
            from_pattern: from.into(),
            subject_pattern: subject.into(),
            filename_pattern: filename.into(),
        }
    }

    fn message(from: &str, subject: &str, filename: &str) -> (InboundMessage, InboundAttachment) {
        let attachment = InboundAttachment {
            filename: filename.into(),
            content: b"content".to_vec(),
        };
        (
            InboundMessage {
                id: String::new(),
                from: from.into(),
                subject: subject.into(),
                attachments: vec![attachment.clone()],
            },
            attachment,
        )
    }

    #[test]
    fn an_empty_pattern_matches_anything() {
        let rules = [rule("catch-all", "", "", "")];
        let (msg, att) = message("anyone@anywhere", "whatever", "file.csv");
        assert!(match_source(&msg, &att, &rules).is_some());
    }

    #[test]
    fn every_stated_pattern_must_agree() {
        let rules = [rule("bca giro", "klikbca", "rekening koran", "*.csv")];
        let (msg, att) = message("no-reply@klikbca.co.id", "Rekening Koran Juni", "rk.csv");
        assert!(match_source(&msg, &att, &rules).is_some());

        // Right sender, right file, wrong subject: no match, rather than a
        // match on two out of three.
        let (msg, att) = message("no-reply@klikbca.co.id", "Promo kartu kredit", "rk.csv");
        assert!(match_source(&msg, &att, &rules).is_none());
    }

    #[test]
    fn case_never_decides_anything() {
        let rules = [rule("mandiri", "MANDIRI", "Mutasi", "*.CSV")];
        let (msg, att) = message("noreply@bankmandiri.co.id", "mutasi harian", "export.csv");
        assert!(match_source(&msg, &att, &rules).is_some());
    }

    #[test]
    fn the_first_rule_wins_and_the_caller_decides_the_order() {
        // Two rules that both want this file. The one listed first takes it,
        // whichever that is — which is why the caller sorts by priority.
        let first = rule("specific", "klikbca", "", "rk-4471-*.csv");
        let second = rule("catch-all", "klikbca", "", "*.csv");
        let (msg, att) = message("no-reply@klikbca.co.id", "koran", "rk-4471-202606.csv");

        let ordered = [first.clone(), second.clone()];
        let chosen = match_source(&msg, &att, &ordered).map(|r| r.source_id);
        assert_eq!(chosen, Some(first.source_id));

        let reversed = [second.clone(), first];
        let chosen = match_source(&msg, &att, &reversed).map(|r| r.source_id);
        assert_eq!(chosen, Some(second.source_id));
    }

    #[test]
    fn a_glob_is_a_star_and_a_question_mark_and_nothing_else() {
        assert!(glob_match("*.csv", "anything.csv"));
        assert!(glob_match("rk-????.csv", "rk-4471.csv"));
        assert!(!glob_match("rk-????.csv", "rk-447.csv"));
        assert!(glob_match("*", ""));
        assert!(glob_match("", ""));
        assert!(!glob_match("", "x"));
        // The pattern that would go exponential if this backtracked naively.
        assert!(glob_match(
            "*a*a*a*a*a*a*b",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"
        ));
        assert!(!glob_match(
            "*a*a*a*a*a*a*b",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaac"
        ));
    }

    #[test]
    fn a_message_id_identifies_an_attachment_and_bytes_do_when_it_does_not() {
        let att = InboundAttachment {
            filename: "rk.csv".into(),
            content: b"one".to_vec(),
        };
        assert_eq!(dedup_key("<abc@bank>", &att), "<abc@bank>|rk.csv");

        // No id: two different files with one name are two different keys, and
        // the same file twice is one key.
        let other = InboundAttachment {
            filename: "rk.csv".into(),
            content: b"two".to_vec(),
        };
        assert_ne!(dedup_key("", &att), dedup_key("", &other));
        assert_eq!(dedup_key("", &att), dedup_key("", &att.clone()));
    }

    #[test]
    fn an_archive_key_cannot_be_made_to_escape_its_prefix() {
        let att = InboundAttachment {
            filename: "../../etc/passwd".into(),
            content: b"x".to_vec(),
        };
        let key = archive_key("1011002001", "2026-09-08", &att);
        let prefix = "bank-statements/1011002001/2026-09-08/";
        assert!(key.starts_with(prefix));
        // The dots survive — `..` is legal in a filename and the extension
        // needs one. What cannot survive is a separator, and without one there
        // is no level for `..` to climb.
        assert!(!key[prefix.len()..].contains('/'));
    }
}
