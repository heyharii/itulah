//! What the assistant keeps, and how far it may read.
//!
//! Two jobs live here and they are not the same shape.
//!
//! **Keeping.** Conversations and their turns, owned by a username. The
//! assistant used to hold none of this — the browser carried the transcript
//! and posted it back with every question — and `0102` says why that changed.
//!
//! **Reading.** The nine curated tools in `http/assistant.rs` each answer one
//! question a screen already answers, which is exactly why they cannot answer
//! the other two hundred. This file adds the two that can: a description of
//! the schema, and one statement of read-only SQL.
//!
//! # Why SQL, and what stops it
//!
//! A catalogue of tools is a list of questions somebody thought of in advance.
//! This node has 163 tables and 240 endpoints; anybody asking "which suppliers
//! have unbilled receipts older than a month" is asking something no curated
//! tool will ever have. So the model gets the schema and writes the query.
//!
//! What makes that safe is not the model's good behaviour, and it is not the
//! regular expression below. It is Postgres: every statement runs inside a
//! `READ ONLY` transaction, and the server itself refuses an `INSERT`, an
//! `UPDATE`, a `DELETE` or any DDL inside one, however it is spelled and
//! however deeply it is nested in a CTE. The guards in `guard` are the second
//! line — they refuse the query before it costs a round trip, and they keep
//! the model away from the three things a read-only transaction would happily
//! hand over: password hashes and live session tokens.
//!
//! A statement timeout and a row ceiling do the rest. Neither is about safety;
//! both are about a mistyped join not holding a connection for a minute or
//! returning six million rows into a chat panel.

use crate::cloud::application::AppError;
use serde_json::{json, Map, Value};
use sqlx::{Column, Executor, PgPool, Row};
use uuid::Uuid;

// ---- Conversations -----------------------------------------------------

/// How many past chats the sidebar asks for. Beyond this somebody is
/// searching, not scrolling.
const CONVERSATION_PAGE: i64 = 60;

/// The longest a title may be. A title is the first question trimmed, and a
/// question can be a paragraph.
const TITLE_LIMIT: usize = 90;

