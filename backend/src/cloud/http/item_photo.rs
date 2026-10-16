//! Reading a photograph with Jev, TypeSafe's decision model (owner, 15 Oct
//! 2026: "integrasikan jev image … saat po, untuk nentuin tags, colors, size,
//! dan division"; then New Articles, and "cek artikel ganda … cuma kasih tau
//! saja").
//!
//! Two doors:
//!
//! - **A new item on a purchase order** (`read_item_photo`): its division,
//!   main colour, kind of sizes and tags.
//! - **A new article being set up** (`read_article_photo`): its name from the
//!   Name suggestions master, and the existing articles it may duplicate.
//!
//! **The photo goes to Jev from here.** As with the assistant, the key lives in
//! this process and the browser only talks to us. Jev is never asked to
//! describe the photo in words: it is asked typed questions over this
//! business's own masters — which of *these* divisions, which of *these*
//! colours, which of *these* names, yes or no per tag — so every answer is a
//! code we already have, never a new word to map.
//!
//! **Sizes are not read off the photo.** A photo shows a shirt or a shoe; it
//! cannot show whether the supplier sells it in S–XL or M–XXL (owner, 15 Oct:
//! "ukuran agak sulit untuk jev"). So Jev answers only the KIND of sizes —
//! letters, EU shoe sizes, one size, no size — and the run is the one the
//! catalogue already uses most for that kind, among items with the same tags
//! when there are any.
//!
//! **Nothing is written, and a duplicate only informs.** The answers go back
//! to the form, which fills only what the buyer has not touched and only when
//! Jev is sure enough; a possible duplicate is said, never blocks. A node
//! without `TYPESAFE_API_KEY` answers "not configured" and the forms simply
//! offer nothing. Images are a "danger zone" feature on TypeSafe's side (the
//! `TypeSafe-Danger-Zone-Images` header): good enough to propose, not to
//! decide — which is exactly how they are used.
use crate::cloud::application::{AppError, AppState};
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{collections::HashMap, sync::OnceLock, time::Duration};
use uuid::Uuid;

/// TypeSafe's evaluation endpoint, relative to the base URL.
const SYSTEM_ONE: &str = "/v1/systemone";
/// A photo larger than this is refused before it is sent (the forms shrink
/// what they send to about 1,024px, a few hundred KB).
const MAX_PHOTO_BYTES: usize = 6 * 1024 * 1024;
/// How many existing articles are put to Jev as possible duplicates.
const DUPLICATE_CANDIDATES: i64 = 6;
/// An existing article is said to be a possible duplicate from here up.
const DUPLICATE_LINE: f64 = 0.8;

/// Where Jev is and which one answers — read once from the environment.
///
/// Not part of `AppConfig` on purpose: that struct is built field by field in
/// the integration tests, and a node reading photos is optional in the same
/// way the assistant is.
struct JevConfig {
    key: Option<String>,
    base_url: String,
    model: String,
}

fn jev() -> &'static JevConfig {
    static CONFIG: OnceLock<JevConfig> = OnceLock::new();
    CONFIG.get_or_init(|| {
        let read = |name: &str| {
            std::env::var(name)
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        };
        JevConfig {
            key: read("TYPESAFE_API_KEY"),
            base_url: read("TYPESAFE_BASE_URL")
                .unwrap_or_else(|| "https://api.typesafe.ai".into())
                .trim_end_matches('/')
                .to_owned(),
            // 1.14 reads Indonesian labels better than 1.13, and answers Box.
            model: read("JEV_MODEL").unwrap_or_else(|| "jev-1.14.0".into()),
        }
    })
}

