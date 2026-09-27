//! Shop servers reporting in, and the hub's Fleet page reading them.
//!
//! `POST /api/v1/sync/heartbeat` is a machine route: the node proves itself
//! with its own `x-sync-key`, exactly as it does for `/sync/ingest`
//! (`authenticate_origin`), and can only ever report as itself. The two reads
//! are Admin routes under `/api/v1/sync/nodes`. See `postgres/node_health.rs`
//! and `sync/node_status.rs`.

use crate::cloud::{
    application::{AppError, AppState},
    postgres as infrastructure,
};
use crate::sync::node_status::NodeStatus;
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct Heartbeat {
    pub origin_id: String,
    pub status: NodeStatus,
}

pub async fn heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(beat): Json<Heartbeat>,
) -> Result<Json<Value>, AppError> {
    let origin = super::authenticate_origin(&state, &headers, &beat.origin_id).await?;
    // A registered origin only; an unregistered one (development without
    // auth) has nowhere to be filed on the Fleet page.
    if origin.site_id.is_none() {
        return Err(AppError::Forbidden(
            "heartbeats are accepted from registered shop servers only".into(),
        ));
    }
    let received = infrastructure::record_heartbeat(&state.db, &origin.origin_id, &beat.status).await?;
    Ok(Json(json!({ "server_time": received })))
}

pub async fn nodes(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({ "items": infrastructure::fleet(&state.db).await? })))
}

pub async fn incidents(
    State(state): State<AppState>,
    Path(origin_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({
        "items": infrastructure::node_incidents(&state.db, origin_id.trim()).await?
    })))
}

pub async fn uptime(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({ "items": infrastructure::fleet_uptime(&state.db).await? })))
}

pub async fn node_uptime(
    State(state): State<AppState>,
    Path(origin_id): Path<String>,
) -> Result<Json<infrastructure::NodeUptime>, AppError> {
    Ok(Json(infrastructure::node_uptime(&state.db, origin_id.trim()).await?))
}

