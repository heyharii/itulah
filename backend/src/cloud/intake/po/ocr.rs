//! OCR — the two doors a scanned page can knock on, in the order they are
//! tried.
//!
//! **OpenParser first** (when `OPENPARSER_API_KEY` is set): OCR and field
//! extraction into the PO schema in one call. **LiteParse second** (when
//! `LITEPARSE_BIN` names the CLI): local OCR via Tesseract, its text mined by
//! the heuristics. Neither configured, a scanned page has no way through, and
//! the report says so honestly instead of inventing lines.
//!
//! Both doors are best-effort in the same way the deleted Node service was:
//! a failure is "no text came out", never a fabricated field. The CLI's
//! stdout is asked for JSON and its plain output accepted when it prints that
//! instead.

use super::draft::Extracted;
use super::loose::{parse_date_loose, string_or_null};
use super::text::ExtractedLine;
use super::PoImportConfig;

/// The JSON shape every purchase document is extracted into — the same shape
/// the OpenParser request carries as its schema, so the hub's types and this
/// schema move together. Required: supplier_name, lines.
pub const PO_SCHEMA: &str = r#"{
  "type": "object",
  "properties": {
    "po_number": { "type": "string" },
    "order_date": { "type": "string", "description": "ISO date YYYY-MM-DD" },
    "expected_arrival": { "type": "string", "description": "ISO date YYYY-MM-DD" },
    "currency": { "type": "string", "description": "ISO 4217 code, e.g. IDR" },
    "supplier_name": { "type": "string", "description": "The company the order is placed WITH" },
    "notes": { "type": "string" },
    "lines": {
      "type": "array",
      "description": "Every line item ordered, one object each",
      "items": {
        "type": "object",
        "properties": {
          "article_code": { "type": "string", "description": "The supplier's own code, when printed" },
          "article_name": { "type": "string", "description": "What is being bought, as printed" },
          "quantity": { "type": "number" },
          "unit": { "type": "string", "description": "pcs, box, koli, kg — as printed" },
          "unit_price": { "type": "number", "description": "Price per unit, in whole currency units, as printed" },
          "promised_date": { "type": "string", "description": "ISO date the supplier promises delivery" }
        },
        "required": ["article_name", "quantity", "unit_price"],
        "additionalProperties": false
      }
    }
  },
  "required": ["supplier_name", "lines"],
  "additionalProperties": false
}"#;

/// Schema'd extraction: OCR plus field extraction in one call. A 202 means
/// the job is queued; it is polled for up to a minute rather than hanging a
/// buyer's upload forever.
pub async fn openparser_extract(
    config: &PoImportConfig,
    bytes: &[u8],
    file_name: &str,
    mime: &str,
) -> Result<Extracted, String> {
    let key = config
        .openparser_api_key
        .as_deref()
        .filter(|key| !key.is_empty())
        .ok_or_else(|| "OPENPARSER_API_KEY is not set".to_string())?;
    let request = serde_json::json!({
        "ocr_model": config.openparser_ocr_model,
        "llm_model": config.openparser_llm_model,
        "schema": serde_json::from_str::<serde_json::Value>(PO_SCHEMA)
            .map_err(|error| error.to_string())?,
    });
    let part_request = reqwest::multipart::Part::text(request.to_string())
        .mime_str("application/json")
        .map_err(|error| error.to_string())?;
    let part_file = reqwest::multipart::Part::bytes(bytes.to_vec())
        .file_name(file_name.to_string())
        .mime_str(mime)
        .map_err(|error| error.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("request", part_request)
        .part("file", part_file);
    // A fresh key per request: a retried UPLOAD is a different upload.
    let response = reqwest::Client::new()
        .post(format!("{}/extract", config.openparser_base_url))
        .bearer_auth(key)
        .header("Idempotency-Key", uuid::Uuid::new_v4().to_string())
        .multipart(form)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status() == reqwest::StatusCode::ACCEPTED {
        return poll_openparser_job(config, key, response).await;
    }
    if !response.status().is_success() {
        return Err(format!(
            "openparser /extract answered {}",
            response.status()
        ));
    }
    let body: serde_json::Value = response.json().await.map_err(|error| error.to_string())?;
    extract_from_openparser_body(&body)
}

async fn poll_openparser_job(
    config: &PoImportConfig,
    key: &str,
    accepted: reqwest::Response,
) -> Result<Extracted, String> {
    let body: serde_json::Value = accepted.json().await.map_err(|error| error.to_string())?;
    let job_id = body
        .get("job_id")
        .or_else(|| body.get("id"))
        .and_then(|id| id.as_str())
        .ok_or_else(|| "openparser accepted a job but named no id".to_string())?
        .to_string();
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let poll = reqwest::Client::new()
            .get(format!("{}/jobs/{job_id}", config.openparser_base_url))
            .bearer_auth(key)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !poll.status().is_success() {
            continue;
        }
        let job: serde_json::Value = poll.json().await.map_err(|error| error.to_string())?;
        let status = job
            .get("status")
            .or_else(|| job.get("state"))
            .and_then(|status| status.as_str())
            .unwrap_or("");
        if status == "failed" {
            return Err(job
                .get("error")
                .and_then(|error| error.as_str())
                .unwrap_or("openparser job failed")
                .to_string());
        }
        if status == "done" || status == "completed" || status == "succeeded" {
            return extract_from_openparser_body(&job);
        }
    }
    Err("openparser job did not finish in 60s".to_string())
}

