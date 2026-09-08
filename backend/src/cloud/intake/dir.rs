//! A watched directory, for every way a statement reaches us that is not IMAP.
//!
//! A Sieve rule on the mail server, a small forwarder, somebody dragging the
//! attachment out of Outlook, `scp` from the machine the bank's software runs
//! on. All of them end with a file in a folder, and all of them are how this
//! actually gets used before anybody is willing to give a server a mailbox
//! password.
//!
//! Ported from `internal/store/mailgateway/dirsource.go`, sidecar and all: a
//! file may be accompanied by `<file>.meta.json` giving the envelope the file
//! arrived in, so a `from_pattern` rule works for a forwarded file exactly as
//! it does for a fetched one.
//!
//! ```json
//! { "id": "<abc@bank>", "from": "no-reply@klikbca.co.id", "subject": "Rekening Koran" }
//! ```
//!
//! Files are left where they are. Nothing is moved, renamed or deleted —
//! `bank_statement_intake` is what stops a file being ingested twice, so a
//! second pass over the same folder is a no-op rather than a duplicate, and a
//! folder somebody is also using for their own copies does not get rearranged
//! underneath them.

use super::{InboundMessage, Source};
use crate::cloud::application::AppError;
use crate::cloud::domain::InboundAttachment;
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// The most one file may be, so that a mistake in the watched folder — a
/// database dump, a video — cannot be read into memory in its entirety.
const LARGEST_ATTACHMENT: u64 = 32 * 1024 * 1024;

pub struct DirSource {
    directory: PathBuf,
}

#[derive(Debug, Default, Deserialize)]
struct Sidecar {
    #[serde(default)]
    id: String,
    #[serde(default)]
    from: String,
    #[serde(default)]
    subject: String,
}

impl DirSource {
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }

    fn sidecar(path: &Path) -> Sidecar {
        let beside = PathBuf::from(format!("{}.meta.json", path.display()));
        std::fs::read(beside)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }
}

#[async_trait::async_trait]
impl Source for DirSource {
    fn describe(&self) -> String {
        format!("dir:{}", self.directory.display())
    }

    async fn fetch(&self) -> Result<Vec<InboundMessage>, AppError> {
        let directory = self.directory.clone();
        // Blocking file work, off the reactor. The folder is small, but a
        // network mount is a network mount.
        tokio::task::spawn_blocking(move || read_directory(&directory))
            .await
            .map_err(|error| AppError::Configuration(format!("directory scan panicked: {error}")))?
    }
}

fn read_directory(directory: &Path) -> Result<Vec<InboundMessage>, AppError> {
    let entries = std::fs::read_dir(directory).map_err(|error| {
        AppError::Configuration(format!("cannot read {}: {error}", directory.display()))
    })?;

    let mut messages = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        // The sidecar is metadata about its neighbour, never a statement.
        if name.ends_with(".meta.json") || name.starts_with('.') {
            continue;
        }
        match entry.metadata() {
            Ok(metadata) if metadata.is_file() => {
                if metadata.len() > LARGEST_ATTACHMENT {
                    tracing::warn!(file = %name, bytes = metadata.len(), "skipping an oversized file in the statement folder");
                    continue;
                }
            }
            _ => continue,
        }
        let Ok(content) = std::fs::read(&path) else {
            tracing::warn!(file = %name, "cannot read a file in the statement folder");
            continue;
        };

        let sidecar = DirSource::sidecar(&path);
        messages.push(InboundMessage {
            id: sidecar.id,
            from: sidecar.from,
            subject: sidecar.subject,
            attachments: vec![InboundAttachment {
                filename: name,
                content,
            }],
        });
    }
    // A directory listing has no order. Sorting by filename makes a pass
    // deterministic, which is what lets the log of a run be compared with the
    // log of the run before it.
    messages.sort_by(|a, b| {
        a.attachments
            .first()
            .map(|att| att.filename.clone())
            .cmp(&b.attachments.first().map(|att| att.filename.clone()))
    });
    Ok(messages)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("statement-intake-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        let _ = std::fs::create_dir_all(&path);
        path
    }

    #[test]
    fn a_sidecar_supplies_the_envelope_a_dropped_file_does_not_have() {
        let dir = scratch("sidecar");
        let _ = std::fs::write(dir.join("rk.csv"), b"Tanggal\n");
        let _ = std::fs::write(
            dir.join("rk.csv.meta.json"),
            br#"{"id":"<abc@bank>","from":"no-reply@klikbca.co.id","subject":"Koran"}"#,
        );

        let messages = read_directory(&dir).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(
            messages.len(),
            1,
            "the sidecar is not a statement of its own"
        );
        assert_eq!(messages[0].id, "<abc@bank>");
        assert_eq!(messages[0].from, "no-reply@klikbca.co.id");
        assert_eq!(messages[0].attachments[0].filename, "rk.csv");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_without_a_sidecar_still_arrives_and_is_matched_on_its_name() {
        let dir = scratch("bare");
        let _ = std::fs::write(dir.join("koran-juni.csv"), b"Tanggal\n");
        let messages = read_directory(&dir).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(messages.len(), 1);
        assert!(messages[0].from.is_empty());
        assert_eq!(messages[0].attachments[0].filename, "koran-juni.csv");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_pass_over_one_folder_is_always_in_the_same_order() {
        let dir = scratch("order");
        for name in ["c.csv", "a.csv", "b.csv"] {
            let _ = std::fs::write(dir.join(name), b"x");
        }
        let names: Vec<String> = read_directory(&dir)
            .unwrap_or_default()
            .iter()
            .filter_map(|m| m.attachments.first().map(|a| a.filename.clone()))
            .collect();
        assert_eq!(names, vec!["a.csv", "b.csv", "c.csv"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