/// A status page anyone holding the link can open on a phone: no login, no
/// script, the fleet's state and each shop's ninety days, refreshed by the
/// browser every minute. The link carries `STATUS_PAGE_TOKEN`; without that
/// setting there is no page at all, so a deployment never publishes its shop
/// list by accident.
pub async fn status_page(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> axum::response::Response {
    use axum::response::{Html, IntoResponse};
    let expected = std::env::var("STATUS_PAGE_TOKEN").unwrap_or_default();
    if expected.len() < 16 || !crate::security::constant_time_eq(&token, &expected) {
        return axum::http::StatusCode::NOT_FOUND.into_response();
    }
    let nodes = match infrastructure::fleet_uptime(&state.db).await {
        Ok(nodes) => nodes,
        Err(_) => return axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let names: std::collections::HashMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT c.origin_id, COALESCE(s.name, c.origin_id)
           FROM sync_origin_credential c LEFT JOIN site s ON s.id = c.site_id",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default()
    .into_iter()
    .collect();
    Html(render_status_page(&nodes, &names)).into_response()
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn render_status_page(
    nodes: &[infrastructure::NodeUptime],
    names: &std::collections::HashMap<String, String>,
) -> String {
    let down = nodes.iter().filter(|n| n.state == "DOWN").count();
    let maintenance = nodes.iter().filter(|n| n.state == "MAINTENANCE").count();
    let (tone, headline) = if down > 0 {
        ("bad", format!("{down} store {} unreachable", if down == 1 { "server" } else { "servers" }))
    } else if maintenance > 0 {
        ("info", format!("{maintenance} store {} in maintenance", if maintenance == 1 { "server" } else { "servers" }))
    } else {
        ("ok", "All store servers running".to_owned())
    };
    let pct = |value: Option<f64>| match value {
        None => "—".to_owned(),
        Some(v) if v >= 100.0 => "100%".to_owned(),
        Some(v) => format!("{v:.2}%").replace('.', ","),
    };
    let mut rows = String::new();
    let mut sorted: Vec<&infrastructure::NodeUptime> = nodes.iter().collect();
    sorted.sort_by_key(|n| (n.state != "DOWN", n.state != "MAINTENANCE", n.origin_id.clone()));
    for node in sorted {
        let (dot, word) = match node.state {
            "UP" => ("ok", "Up"),
            "DOWN" => ("bad", "Down"),
            "MAINTENANCE" => ("info", "Maintenance"),
            _ => ("mute", "Never seen"),
        };
        let bars: String = node
            .days
            .iter()
            .map(|day| {
                let class = match day.percent {
                    None => "n",
                    Some(p) if p >= 99.9 => "g",
                    Some(p) if p >= 97.0 => "a",
                    Some(_) => "r",
                };
                format!("<i class=\"{class}\" title=\"{} {}\"></i>", day.day, pct(day.percent))
            })
            .collect();
        let month = node.windows.iter().find(|w| w.days == 30).and_then(|w| w.percent);
        rows.push_str(&format!(
            "<li><div class=\"top\"><span class=\"name\"><b class=\"dot {dot}\"></b>{}</span><span class=\"pct\">{}</span><span class=\"st {dot}\">{word}</span></div><div class=\"bars\">{bars}</div></li>",
            escape(names.get(&node.origin_id).map(String::as_str).unwrap_or(&node.origin_id)),
            pct(month),
        ));
    }
    let updated = chrono::Utc::now()
        .with_timezone(&chrono::FixedOffset::east_opt(7 * 3600).expect("offset"))
        .format("%H:%M");
    format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="60"><title>Store server status</title><style>
:root{{--ink:#20242c;--text:#394150;--body:#626b78;--mute:#737c89;--line:#e7eaf0;--soft:#f7f8fa;--ok:#36b827;--okf:#15803d;--warn:#c9892e;--bad:#d05151;--badf:#be123c;--info:#2f86d8;--infof:#2c57bf}}
@media (prefers-color-scheme:dark){{:root{{--ink:#eef0f3;--text:#c9ccd3;--body:#9aa0aa;--mute:#80868f;--line:#2a2d33;--soft:#15171a}}body{{background:#15171a}}.card{{background:#1c1e22!important}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--soft);color:var(--text);font:15px/1.5 "Inter Variable",Inter,system-ui,-apple-system,"Segoe UI",sans-serif}}
main{{max-width:880px;margin:0 auto;padding:24px 16px 48px}}h1{{font-size:20px;margin:0;color:var(--ink);font-weight:600}}.sub{{color:var(--mute);font-size:13px;margin:4px 0 20px}}
.card{{background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 3px rgb(24 39 60/4%)}}
.head{{display:flex;align-items:center;gap:14px;padding:20px}}.head b{{width:14px;height:14px;border-radius:50%;flex:none}}.head span{{font-size:22px;font-weight:600;color:var(--ink);line-height:1.2}}
ul{{list-style:none;margin:16px 0 0;padding:0}}li{{padding:14px 20px;border-top:1px solid var(--line)}}li:first-child{{border-top:0}}
.top{{display:flex;align-items:center;gap:12px}}.name{{flex:1;min-width:0;display:flex;align-items:center;gap:10px;color:var(--ink);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
.dot{{width:8px;height:8px;border-radius:50%;flex:none}}.pct{{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink)}}.st{{font-size:13px;font-weight:600;width:96px;text-align:right}}
.bars{{display:flex;gap:2px;height:28px;margin-top:10px}}.bars i{{flex:1;border-radius:1px;min-width:1px}}
.g{{background:var(--ok)}}.a{{background:var(--warn)}}.r{{background:var(--bad)}}.n{{background:var(--line)}}
.dot.ok,.head .ok{{background:var(--ok)}}.dot.bad,.head .bad{{background:var(--bad)}}.dot.info,.head .info{{background:var(--info)}}.dot.mute{{background:var(--mute)}}
.st.ok{{color:var(--okf)}}.st.bad{{color:var(--badf)}}.st.info{{color:var(--infof)}}.st.mute{{color:var(--mute)}}
.legend{{display:flex;justify-content:space-between;color:var(--mute);font-size:12px;margin-top:8px}}
@media (max-width:560px){{.bars i:nth-child(-n+60){{display:none}}.st{{width:auto}}}}
</style></head><body><main><h1>Store server status</h1><p class="sub">Updated {updated} · refreshes itself every minute</p>
<section class="card head"><b class="{tone}"></b><span>{headline}</span></section>
<section class="card"><ul>{rows}</ul></section>
<p class="legend"><span>90 days ago</span><span>Today</span></p>
</main></body></html>"#,
        headline = escape(&headline),
    )
}

#[derive(Deserialize)]
pub struct AskNode {
    /// `node.restart`, `node.backup`, `node.diagnose`, or `bootstrap` (send the
    /// initial data again).
    pub action: String,
    pub reason: String,
    #[serde(default)]
    pub force: bool,
    /// `node.update` only: the signed build to install.
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub signature: Option<String>,
    #[serde(default)]
    pub window: Option<String>,
}

pub async fn ask(
    State(state): State<AppState>,
    axum::Extension(principal): axum::Extension<super::auth::Principal>,
    Path(origin_id): Path<String>,
    Json(body): Json<AskNode>,
) -> Result<Json<Value>, AppError> {
    let origin_id = origin_id.trim();
    if body.action == "bootstrap" {
        return Ok(Json(
            infrastructure::bootstrap_origin(&state.db, origin_id, &principal.username).await?,
        ));
    }
    let payload = if body.action == crate::sync::node_ops::NODE_UPDATE {
        let mut payload = json!({
            "reason": body.reason.trim(),
            "version": body.version.unwrap_or_default(),
            "url": body.url.unwrap_or_default(),
            "sha256": body.sha256.unwrap_or_default().to_ascii_lowercase(),
            "signature": body.signature.unwrap_or_default().to_ascii_lowercase(),
        });
        if let Some(window) = body.window {
            payload["window"] = json!(window);
        }
        payload
    } else {
        json!({ "reason": body.reason.trim(), "force": body.force })
    };
    Ok(Json(
        infrastructure::ask_node(
            &state.db,
            origin_id,
            &body.action,
            payload,
            &principal.username,
        )
        .await?,
    ))
}

#[derive(Deserialize)]
pub struct Diagnosis {
    pub origin_id: String,
    pub report: Value,
}

pub async fn diagnosis(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Diagnosis>,
) -> Result<Json<Value>, AppError> {
    let origin = super::authenticate_origin(&state, &headers, &body.origin_id).await?;
    if origin.site_id.is_none() {
        return Err(AppError::Forbidden("registered shop servers only".into()));
    }
    infrastructure::record_diagnostic(&state.db, &origin.origin_id, &body.report).await?;
    Ok(Json(json!({ "received": true })))
}

pub async fn diagnostics(
    State(state): State<AppState>,
    Path(origin_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({
        "items": infrastructure::node_diagnostics(&state.db, origin_id.trim()).await?
    })))
}
