//! Head office's WhatsApp: one number, sending shoppers their one-time codes.
//!
//! Through `services/wa-gateway` for now — WhatsApp Web driven by a browser
//! (owner, 25 Oct 2026: "pengganti officialnya yg pake web browser dlu") — and
//! through the official Business API once the company has one. Only this file
//! knows which: a caller asks to send a text to a number and is told whether
//! it went.
//!
//! `WA_GATEWAY_URL` and `WA_GATEWAY_KEY` switch it on. Unset, nothing is sent
//! and nothing waits for a code: registering at a till works as it did before,
//! and a redemption can still be approved in the member app.

use crate::cloud::application::AppError;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;

/// The gateway, as head office was configured to reach it.
pub struct Gateway {
    url: String,
    key: String,
    client: reqwest::Client,
}

/// The gateway, or `None` when head office has no WhatsApp.
pub fn gateway() -> Option<&'static Gateway> {
    static GATEWAY: OnceLock<Option<Gateway>> = OnceLock::new();
    GATEWAY
        .get_or_init(|| {
            let url = std::env::var("WA_GATEWAY_URL").ok()?;
            let url = url.trim().trim_end_matches('/').to_string();
            let key = std::env::var("WA_GATEWAY_KEY").ok()?.trim().to_string();
            if url.is_empty() || key.is_empty() {
                return None;
            }
            // Longer than the gateway's own 30 s wait on WhatsApp, so its
            // `send_timeout` reaches here as an answer rather than a dead line.
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(35))
                .build()
                .ok()?;
            Some(Gateway { url, key, client })
        })
        .as_ref()
}

/// What Central › System › WhatsApp shows.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct WhatsAppStatus {
    /// `OFF`: head office has no gateway. `UNREACHABLE`: it did not answer.
    /// Otherwise the gateway's own: `STARTING`, `QR`, `CONNECTED`,
    /// `DISCONNECTED`.
    pub state: String,
    /// The pairing QR, drawn, while `state` is `QR`.
    pub qr_svg: Option<String>,
    /// The paired number, `628…`.
    pub number: Option<String>,
    pub name: Option<String>,
    pub since: Option<String>,
    pub last_error: Option<String>,
}

impl WhatsAppStatus {
    fn bare(state: &str, last_error: Option<String>) -> Self {
        Self {
            state: state.to_string(),
            qr_svg: None,
            number: None,
            name: None,
            since: None,
            last_error,
        }
    }
}

/// Where head office's WhatsApp stands.
pub async fn status() -> WhatsAppStatus {
    let Some(gateway) = gateway() else {
        return WhatsAppStatus::bare("OFF", None);
    };
    let answer = gateway
        .client
        .get(format!("{}/status", gateway.url))
        .header("x-gateway-key", &gateway.key)
        .timeout(Duration::from_secs(8))
        .send()
        .await;
    let body: Value = match answer {
        Ok(response) if response.status().is_success() => {
            response.json().await.unwrap_or(Value::Null)
        }
        Ok(response) => {
            return WhatsAppStatus::bare(
                "UNREACHABLE",
                Some(format!("the gateway answered {}", response.status())),
            )
        }
        Err(error) => return WhatsAppStatus::bare("UNREACHABLE", Some(error.to_string())),
    };
    let text = |field: &str| {
        body.get(field)
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|value| !value.is_empty())
    };
    let state = text("state").unwrap_or_else(|| "UNREACHABLE".to_string());
    let qr_svg = if state == "QR" {
        text("qr").and_then(|qr| qr_svg(&qr))
    } else {
        None
    };
    WhatsAppStatus {
        state,
        qr_svg,
        number: text("number"),
        name: text("name"),
        since: text("since"),
        last_error: text("last_error"),
    }
}

/// Unlink head office's number, so another can be paired.
pub async fn logout() -> Result<(), AppError> {
    let gateway = gateway().ok_or_else(not_set_up)?;
    let response = gateway
        .client
        .post(format!("{}/logout", gateway.url))
        .header("x-gateway-key", &gateway.key)
        .send()
        .await
        .map_err(|error| AppError::Conflict(format!("the WhatsApp gateway did not answer: {error}")))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(AppError::Conflict(format!(
            "the WhatsApp gateway refused to log out ({})",
            response.status()
        )))
    }
}