/// One chat, as the sidebar draws it.
pub async fn list_assistant_conversations(
    pool: &PgPool,
    owner: &str,
    needle: Option<&str>,
) -> Result<Value, AppError> {
    // The needle matches the title and the words inside the chat, because
    // "the one where we worked out the Bandung shortfall" is remembered by
    // what was said in it rather than by what it was called.
    let rows = sqlx::query(
        "SELECT c.conversation_id, c.title, c.started_at_page, c.created_at, c.updated_at,
                (SELECT count(*) FROM assistant_message m
                  WHERE m.conversation_id = c.conversation_id) AS message_count
           FROM assistant_conversation c
          WHERE c.owner_username = $1
            AND c.archived_at IS NULL
            AND ($2::text IS NULL
                 OR c.title ILIKE '%' || $2 || '%'
                 OR EXISTS (SELECT 1 FROM assistant_message m
                             WHERE m.conversation_id = c.conversation_id
                               AND m.content ILIKE '%' || $2 || '%'))
          ORDER BY c.updated_at DESC
          LIMIT $3",
    )
    .bind(owner)
    .bind(needle)
    .bind(CONVERSATION_PAGE)
    .fetch_all(pool)
    .await?;

    Ok(json!({
        "items": rows
            .iter()
            .map(|row| json!({
                "id": row.get::<Uuid, _>("conversation_id"),
                "title": row.get::<String, _>("title"),
                "page": row.get::<Option<String>, _>("started_at_page"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
                "updated_at": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
                "message_count": row.get::<i64, _>("message_count"),
            }))
            .collect::<Vec<_>>(),
    }))
}

/// Start one. The title is the question, trimmed — see `0102`.
pub async fn create_assistant_conversation(
    pool: &PgPool,
    owner: &str,
    title: &str,
    page: Option<&str>,
) -> Result<Uuid, AppError> {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO assistant_conversation
             (conversation_id, owner_username, title, started_at_page)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(id)
    .bind(owner)
    .bind(trim_title(title))
    .bind(page)
    .execute(pool)
    .await?;
    Ok(id)
}

/// A title that fits a sidebar row: one line, no newlines, cut at a word.
fn trim_title(question: &str) -> String {
    let flat = question.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.is_empty() {
        return "New chat".to_owned();
    }
    if flat.chars().count() <= TITLE_LIMIT {
        return flat;
    }
    let cut: String = flat.chars().take(TITLE_LIMIT).collect();
    match cut.rfind(' ') {
        Some(space) if space > TITLE_LIMIT / 2 => format!("{}…", &cut[..space]),
        _ => format!("{cut}…"),
    }
}

/// One chat and everything said in it, or `NotFound` if it is not this
/// caller's. Ownership is checked in the same statement that reads it: a
/// separate check is a second round trip and a window between them.
pub async fn assistant_conversation_detail(
    pool: &PgPool,
    id: Uuid,
    owner: &str,
) -> Result<Value, AppError> {
    let head = sqlx::query(
        "SELECT conversation_id, title, started_at_page, created_at, updated_at
           FROM assistant_conversation
          WHERE conversation_id = $1 AND owner_username = $2 AND archived_at IS NULL",
    )
    .bind(id)
    .bind(owner)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("conversation {id}")))?;

    let messages = sqlx::query(
        "SELECT message_id, seq, role, content, thinking, runs, error, created_at
           FROM assistant_message
          WHERE conversation_id = $1
          ORDER BY seq",
    )
    .bind(id)
    .fetch_all(pool)
    .await?;

    Ok(json!({
        "id": head.get::<Uuid, _>("conversation_id"),
        "title": head.get::<String, _>("title"),
        "page": head.get::<Option<String>, _>("started_at_page"),
        "created_at": head.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "updated_at": head.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
        "messages": messages
            .iter()
            .map(|row| json!({
                "id": row.get::<Uuid, _>("message_id"),
                "seq": row.get::<i32, _>("seq"),
                "role": row.get::<String, _>("role"),
                "content": row.get::<String, _>("content"),
                "thinking": row.get::<Option<String>, _>("thinking"),
                "runs": row.get::<Value, _>("runs"),
                "error": row.get::<Option<String>, _>("error"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            }))
            .collect::<Vec<_>>(),
    }))
}

/// The words of a conversation, oldest first, for handing back to the model.
///
/// Words only: no tool results, no reasoning. That is the same discipline the
/// browser-held transcript had and it matters more now that the server keeps
/// one — a follow-up must be answered from a fresh read, never from figures
/// that were true when the tab was opened.
pub async fn assistant_conversation_turns(
    pool: &PgPool,
    id: Uuid,
    owner: &str,
) -> Result<Vec<(String, String)>, AppError> {
    let rows = sqlx::query(
        "SELECT m.role, m.content
           FROM assistant_message m
           JOIN assistant_conversation c USING (conversation_id)
          WHERE m.conversation_id = $1
            AND c.owner_username = $2
            AND c.archived_at IS NULL
            AND m.content <> ''
          ORDER BY m.seq",
    )
    .bind(id)
    .bind(owner)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .map(|row| {
            (
                row.get::<String, _>("role"),
                row.get::<String, _>("content"),
            )
        })
        .collect())
}

/// Append a turn and move the conversation to the top of the list.
///
/// `seq` is taken inside the insert rather than read and then written: two
/// browser tabs asking the same conversation at once would otherwise both
/// compute the same number and one of them would lose the unique constraint.
pub async fn append_assistant_message(
    pool: &PgPool,
    conversation: Uuid,
    role: &str,
    content: &str,
    thinking: Option<&str>,
    runs: &Value,
    error: Option<&str>,
) -> Result<Uuid, AppError> {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO assistant_message
             (message_id, conversation_id, seq, role, content, thinking, runs, error)
         SELECT $1, $2,
                coalesce((SELECT max(seq) + 1 FROM assistant_message
                           WHERE conversation_id = $2), 0),
                $3, $4, $5, $6, $7",
    )
    .bind(id)
    .bind(conversation)
    .bind(role)
    .bind(content)
    .bind(thinking)
    .bind(runs)
    .bind(error)
    .execute(pool)
    .await?;

    sqlx::query("UPDATE assistant_conversation SET updated_at = now() WHERE conversation_id = $1")
        .bind(conversation)
        .execute(pool)
        .await?;
    Ok(id)
}

