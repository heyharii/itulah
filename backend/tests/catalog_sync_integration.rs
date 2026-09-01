//! Master data flowing DOWN: a catalogue delivered to an edge in chunks.
//!
//! The property under test is atomicity. A till must never see a catalogue
//! that is half-arrived: it would price some items and silently omit others,
//! and the omission looks like a missing product rather than a broken
//! delivery. So nothing becomes visible until the last chunk lands and the
//! hash over every item matches what the centre committed to.

use inventory_backend::cloud::domain::{
    catalog_content_hash, sign_command, CatalogItem, PushedCommand, COMMAND_CATALOG_CHUNK,
};
use inventory_backend::cloud::postgres::command_signing_key;
use inventory_backend::edge::{EdgeRole, NodeContext, SiteId, SqliteEdge, SqliteSyncStore};
use inventory_backend::sync::port::SyncStore;
use serde_json::json;
use uuid::Uuid;

const KEY: &str = "catalog-test-key";

fn item(sku: &str, name: &str) -> CatalogItem {
    CatalogItem {
        sku_code: sku.into(),
        name: name.into(),
        uom: "EA".into(),
        barcode: Some(format!("899{sku}")),
        tax_category: "STANDARD".into(),
        active: true,
        base_price_minor: Some(100_000),
    }
}

struct Edge {
    edge: SqliteEdge,
    store: SqliteSyncStore,
}

impl Edge {
    fn fresh() -> Self {
        let site = SiteId::new("store-07").unwrap_or_else(|e| panic!("site: {e}"));
        let node = NodeContext::new("store-07-edge", EdgeRole::Store, site)
            .unwrap_or_else(|e| panic!("node: {e}"));
        // The adapter provisions its own sync identity at open; this suite
        // never touches the upstream stream, only the commands coming down.
        let edge = SqliteEdge::open_in_memory(node).unwrap_or_else(|e| panic!("edge: {e}"));
        let store = SqliteSyncStore::new(edge.connection());
        Self { edge, store }
    }

    /// What the till can see: the catalogue rows that are actually live.
    fn visible_items(&self) -> Vec<(String, String)> {
        let connection = self.edge.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        let mut statement = guard
            .prepare("SELECT sku_code, name FROM catalog_item ORDER BY sku_code")
            .unwrap_or_else(|e| panic!("prepare: {e}"));
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap_or_else(|e| panic!("query: {e}"));
        rows.map(|r| r.unwrap_or_else(|e| panic!("row: {e}")))
            .collect()
    }

    fn resident_generation(&self) -> Option<i64> {
        let connection = self.edge.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        guard
            .query_row("SELECT generation FROM catalog_state", [], |row| row.get(0))
            .ok()
    }
}

/// Chunk a catalogue exactly as `publish_catalog` does, and sign each piece.
fn chunks_for(
    generation: i64,
    items: &[CatalogItem],
    per_chunk: usize,
    first_seq: i64,
) -> Vec<PushedCommand> {
    let snapshot_id = Uuid::new_v4();
    let content_hash = catalog_content_hash(items);
    let batches: Vec<&[CatalogItem]> = if items.is_empty() {
        vec![&[]]
    } else {
        items.chunks(per_chunk).collect()
    };
    let count = batches.len() as u32;
    let key = command_signing_key(KEY);
    batches
        .iter()
        .enumerate()
        .map(|(index, batch)| {
            let seq = first_seq + index as i64;
            let command_id = Uuid::new_v4();
            let command_type = COMMAND_CATALOG_CHUNK.to_string();
            let payload = json!({
                "snapshot_id": snapshot_id,
                "generation": generation,
                "chunk_index": index as u32,
                "chunk_count": count,
                "content_hash": content_hash,
                "items": batch,
            });
            let signature = sign_command(
                key.as_bytes(),
                seq,
                &command_id,
                &command_type,
                &payload,
                None,
                false,
            );
            PushedCommand {
                seq,
                command_id,
                command_type,
                payload,
                expires_at: None,
                revoked: false,
                signature,
            }
        })
        .collect()
}