/// Send `text` to a member's number. Answers WhatsApp's message id.
pub async fn send(phone: &str, text: &str) -> Result<String, AppError> {
    let gateway = gateway().ok_or_else(not_set_up)?;
    let to = wa_number(phone)
        .ok_or_else(|| AppError::Validation(format!("{phone} is not a phone number WhatsApp can reach")))?;
    let response = gateway
        .client
        .post(format!("{}/send", gateway.url))
        .header("x-gateway-key", &gateway.key)
        .json(&json!({ "to": to, "text": text }))
        .send()
        .await
        .map_err(|error| AppError::Conflict(format!("the WhatsApp gateway did not answer: {error}")))?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if status.is_success() {
        return Ok(body
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string());
    }
    let error = body.get("error").and_then(Value::as_str).unwrap_or_default();
    Err(match error {
        "not_on_whatsapp" => AppError::Unprocessable(format!("{} is not on WhatsApp", masked(phone))),
        "not_connected" => AppError::Conflict(
            "head office's WhatsApp is not connected: scan its QR in Central, System, WhatsApp".into(),
        ),
        "rate_limited" => {
            AppError::Conflict("too many WhatsApp messages this minute: try again shortly".into())
        }
        "send_timeout" => AppError::Conflict(
            "WhatsApp did not confirm the message in time: it may still arrive".into(),
        ),
        _ => AppError::Conflict(format!("WhatsApp did not send the message ({status} {error})")),
    })
}

fn not_set_up() -> AppError {
    AppError::Conflict("head office has no WhatsApp set up".into())
}

/// A member's number as WhatsApp wants it: digits, `62` in place of the
/// leading `0`. `None` for what is not an Indonesian mobile number — a card
/// number printed on plastic, say.
pub fn wa_number(phone: &str) -> Option<String> {
    let digits: String = phone.chars().filter(char::is_ascii_digit).collect();
    let international = if let Some(rest) = digits.strip_prefix('0') {
        format!("62{rest}")
    } else {
        digits
    };
    (international.starts_with("628") && (11..=15).contains(&international.len()))
        .then_some(international)
}

/// `0812****7890`: enough of a number for the cashier to say it back.
pub fn masked(phone: &str) -> String {
    let digits: String = phone.chars().filter(char::is_ascii_digit).collect();
    if digits.len() < 8 {
        return digits;
    }
    format!("{}****{}", &digits[..4], &digits[digits.len() - 4..])
}

/// `5.000`: a count as a shopper reads it.
pub fn grouped(value: i64) -> String {
    let digits = value.unsigned_abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3 + 1);
    if value < 0 {
        out.push('-');
    }
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push('.');
        }
        out.push(ch);
    }
    out
}

fn qr_svg(payload: &str) -> Option<String> {
    use qrcode::render::svg;
    use qrcode::{EcLevel, QrCode};
    let code = QrCode::with_error_correction_level(payload, EcLevel::L).ok()?;
    Some(
        code.render()
            .min_dimensions(240, 240)
            .quiet_zone(true)
            .dark_color(svg::Color("#000000"))
            .light_color(svg::Color("#ffffff"))
            .build(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_local_number_reaches_whatsapp_with_62() {
        assert_eq!(wa_number("081234567890").as_deref(), Some("6281234567890"));
        assert_eq!(wa_number("+62 812-3456-7890").as_deref(), Some("6281234567890"));
        assert_eq!(wa_number("6281234567890").as_deref(), Some("6281234567890"));
    }

    #[test]
    fn a_card_number_is_not_a_phone() {
        assert_eq!(wa_number("00012345"), None);
        assert_eq!(wa_number("M1:0001"), None);
        assert_eq!(wa_number("0215551234"), None);
    }

    #[test]
    fn a_number_is_said_back_masked() {
        assert_eq!(masked("081234567890"), "0812****7890");
    }

    #[test]
    fn points_are_grouped_in_threes() {
        assert_eq!(grouped(5000), "5.000");
        assert_eq!(grouped(125), "125");
        assert_eq!(grouped(1250000), "1.250.000");
    }
}