#[derive(Debug, Deserialize)]
pub struct ReadPhotoRequest {
    /// The photo, base64 with no `data:` prefix.
    pub image_base64: String,
    /// `jpg` or `png`.
    pub format: String,
    /// What the buyer has typed as the item's name so far, if anything.
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PhotoReading {
    /// The model that answered, as TypeSafe reports it (`jev-1.14.0`).
    pub model: String,
    pub division: Option<Pick>,
    pub colour: Option<Pick>,
    pub sizes: Option<SizesPick>,
    /// Every tag with the probability that it describes the item, most likely
    /// first. The form decides where the line is.
    pub tags: Vec<TagPick>,
}

#[derive(Debug, Serialize)]
pub struct Pick {
    pub code: String,
    pub confidence: f64,
}

#[derive(Debug, Serialize)]
pub struct SizesPick {
    /// `letters`, `shoe`, `one` or `none` — what Jev was asked.
    pub kind: String,
    /// The run the catalogue uses most for that kind — what code chose.
    pub codes: Vec<String>,
    /// Jev's confidence in the KIND, not in the run.
    pub confidence: f64,
}

#[derive(Debug, Serialize)]
pub struct TagPick {
    pub code: String,
    pub probability: f64,
}

/// Whether this node can read photos, for a form to know before it asks.
pub async fn photo_reading_status() -> Json<Value> {
    let config = jev();
    Json(json!({ "enabled": config.key.is_some(), "model": config.model }))
}

/// A new item on a purchase order: division, main colour, kind of sizes, tags.
pub async fn read_item_photo(
    State(state): State<AppState>,
    Json(request): Json<ReadPhotoRequest>,
) -> Result<Json<PhotoReading>, AppError> {
    let photo = Photo::from_request(&request.image_base64, &request.format)?;

    // The vocabulary the answers must come from: what the masters hold today.
    let divisions = master(&state, "division").await?;
    let colours = master(&state, "colour").await?;
    let tags = master(&state, "tag").await?;
    let size_codes: Vec<(String, String)> = sqlx::query_as(
        "SELECT trim(code), label FROM size_code WHERE active ORDER BY display_order",
    )
    .fetch_all(&state.db)
    .await?;
    let kinds: Vec<(&'static str, &'static str)> = SIZE_KINDS
        .iter()
        .copied()
        .filter(|(kind, _)| size_codes.iter().any(|(_, label)| size_kind(label) == *kind))
        .collect();

    let mut questions = Map::new();
    if !divisions.is_empty() {
        questions.insert(
            "division".into(),
            choice(
                "Which division of a fashion store does the item in `photo` belong to?",
                &divisions,
            ),
        );
    }
    if !colours.is_empty() {
        questions.insert(
            "colour".into(),
            choice("What is the main colour of the item in `photo`?", &colours),
        );
    }
    if !kinds.is_empty() {
        let options: Vec<(String, String)> = kinds
            .iter()
            .map(|(kind, meaning)| ((*kind).to_owned(), (*meaning).to_owned()))
            .collect();
        questions.insert(
            "size_kind".into(),
            choice("What kind of sizes is the item in `photo` sold in?", &options),
        );
    }
    for (index, (_, label)) in tags.iter().enumerate() {
        questions.insert(
            format!("tag_{index}"),
            json!({
                "type": "noul",
                "instructions": format!("Does \"{label}\" describe the item in `photo`?"),
            }),
        );
    }
    if questions.is_empty() {
        return Err(AppError::Unprocessable(
            "the masters have no divisions, colours, sizes or tags to choose from".into(),
        ));
    }

    let mut extra = Map::new();
    if let Some(name) = typed(request.name.as_deref()) {
        extra.insert("name".into(), json!(name));
    }
    let answer = ask(&photo, extra, questions).await?;
    let answers = answer.get("answers").cloned().unwrap_or(Value::Null);

    let division = picked(&answers, "division").map(|(code, confidence)| Pick { code, confidence });
    let colour = picked(&answers, "colour").map(|(code, confidence)| Pick { code, confidence });
    let mut tag_picks: Vec<TagPick> = tags
        .iter()
        .enumerate()
        .filter_map(|(index, (code, _))| {
            let probability = answers.get(format!("tag_{index}"))?.get("noul")?.as_f64()?;
            Some(TagPick { code: code.clone(), probability })
        })
        .collect();
    tag_picks.sort_by(|a, b| b.probability.total_cmp(&a.probability));

    let sizes = match picked(&answers, "size_kind") {
        Some((kind, confidence)) => {
            let sure_tags: Vec<String> = tag_picks
                .iter()
                .filter(|one| one.probability >= 0.7)
                .map(|one| one.code.clone())
                .collect();
            run_for(&state, &size_codes, &kind, &sure_tags)
                .await?
                .map(|codes| SizesPick { kind, codes, confidence })
        }
        None => None,
    };

    Ok(Json(PhotoReading {
        model: model_of(&answer),
        division,
        colour,
        sizes,
        tags: tag_picks,
    }))
}

#[derive(Debug, Deserialize)]
pub struct ReadArticlePhotoRequest {
    pub image_base64: String,
    pub format: String,
    /// The name on the form now (the order line's, or what was typed).
    #[serde(default)]
    pub name: Option<String>,
    /// The division the article is filed under, when the form has one.
    #[serde(default)]
    pub division_code: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ArticlePhotoReading {
    pub model: String,
    /// A name from the Name suggestions master, when it has any.
    pub name: Option<NamePick>,
    /// Existing articles Jev thinks may be this same product, most likely
    /// first. Said to the buyer; never stops the setup.
    pub similar: Vec<SimilarArticle>,
}

#[derive(Debug, Serialize)]
pub struct NamePick {
    pub name: String,
    pub confidence: f64,
}

#[derive(Debug, Serialize)]
pub struct SimilarArticle {
    pub article_code: String,
    pub name: String,
    pub probability: f64,
}

/// A new article being set up: its name from the Name suggestions master, and
/// the existing articles it may duplicate.
pub async fn read_article_photo(
    State(state): State<AppState>,
    Json(request): Json<ReadArticlePhotoRequest>,
) -> Result<Json<ArticlePhotoReading>, AppError> {
    let photo = Photo::from_request(&request.image_base64, &request.format)?;
    let typed_name = typed(request.name.as_deref());
    let division = typed(request.division_code.as_deref());

    let names: Vec<(String,)> = sqlx::query_as(
        "SELECT name FROM article_name_suggestion WHERE active ORDER BY name",
    )
    .fetch_all(&state.db)
    .await?;
    // The articles most like this one by name, in its division when it has
    // one: the ones worth putting to Jev as possible duplicates.
    let candidates: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT a.article_code, a.name, d.label
           FROM article a
           LEFT JOIN division d ON d.code = a.division_code
          WHERE a.active
            AND ($2::text IS NULL OR a.division_code = $2)
          ORDER BY similarity(a.name, coalesce($1, '')) DESC, a.created_at DESC
          LIMIT $3",
    )
    .bind(typed_name)
    .bind(division)
    .bind(DUPLICATE_CANDIDATES)
    .fetch_all(&state.db)
    .await?;