/// Rename one. The only thing about a conversation somebody may edit.
pub async fn rename_assistant_conversation(
    pool: &PgPool,
    id: Uuid,
    owner: &str,
    title: &str,
) -> Result<(), AppError> {
    let done = sqlx::query(
        "UPDATE assistant_conversation SET title = $3, updated_at = now()
          WHERE conversation_id = $1 AND owner_username = $2 AND archived_at IS NULL",
    )
    .bind(id)
    .bind(owner)
    .bind(trim_title(title))
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("conversation {id}")));
    }
    Ok(())
}

/// Put one away. Archived rather than deleted: a conversation is the only
/// record of what somebody was told, and "the assistant said we were fine"
/// is a sentence that has to be checkable afterwards.
pub async fn archive_assistant_conversation(
    pool: &PgPool,
    id: Uuid,
    owner: &str,
) -> Result<(), AppError> {
    let done = sqlx::query(
        "UPDATE assistant_conversation SET archived_at = now()
          WHERE conversation_id = $1 AND owner_username = $2 AND archived_at IS NULL",
    )
    .bind(id)
    .bind(owner)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("conversation {id}")));
    }
    Ok(())
}

// ---- Reading anything --------------------------------------------------

/// How long one statement may run. Long enough for a join across a year of
/// sale lines, short enough that a mistake is over before anybody refreshes.
const STATEMENT_TIMEOUT: &str = "20s";

/// The most rows one query may return to the browser. A chat is not a data
/// export; past this the answer is an aggregate the model should have asked
/// the database for.
const ROW_CEILING: i64 = 500;

/// Words that are never part of a legitimate question about this business.
///
/// Two kinds. The first three are the credentials and live sessions — a
/// read-only transaction would return them perfectly happily, and the person
/// asking has no screen anywhere in the hub that shows them. The rest are the
/// server-side reach a SQL prompt is the classic way to acquire: reading files,
/// opening connections, sleeping on a connection.
///
/// Matched as whole identifiers, not substrings: a column called
/// `copy_of_purchase_order` is not `COPY`.
const FORBIDDEN: &[&str] = &[
    "password_hash",
    "auth_session",
    "member_session",
    "member_pairing_code",
    "token_sha256",
    "csrf_token_sha256",
    "pg_authid",
    "pg_shadow",
    "pg_read_file",
    "pg_read_binary_file",
    "pg_ls_dir",
    "pg_stat_file",
    "lo_import",
    "lo_export",
    "dblink",
    "dblink_connect",
    "pg_sleep",
    "set_config",
    "copy",
];

/// What one query answered.
pub struct QueryOutcome {
    /// Column names in the order the query selected them. Taken from the
    /// prepared statement rather than from the first row: a row is a JSON
    /// object and objects have no order, and a table whose columns shuffle
    /// between two runs of the same report is unreadable.
    pub columns: Vec<String>,
    pub rows: Vec<Value>,
    /// True when the ceiling cut the result short, so the answer can say so
    /// instead of quietly describing the first five hundred rows.
    pub truncated: bool,
}