/// The answer's fields may sit under `data` or at the top level; either way,
/// the schema's required fields must be there or the answer is not one.
fn extract_from_openparser_body(body: &serde_json::Value) -> Result<Extracted, String> {
    let payload = body.get("data").unwrap_or(body);
    let lines = payload
        .get("lines")
        .and_then(|lines| lines.as_array())
        .ok_or_else(|| "openparser /extract answered without the schema's fields".to_string())?;
    if !payload.get("supplier_name").is_some() {
        return Err("openparser /extract answered without the schema's fields".to_string());
    }
    let text = |field: &str| -> Option<String> {
        payload
            .get(field)
            .and_then(|value| value.as_str())
            .and_then(string_or_null)
    };
    let whole = |field: &serde_json::Value, name: &str| -> Option<i64> {
        match field.get(name) {
            Some(value) => match value.as_f64() {
                Some(number) if number.is_finite() => Some(number.round() as i64),
                _ => None,
            },
            None => None,
        }
    };
    Ok(Extracted {
        po_number: text("po_number"),
        order_date: text("order_date").and_then(|d| parse_date_loose(&d)),
        expected_arrival: text("expected_arrival").and_then(|d| parse_date_loose(&d)),
        currency: text("currency").unwrap_or_else(|| "IDR".to_string()),
        supplier_name: text("supplier_name"),
        notes: text("notes"),
        lines: lines
            .iter()
            .map(|line| ExtractedLine {
                article_code: line
                    .get("article_code")
                    .and_then(|v| v.as_str())
                    .and_then(string_or_null),
                article_name: line
                    .get("article_name")
                    .and_then(|v| v.as_str())
                    .and_then(string_or_null),
                quantity: whole(line, "quantity"),
                unit: line
                    .get("unit")
                    .and_then(|v| v.as_str())
                    .and_then(string_or_null),
                unit_price: whole(line, "unit_price"),
                promised_date: line
                    .get("promised_date")
                    .and_then(|v| v.as_str())
                    .and_then(parse_date_loose),
            })
            .collect(),
    })
}

/// Local OCR through the `litparse` CLI. `None` means "no text came out" —
/// unset binary, spawn failure, timeout, or an empty page; the caller's
/// report is the same honest shrug in every case.
pub async fn liteparse_text(
    config: &PoImportConfig,
    bytes: &[u8],
    file_name: &str,
    mime: &str,
    needs_ocr: bool,
) -> Option<String> {
    let binary = config
        .liteparse_bin
        .as_deref()
        .filter(|bin| !bin.is_empty())?;
    let suffix = file_name
        .rsplit('.')
        .next()
        .filter(|ext| ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|ext| format!(".{ext}"))
        .unwrap_or_default();
    let directory = std::env::temp_dir().join(format!("po-import-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).ok()?;
    let path = directory.join(format!("dokumen{suffix}"));
    if std::fs::write(&path, bytes).is_err() {
        let _ = std::fs::remove_dir_all(&directory);
        return None;
    }
    let mut command = tokio::process::Command::new(binary);
    command.arg(&path);
    if needs_ocr {
        command
            .arg("--ocr-language")
            .arg(&config.liteparse_ocr_language);
    } else {
        command.arg("--no-ocr");
    }
    command.current_dir(&directory);
    let _ = mime; // the CLI sniffs the file itself; the mime names it only
    let child = command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    let output = match child.spawn() {
        Ok(child) => match tokio::time::timeout(
            std::time::Duration::from_secs(120),
            child.wait_with_output(),
        )
        .await
        {
            Ok(Ok(output)) => output,
            _ => {
                let _ = std::fs::remove_dir_all(&directory);
                return None;
            }
        },
        Err(_) => {
            let _ = std::fs::remove_dir_all(&directory);
            return None;
        }
    };
    let _ = std::fs::remove_dir_all(&directory);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    // JSON if it prints JSON, plain text otherwise.
    match serde_json::from_str::<serde_json::Value>(&stdout) {
        Ok(value) => value
            .get("text")
            .and_then(|text| text.as_str())
            .map(str::to_string),
        Err(_) => Some(stdout),
    }
}