    let mut questions = Map::new();
    if !names.is_empty() {
        let options: Vec<(String, String)> = names
            .iter()
            .enumerate()
            .map(|(index, (name,))| (format!("name_{index}"), name.clone()))
            .collect();
        questions.insert(
            "name".into(),
            choice(
                "Which of these product names fits the item in `photo` best?",
                &options,
            ),
        );
    }
    for (index, (code, name, division_label)) in candidates.iter().enumerate() {
        questions.insert(
            format!("same_{index}"),
            json!({
                "type": "noul",
                "instructions": {
                    "existing_article": {
                        "code": code,
                        "name": name,
                        "division": division_label,
                    },
                    "question": "Is the item in `photo` (named `name` on the form) the same product as `existing_article`, not just the same kind of product?",
                },
            }),
        );
    }
    if questions.is_empty() {
        return Ok(Json(ArticlePhotoReading {
            model: jev().model.clone(),
            name: None,
            similar: Vec::new(),
        }));
    }

    let mut extra = Map::new();
    extra.insert("name".into(), json!(typed_name.unwrap_or("")));
    let answer = ask(&photo, extra, questions).await?;
    let answers = answer.get("answers").cloned().unwrap_or(Value::Null);

    let name = picked(&answers, "name").and_then(|(option, confidence)| {
        let index: usize = option.strip_prefix("name_")?.parse().ok()?;
        let (name,) = names.get(index)?;
        Some(NamePick { name: name.clone(), confidence })
    });
    let mut similar: Vec<SimilarArticle> = candidates
        .iter()
        .enumerate()
        .filter_map(|(index, (code, name, _))| {
            let probability = answers.get(format!("same_{index}"))?.get("noul")?.as_f64()?;
            (probability >= DUPLICATE_LINE).then(|| SimilarArticle {
                article_code: code.clone(),
                name: name.clone(),
                probability,
            })
        })
        .collect();
    similar.sort_by(|a, b| b.probability.total_cmp(&a.probability));