/// Refuse a statement before it reaches the database.
///
/// Everything here is a second line of defence — see the module comment. It
/// exists to give the model a sentence it can act on ("that is not a SELECT")
/// rather than a Postgres error, and to keep the three forbidden tables out of
/// reach of a transaction that would otherwise read them.
fn guard(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim().trim_end_matches(';').trim();
    if trimmed.is_empty() {
        return Err("write a SELECT".into());
    }
    // One statement. A semicolon anywhere but the very end is two.
    if trimmed.contains(';') {
        return Err("one statement at a time — remove the semicolon".into());
    }
    let opening = trimmed
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if opening != "select" && opening != "with" && opening != "table" {
        return Err(format!(
            "only SELECT is allowed here, and this starts with {opening}"
        ));
    }
    // Identifiers, lowercased: split on everything a name cannot contain.
    let words = trimmed
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .map(str::to_ascii_lowercase);
    for word in words {
        if FORBIDDEN.contains(&word.as_str()) {
            return Err(format!(
                "`{word}` is out of bounds — credentials, live sessions and \
                 anything that reaches outside the database are not readable here"
            ));
        }
    }
    Ok(())
}

/// Run one SELECT and answer with its columns and rows.
///
/// The statement is never concatenated into a larger one by hand. It is
/// wrapped twice — once to name it `q` so `to_jsonb` can address the whole
/// row, once more for the ceiling — and both wrappers are structural, so a
/// query that would break them fails to prepare instead of escaping them.
pub async fn run_read_only_query(
    pool: &PgPool,
    sql: &str,
    limit: Option<i64>,
) -> Result<QueryOutcome, AppError> {
    guard(sql).map_err(AppError::Validation)?;
    let statement = sql.trim().trim_end_matches(';').trim();
    let ceiling = limit.unwrap_or(ROW_CEILING).clamp(1, ROW_CEILING);
    // One more than asked for, so the answer knows whether it was cut short
    // without counting the whole result.
    let wrapped = format!(
        "SELECT to_jsonb(q) AS row FROM ({statement}) AS q LIMIT {}",
        ceiling + 1
    );

    // A transaction rather than a connection and two hand-written statements:
    // it rolls back on drop, so an error on any line below cannot leave a
    // pooled connection inside a transaction for whoever gets it next.
    let mut transaction = pool.begin().await?;
    // The whole guarantee, in one line. The server refuses every write inside
    // a read-only transaction — INSERT, UPDATE, DELETE, DDL, and the same
    // things nested in a CTE — whatever the text of the query looks like.
    transaction.execute("SET TRANSACTION READ ONLY").await?;
    // `LOCAL` ties the timeout to this transaction, so the connection does not
    // carry it back to the pool.
    transaction
        .execute(format!("SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'").as_str())
        .await?;

    // Column names come from preparing the statement somebody wrote, not the
    // wrapper — the wrapper has one column called `row`, which is not what was
    // asked for. Preparing also catches a syntax error or an unknown column
    // before any of it runs, and reports it as a sentence the model can act on.
    let described = match transaction.describe(statement).await {
        Ok(described) => described,
        Err(error) => {
            drop(transaction);
            return Err(AppError::Validation(
                explain_failure(pool, statement, &sql_complaint(&error)).await,
            ));
        }
    };
    let columns: Vec<String> = described
        .columns()
        .iter()
        .map(|column| column.name().to_owned())
        .collect();

    let fetched = match sqlx::query(&wrapped).fetch_all(&mut *transaction).await {
        Ok(fetched) => fetched,
        Err(error) => {
            drop(transaction);
            return Err(AppError::Validation(
                explain_failure(pool, statement, &sql_complaint(&error)).await,
            ));
        }
    };

    let truncated = fetched.len() as i64 > ceiling;
    let rows = fetched
        .iter()
        .take(ceiling as usize)
        .map(|row| row.get::<Value, _>("row"))
        .collect();

    Ok(QueryOutcome {
        columns,
        rows,
        truncated,
    })
}