#[tokio::test]
async fn a_catalogue_becomes_visible_only_when_every_chunk_has_landed() {
    let edge = Edge::fresh();
    let key = command_signing_key(KEY);
    let items = vec![
        item("A1", "Beras 5kg"),
        item("A2", "Minyak Goreng 2L"),
        item("A3", "Gula 1kg"),
        item("A4", "Telur 1kg"),
        item("A5", "Tepung 1kg"),
    ];
    let chunks = chunks_for(7, &items, 2, 1);
    assert_eq!(chunks.len(), 3, "5 items at 2 per chunk is 3 chunks");

    // Deliver every chunk but the last: still nothing visible.
    let partial = &chunks[..chunks.len() - 1];
    let report = edge
        .store
        .apply_commands(key.as_bytes(), partial)
        .await
        .unwrap_or_else(|e| panic!("partial: {e}"));
    assert_eq!(report.applied, partial.len() as u64);
    assert_eq!(report.blocked, None);
    assert!(
        edge.visible_items().is_empty(),
        "a half-arrived catalogue must not be visible to the till"
    );
    assert_eq!(edge.resident_generation(), None);

    // The last chunk completes it, and the whole catalogue appears at once.
    let report = edge
        .store
        .apply_commands(key.as_bytes(), &chunks[chunks.len() - 1..])
        .await
        .unwrap_or_else(|e| panic!("final: {e}"));
    assert_eq!(report.blocked, None);
    assert_eq!(report.applied, 1);
    let visible = edge.visible_items();
    assert_eq!(visible.len(), 5);
    assert_eq!(visible[0], ("A1".into(), "Beras 5kg".into()));
    assert_eq!(edge.resident_generation(), Some(7));
}

#[tokio::test]
async fn a_tampered_chunk_leaves_the_previous_catalogue_untouched() {
    let edge = Edge::fresh();
    let key = command_signing_key(KEY);

    // A good catalogue lands first.
    let first = vec![item("A1", "Beras 5kg")];
    edge.store
        .apply_commands(key.as_bytes(), &chunks_for(1, &first, 500, 1))
        .await
        .unwrap_or_else(|e| panic!("first: {e}"));
    assert_eq!(edge.visible_items().len(), 1);

    // A second publication whose items do not match its declared hash: the
    // signature still verifies (the centre signed exactly these bytes), so
    // this is the case where the CENTRE is inconsistent, not an attacker.
    let second = vec![item("B1", "Kopi 200g"), item("B2", "Teh 100g")];
    let mut bad = chunks_for(2, &second, 500, 2);
    bad[0].payload["content_hash"] =
        json!("0000000000000000000000000000000000000000000000000000000000000000");
    let command_id = bad[0].command_id;
    let command_type = bad[0].command_type.clone();
    bad[0].signature = sign_command(
        key.as_bytes(),
        bad[0].seq,
        &command_id,
        &command_type,
        &bad[0].payload,
        None,
        false,
    );

    let report = edge
        .store
        .apply_commands(key.as_bytes(), &bad)
        .await
        .unwrap_or_else(|e| panic!("bad: {e}"));
    assert_eq!(report.applied, 0);
    let blocked = report
        .blocked
        .unwrap_or_else(|| panic!("a hash mismatch must block the stream"));
    assert!(
        blocked.reason.contains("hash mismatch"),
        "{}",
        blocked.reason
    );

    // The shop keeps trading on the catalogue it already had.
    assert_eq!(
        edge.visible_items(),
        vec![("A1".into(), "Beras 5kg".into())]
    );
    assert_eq!(edge.resident_generation(), Some(1));
}

#[tokio::test]
async fn an_older_generation_cannot_walk_the_catalogue_backwards() {
    let edge = Edge::fresh();
    let key = command_signing_key(KEY);

    let current = vec![item("N1", "Harga baru")];
    edge.store
        .apply_commands(key.as_bytes(), &chunks_for(9, &current, 500, 1))
        .await
        .unwrap_or_else(|e| panic!("gen 9: {e}"));
    assert_eq!(edge.resident_generation(), Some(9));

    // A stale publication arrives late — ordinary during a re-publication.
    // It must not be applied, and must NOT block the stream either: refusing
    // to go backwards is a correct outcome, not an incident.
    let stale = vec![item("O1", "Harga lama")];
    let report = edge
        .store
        .apply_commands(key.as_bytes(), &chunks_for(3, &stale, 500, 2))
        .await
        .unwrap_or_else(|e| panic!("stale: {e}"));
    assert_eq!(report.blocked, None, "a stale generation is not an error");
    assert_eq!(edge.resident_generation(), Some(9));
    assert_eq!(
        edge.visible_items(),
        vec![("N1".into(), "Harga baru".into())]
    );
}

#[tokio::test]
async fn re_delivering_the_same_generation_changes_nothing() {
    let edge = Edge::fresh();
    let key = command_signing_key(KEY);
    let items = vec![item("A1", "Beras 5kg"), item("A2", "Gula 1kg")];

    edge.store
        .apply_commands(key.as_bytes(), &chunks_for(4, &items, 500, 1))
        .await
        .unwrap_or_else(|e| panic!("first: {e}"));
    let before = edge.visible_items();

    // A resend after a lost response: same generation, different snapshot id.
    let report = edge
        .store
        .apply_commands(key.as_bytes(), &chunks_for(4, &items, 500, 2))
        .await
        .unwrap_or_else(|e| panic!("resend: {e}"));
    assert_eq!(report.blocked, None);
    assert_eq!(edge.visible_items(), before);
    assert_eq!(edge.resident_generation(), Some(4));
}