    Ok(Json(ArticlePhotoReading {
        model: model_of(&answer),
        name,
        similar,
    }))
}

/// The kinds of sizes Jev chooses between, each as Jev reads it.
const SIZE_KINDS: [(&str, &str); 4] = [
    ("letters", "Clothing sizes in letters, such as S, M, L, XL"),
    ("shoe", "Shoe sizes in numbers, such as EU 37 to EU 41"),
    ("one", "One size fits all, such as a bag, a hat or an accessory"),
    ("none", "Not sold in sizes at all"),
];

/// Which kind a size in the master is, from its label.
fn size_kind(label: &str) -> &'static str {
    let label = label.trim().to_ascii_uppercase();
    let letters = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XL", "3XL", "4XL"];
    if label.contains("NO SIZE") {
        "none"
    } else if label.contains("ONE SIZE") || label.contains("ALL SIZE") {
        "one"
    } else if label.starts_with("EU") || label.parse::<u32>().is_ok() {
        "shoe"
    } else if letters.contains(&label.as_str()) {
        "letters"
    } else {
        "other"
    }
}

/// The run of sizes the catalogue uses most for `kind`: among items carrying
/// one of `tags` when there are any, else among all of them. One size and no
/// size are runs of one.
async fn run_for(
    state: &AppState,
    size_codes: &[(String, String)],
    kind: &str,
    tags: &[String],
) -> Result<Option<Vec<String>>, AppError> {
    let of_kind: HashMap<&str, ()> = size_codes
        .iter()
        .filter(|(_, label)| size_kind(label) == kind)
        .map(|(code, _)| (code.as_str(), ()))
        .collect();
    if of_kind.is_empty() {
        return Ok(None);
    }
    if kind == "one" || kind == "none" {
        let code = size_codes
            .iter()
            .find(|(_, label)| size_kind(label) == kind)
            .map(|(code, _)| code.clone());
        return Ok(code.map(|code| vec![code]));
    }
    let runs: Vec<(Vec<String>, bool, i64)> = sqlx::query_as(
        "SELECT codes, tagged, count(*) FROM (
             SELECT array_agg(trim(s.size_code) ORDER BY c.display_order) AS codes,
                    EXISTS (SELECT 1 FROM supplier_item_tag t
                             WHERE t.supplier_item_id = s.supplier_item_id
                               AND t.tag_code = ANY($1)) AS tagged
               FROM supplier_item_size s
               JOIN size_code c ON c.code = s.size_code
              GROUP BY s.supplier_item_id) r
          GROUP BY codes, tagged
          ORDER BY tagged DESC, count(*) DESC",
    )
    .bind(tags)
    .fetch_all(&state.db)
    .await?;
    let fits = |codes: &[String]| codes.iter().all(|code| of_kind.contains_key(code.as_str()));
    let best = runs
        .iter()
        .find(|(codes, tagged, _)| *tagged && !tags.is_empty() && fits(codes))
        .or_else(|| runs.iter().find(|(codes, _, _)| fits(codes)))
        .map(|(codes, _, _)| codes.clone());
    // No item of this kind yet: offer the whole kind, in the master's order.
    Ok(best.or_else(|| {
        Some(
            size_codes
                .iter()
                .filter(|(_, label)| size_kind(label) == kind)
                .map(|(code, _)| code.clone())
                .collect(),
        )
    }))
}