/// A database complaint, as the sentence the model gets.
///
/// The message only — not the envelope, not the position, not a status code.
/// "column s.total does not exist" is repairable; `error returned from
/// database` is not.
/// A failure, with the columns of the tables the query actually named.
///
/// "column s.code does not exist" is repairable in principle and expensive in
/// practice: the model has to guess again, or spend another round trip asking
/// what `sku` holds. Since the query names its tables and this process is
/// already talking to the database, the answer travels back with the
/// complaint — so the second attempt is written against the real names rather
/// than a better guess.
///
/// Only real tables survive: `table_name = ANY(...)` in `column_names` does
/// the filtering, so aliases, keywords and function names in the statement
/// cost nothing but a place in the array.
async fn explain_failure(pool: &PgPool, statement: &str, complaint: &str) -> String {
    let mut words: Vec<String> = Vec::new();
    for word in
        statement.split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
    {
        let word = word.to_ascii_lowercase();
        if word.len() < 3 || words.iter().any(|seen| *seen == word) {
            continue;
        }
        words.push(word);
        if words.len() >= 60 {
            break;
        }
    }

    let Ok(Value::Object(named)) = column_names(pool, &words).await else {
        return complaint.to_owned();
    };
    if named.is_empty() {
        return complaint.to_owned();
    }

    let listed = named
        .iter()
        .map(|(table, columns)| {
            let names = match columns {
                Value::Array(values) => values
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", "),
                _ => String::new(),
            };
            format!("{table}({names})")
        })
        .collect::<Vec<_>>()
        .join("; ");

    format!("{complaint}. The tables you named hold: {listed}")
}

fn sql_complaint(error: &sqlx::Error) -> String {
    match error {
        sqlx::Error::Database(database) => database.message().to_owned(),
        other => other.to_string(),
    }
}

// ---- Reading the shape of it -------------------------------------------

/// What the schema cannot say about itself.
///
/// `information_schema` is the whole truth about names and none of the truth
/// about meaning. It says `sale.status` exists; it does not say a void still
/// has a `total_minor` and must be excluded, or that the business day ends at
/// the shop's own midnight (`site.timezone`), or that `edge_sale` is one shop's own account of itself rather than
/// the fleet's. A model given only the column list writes a query that runs,
/// returns a number, and is wrong — which is the one failure this whole
/// arrangement cannot survive, because nothing on the screen looks different.
///
/// Every line below is **transcribed from code that already runs**, not
/// invented here: the sales rules from `postgres/reports.rs` and the report
/// catalogue's `base_where`, the pool rule from the tree `postgres/queries.rs`
/// builds, the price rule from the pricing engine. A caveat that is merely
/// plausible would be worse than none — it would make the model confidently
/// wrong in a new way — so anything not read off an existing query is left
/// out, and the model is pointed at the tool that already knows.
///
/// Matched by exact table name, or by prefix when the entry ends in `_`.
const CAVEATS: &[(&str, &str)] = &[
    (
        "sale",
        "Only `status = 'COMPLETED'` counts as trade; VOIDED rows keep their          `total_minor` and will inflate any sum that forgets them. Date a sale by          `completed_at`, never `created_at`. The business day is the shop's own: each site keeps an IANA zone in          `site.timezone`, and the local day is `site_local_date(completed_at, site_id)` —          dating by the UTC calendar moves the evening's takings into tomorrow.",
    ),
    (
        "sale_line",
        "Join to `sale` and filter `sale.status = 'COMPLETED'`: a line survives the          voiding of the sale it belongs to. Same shop-local business day as `sale`.",
    ),
    (
        "sale_payment",
        "Same as `sale_line`: filter on the parent sale's COMPLETED status. A tender          split that includes voided sales does not reconcile against the till.",
    ),
    (
        "edge_",
        "An `edge_` table is what one shop or the DC reported about itself, kept for          reconciliation. It is not the fleet's books and it is not complete. Every          question about the business as a whole is answered from the table without          the prefix — `sale`, not `edge_sale`.",
    ),
    (
        "inventory_projection",
        "Stock lives in a tree of places, and a rollup place holds what its leaves          hold. Summing every row therefore counts the same garment more than once.          Use the `inventory_pools` tool for any position across sites or pools; use          this table only for one named place you have already identified.",
    ),
    (
        "operational_pool",
        "See `inventory_projection`: a pool can roll up other pools, and the totals          are not additive. The `inventory_pools` tool resolves the tree.",
    ),
    (
        "commercial_",
        "A shelf price is not in any one of these tables. It is resolved by the          pricing engine through the published version, with rungs overriding one          another — a base price, an assortment rule, a markdown, a promotion.          Joining these tables by hand produces a price no till would ever charge.          Use the `article_prices` tool for what a shop charges.",
    ),
    (
        "member",
        "The six segments the Members screen shows are derived on every read, never          stored: there is no membership column to select. A saved segment is a          definition (clauses), not a list of people.",
    ),
];

/// The caveats that apply to the tables just described.
fn caveats_for(tables: &[String]) -> Value {
    let mut found = Map::new();
    for table in tables {
        for (key, rule) in CAVEATS {
            let matches = match key.strip_suffix('_') {
                Some(_) => table.starts_with(key),
                None => table == key,
            };
            if matches {
                found.insert(table.clone(), Value::String((*rule).to_owned()));
                break;
            }
        }
    }
    Value::Object(found)
}

/// The whole schema is 163 tables. Listing every column of every one of them
/// costs more than the question is worth, so a bare call answers with names
/// and sizes and a needle asks for the detail.
pub async fn describe_schema(pool: &PgPool, needle: Option<&str>) -> Result<Value, AppError> {
    let Some(needle) = needle.map(str::trim).filter(|value| !value.is_empty()) else {
        return table_index(pool).await;
    };

    // A table matches by its own name or by any column's name, so "supplier"
    // finds `goods_receipt` through `supplier_id` — which is how somebody
    // actually looks for a join.
    let rows = sqlx::query(
        "SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.ordinal_position
           FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name IN (
                SELECT table_name FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND (table_name ILIKE '%' || $1 || '%'
                        OR column_name ILIKE '%' || $1 || '%')
            )
            AND c.table_name NOT IN ('auth_session', 'member_session', 'member_pairing_code')
          ORDER BY c.table_name, c.ordinal_position
          LIMIT 1200",
    )
    .bind(needle)
    .fetch_all(pool)
    .await?;

    let mut tables: Vec<Value> = Vec::new();
    let mut current: Option<(String, Vec<Value>)> = None;
    for row in &rows {
        let table = row.get::<String, _>("table_name");
        let column = row.get::<String, _>("column_name");
        // The one column that is never described, so a query cannot be
        // written against a name the model was told about.
        if column == "password_hash" {
            continue;
        }
        let described = json!({
            "name": column,
            "type": row.get::<String, _>("data_type"),
            "nullable": row.get::<String, _>("is_nullable") == "YES",
        });
        match &mut current {
            Some((name, columns)) if *name == table => columns.push(described),
            _ => {
                if let Some((name, columns)) = current.take() {
                    tables.push(json!({ "table": name, "columns": columns }));
                }
                current = Some((table, vec![described]));
            }
        }
    }
    if let Some((name, columns)) = current.take() {
        tables.push(json!({ "table": name, "columns": columns }));
    }

    let names: Vec<String> = tables
        .iter()
        .filter_map(|table| table.get("table")?.as_str().map(str::to_owned))
        .collect();

    let joins = foreign_keys(pool, &names).await?;
    let neighbours = neighbour_names(&names, &joins);
    // The caveats cover both sides of a join, because the rule that decides
    // whether a `sale_line` query is right is written on `sale`.
    let touched: Vec<String> = names.iter().chain(neighbours.iter()).cloned().collect();

    Ok(json!({
        "needle": needle,
        "tables": tables,
        // The joins, separately. Without them the model invents a plausible
        // key name and the query fails on a column that does not exist.
        "foreign_keys": joins,
        // What the columns do not say. See `CAVEATS`.
        "caveats": caveats_for(&touched),
        // And the columns of everything on the other end of those joins.
        //
        // This is the difference between one round trip and three. Asked about
        // `sale_line`, the model is told it joins to `sku` — and then writes
        // `sku.code`, because it has been told the table exists and never told
        // what is in it. Naming a table without naming its columns is an
        // invitation to guess, and the guess is always the shorter name.
        "joined_tables": column_names(pool, &neighbours).await?,
    }))
}