/// A photo checked once and referred to by a fresh reference in the request.
struct Photo {
    reference: String,
    format: &'static str,
    data: String,
}

impl Photo {
    fn from_request(data: &str, format: &str) -> Result<Self, AppError> {
        let format = match format.trim().to_ascii_lowercase().as_str() {
            "jpg" | "jpeg" => "jpg",
            "png" => "png",
            _ => return Err(AppError::Validation("the photo must be a JPEG or a PNG".into())),
        };
        let data = data.trim();
        if data.is_empty() || data.len() > MAX_PHOTO_BYTES / 3 * 4 + 4 {
            return Err(AppError::Validation(
                "the photo is empty or larger than 6 MB".into(),
            ));
        }
        Ok(Self {
            reference: format!("photo-{}", Uuid::new_v4()),
            format,
            data: data.to_owned(),
        })
    }
}

/// One System One request with the photo in the state as `photo`, beside any
/// other fields; the whole answer back.
async fn ask(photo: &Photo, extra: Map<String, Value>, questions: Map<String, Value>) -> Result<Value, AppError> {
    let config = jev();
    let key = config.key.clone().ok_or_else(|| {
        AppError::Configuration("photo reading is not configured on this node".into())
    })?;
    let mut state_value = extra;
    state_value.insert("photo".into(), json!(photo.reference));
    let mut assets = Map::new();
    assets.insert(
        photo.reference.clone(),
        json!({ "type": "image", "format": photo.format, "data_base64": photo.data }),
    );
    let body = json!({
        "model": config.model,
        "state": state_value,
        "assets": assets,
        "questions": questions,
    });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| AppError::Configuration(format!("photo reading client: {error}")))?;
    let response = client
        .post(format!("{}{SYSTEM_ONE}", config.base_url))
        .bearer_auth(key)
        .header("TypeSafe-Danger-Zone-Images", "true")
        .json(&body)
        .send()
        .await
        .map_err(|error| AppError::Configuration(format!("Jev did not answer: {error}")))?;
    let status = response.status();
    let answer: Value = response
        .json()
        .await
        .map_err(|error| AppError::Configuration(format!("Jev answered unreadably: {error}")))?;
    if !status.is_success() {
        let said = answer
            .pointer("/error/message")
            .or_else(|| answer.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("no reason given");
        return Err(AppError::Configuration(format!(
            "Jev refused the photo ({status}): {said}"
        )));
    }
    Ok(answer)
}

/// A master's active codes and labels, in its own order.
async fn master(state: &AppState, table: &str) -> Result<Vec<(String, String)>, AppError> {
    // `table` is one of three literals above, never input.
    let sql = format!("SELECT code, label FROM {table} WHERE active ORDER BY display_order, code");
    Ok(sqlx::query_as(&sql).fetch_all(&state.db).await?)
}

/// A Choice question: each option with its description as Jev reads it.
fn choice(instructions: &str, options: &[(String, String)]) -> Value {
    json!({
        "type": "choice",
        "instructions": instructions,
        "criteria": Value::Object(
            options
                .iter()
                .map(|(key, meaning)| (key.clone(), Value::String(meaning.clone())))
                .collect(),
        ),
    })
}

/// A Choice answer: the option chosen and how sure.
fn picked(answers: &Value, id: &str) -> Option<(String, f64)> {
    let one = answers.get(id)?;
    Some((
        one.get("choice")?.as_str()?.to_owned(),
        one.get("confidence").and_then(Value::as_f64).unwrap_or(0.0),
    ))
}

fn typed(text: Option<&str>) -> Option<&str> {
    text.map(str::trim).filter(|text| !text.is_empty())
}

fn model_of(answer: &Value) -> String {
    answer
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(&jev().model)
        .to_owned()
}