/// The column names — names only — of every table reachable by one join from
/// the ones just described.
///
/// Names without types, because this exists to stop a guess rather than to
/// support a cast: `sku(id, sku_code, article_id, color, size)` is enough to
/// write the join correctly, and the full description is one more call away.
fn neighbour_names(described: &[String], joins: &[Value]) -> Vec<String> {
    let mut wanted: Vec<String> = Vec::new();
    for join in joins {
        for side in ["from", "to"] {
            let Some(reference) = join.get(side).and_then(Value::as_str) else {
                continue;
            };
            let Some((table, _)) = reference.split_once('.') else {
                continue;
            };
            if described.iter().any(|name| name == table) {
                continue;
            }
            if !wanted.iter().any(|name| name == table) {
                wanted.push(table.to_owned());
            }
        }
    }
    // A needle that matches half the schema would otherwise drag the other
    // half in behind it.
    wanted.truncate(NEIGHBOUR_CEILING);
    wanted
}

/// How many joined tables are worth listing. Past this the answer is a
/// narrower needle, not a longer reply.
const NEIGHBOUR_CEILING: usize = 25;

/// `{ "sku": ["id", "sku_code", …] }` for the tables asked for.
async fn column_names(pool: &PgPool, tables: &[String]) -> Result<Value, AppError> {
    if tables.is_empty() {
        return Ok(json!({}));
    }
    let rows = sqlx::query(
        "SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ANY($1)
            AND column_name <> 'password_hash'
            AND table_name NOT IN ('auth_session', 'member_session', 'member_pairing_code')
          ORDER BY table_name, ordinal_position",
    )
    .bind(tables)
    .fetch_all(pool)
    .await?;

    let mut listed = Map::new();
    for row in &rows {
        let table = row.get::<String, _>("table_name");
        let column = row.get::<String, _>("column_name");
        match listed
            .entry(table)
            .or_insert_with(|| Value::Array(Vec::new()))
        {
            Value::Array(columns) => columns.push(Value::String(column)),
            _ => unreachable!("the entry above is always an array"),
        }
    }
    Ok(Value::Object(listed))
}

/// Every table, its estimated size, and what it is for is left to its name.
///
/// `reltuples` is the planner's estimate, not a count: counting 163 tables to
/// answer "what is here" would be the most expensive question anybody asks.
/// It is here because empty and enormous are the two facts that change which
/// table somebody should query, and both survive an estimate.
async fn table_index(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(
        // `reltuples` is -1 on a table the planner has never looked at, which
        // is not the same fact as zero and must not be flattened into it: a
        // model told a table with two thousand rows in it holds none will
        // answer that the business has no sales. Unknown is reported as
        // unknown.
        "SELECT c.relname AS table_name,
                CASE WHEN c.reltuples < 0 THEN NULL
                     ELSE c.reltuples::bigint END AS estimated_rows
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind IN ('r', 'v', 'm')
            AND c.relname NOT IN ('auth_session', 'member_session', 'member_pairing_code')
            AND c.relname NOT LIKE '\\_sqlx%'
          ORDER BY c.relname",
    )
    .fetch_all(pool)
    .await?;

    Ok(json!({
        "note": "Call this again with a needle to get the columns and joins of the \
                 tables you want. `estimated_rows` is the planner's estimate, not a \
                 count, and null means it has never been measured — which is not the \
                 same as empty.",
        "tables": rows
            .iter()
            .map(|row| json!({
                "table": row.get::<String, _>("table_name"),
                "estimated_rows": row.get::<Option<i64>, _>("estimated_rows"),
            }))
            .collect::<Vec<_>>(),
    }))
}

/// Which column points at which, for the tables just described.
async fn foreign_keys(pool: &PgPool, tables: &[String]) -> Result<Vec<Value>, AppError> {
    if tables.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(
        "SELECT src.relname AS from_table,
                a.attname     AS from_column,
                tgt.relname   AS to_table,
                b.attname     AS to_column
           FROM pg_constraint con
           JOIN pg_class src ON src.oid = con.conrelid
           JOIN pg_class tgt ON tgt.oid = con.confrelid
           JOIN unnest(con.conkey)  WITH ORDINALITY AS k(attnum, ord) ON true
           JOIN unnest(con.confkey) WITH ORDINALITY AS f(attnum, ord) ON f.ord = k.ord
           JOIN pg_attribute a ON a.attrelid = con.conrelid  AND a.attnum = k.attnum
           JOIN pg_attribute b ON b.attrelid = con.confrelid AND b.attnum = f.attnum
          WHERE con.contype = 'f'
            AND (src.relname = ANY($1) OR tgt.relname = ANY($1))
          ORDER BY 1, 2
          LIMIT 300",
    )
    .bind(tables)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|row| {
            json!({
                "from": format!(
                    "{}.{}",
                    row.get::<String, _>("from_table"),
                    row.get::<String, _>("from_column")
                ),
                "to": format!(
                    "{}.{}",
                    row.get::<String, _>("to_table"),
                    row.get::<String, _>("to_column")
                ),
            })
        })
        .collect())
}

/// Rows as a JSON array of arrays, in column order.
///
/// The browser draws a table from `columns` and these; the model is shown the
/// same thing with fewer rows. Arrays rather than objects because a column
/// name repeated on every row of a two-hundred-row result is the largest part
/// of the payload and carries nothing.
pub fn rows_as_matrix(columns: &[String], rows: &[Value]) -> Vec<Value> {
    rows.iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_else(Map::new);
            Value::Array(
                columns
                    .iter()
                    .map(|column| object.get(column).cloned().unwrap_or(Value::Null))
                    .collect(),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_reads_are_allowed_through() {
        assert!(guard("SELECT 1").is_ok());
        assert!(guard("  with recent as (select 1) select * from recent ").is_ok());
        assert!(guard("UPDATE sale SET total_minor = 0").is_err());
        assert!(guard("DELETE FROM sale").is_err());
        assert!(guard("SELECT 1; DROP TABLE sale").is_err());
        // A trailing semicolon is punctuation, not a second statement.
        assert!(guard("SELECT 1;").is_ok());
    }

    #[test]
    fn credentials_and_sessions_are_out_of_bounds() {
        assert!(guard("SELECT password_hash FROM app_user").is_err());
        assert!(guard("SELECT * FROM auth_session").is_err());
        assert!(guard("SELECT pg_read_file('/etc/passwd')").is_err());
        // The account itself is readable — who wrote a report is a fair
        // question — and only the hash is not.
        assert!(guard("SELECT username, role FROM app_user").is_ok());
    }

    #[test]
    fn a_forbidden_word_inside_a_name_is_still_a_name() {
        assert!(guard("SELECT copy_of_id FROM purchase_order").is_ok());
    }

    #[test]
    fn a_caveat_reaches_the_table_it_is_written_for() {
        let found = caveats_for(&["sale".to_owned(), "article".to_owned()]);
        assert!(
            found.get("sale").is_some(),
            "sale carries the COMPLETED rule"
        );
        assert!(
            found.get("article").is_none(),
            "nothing is invented for article"
        );

        // The two prefix rules, which are the ones that would silently stop
        // matching if the suffix convention were changed.
        let mirrored = caveats_for(&["edge_sale_line".to_owned()]);
        assert!(mirrored.get("edge_sale_line").is_some());
        let priced = caveats_for(&["commercial_price_rule".to_owned()]);
        assert!(priced.get("commercial_price_rule").is_some());
    }

    #[test]
    fn a_title_is_one_line_and_fits_a_row() {
        assert_eq!(trim_title("  how much\nstock  "), "how much stock");
        assert_eq!(trim_title(""), "New chat");
        let long = trim_title(&"berapa penjualan ".repeat(20));
        assert!(long.chars().count() <= TITLE_LIMIT + 1);
        assert!(long.ends_with('…'));
    }
}
