//! How the pricing path behaves at real catalogue sizes.
//!
//! Part measurement, part guard. The timings are printed (run with
//! `--nocapture`) because they are the only way to see the shape of the curve;
//! the assertion is on how much a basket *reads*, because that is deterministic
//! and a wall-clock threshold would only flake.
//!
//! The invariant is the one that was broken: pricing five items must not depend
//! on how many products the company sells. It used to load the whole price book
//! on every sale, which was invisible in a test shop with ten SKUs in it and
//! thirty milliseconds a sale in a real one.

use inventory_backend::edge::pricing;
use inventory_backend::edge::{EdgeInventory, EdgeRole, NodeContext, SiteId, SqliteEdge};
use std::time::Instant;

const SHOP: &str = "store-07";

fn shop_with(sku_count: usize) -> SqliteEdge {
    let site = SiteId::new(SHOP).unwrap_or_else(|e| panic!("site: {e}"));
    let node =
        NodeContext::new(SHOP, EdgeRole::Store, site).unwrap_or_else(|e| panic!("node: {e}"));
    let edge = SqliteEdge::open_in_memory(node).unwrap_or_else(|e| panic!("edge: {e}"));
    {
        let connection = edge.connection();
        let mut guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        let tx = guard.transaction().unwrap_or_else(|e| panic!("tx: {e}"));
        tx.execute(
            "INSERT INTO commercial_publication(id,version,name,effective_from,effective_to,activated_at)
             VALUES('pub-1',1,'v1','2020-01-01T00:00:00Z',NULL,'2020-01-01T00:00:00Z')",
            [],
        )
        .unwrap_or_else(|e| panic!("publication: {e}"));
        for index in 0..sku_count {
            let sku = format!("SKU{index:08}");
            tx.execute(
                "INSERT INTO catalog_item(sku_code,name,uom,barcode,tax_category,active,generation,updated_at)
                 VALUES(?1,?2,'PCS',NULL,'STANDARD',1,1,'2020-01-01T00:00:00Z')",
                rusqlite::params![sku, format!("Item {index}")],
            )
            .unwrap_or_else(|e| panic!("catalog: {e}"));
            tx.execute(
                "INSERT INTO commercial_price_rule(publication_id,sku_id,sku_code,site_id,channel,sellable,currency,unit_price_minor,tax_category)
                 VALUES('pub-1',?3,?1,NULL,'STORE',1,'IDR',?2,'STANDARD')",
                rusqlite::params![sku, 100_000 + index as i64, uuid::Uuid::new_v4().to_string()],
            )
            .unwrap_or_else(|e| panic!("price: {e}"));
        }
        tx.commit().unwrap_or_else(|e| panic!("commit: {e}"));
    }
    edge
}

#[test]
fn how_the_pricing_path_scales() {
    println!("\n  skus | full catalogue | 100-row page | one 5-item basket");
    println!("  -----+----------------+--------------+------------------");
    for &count in &[500_usize, 2_000, 10_000, 40_000, 100_000] {
        let edge = shop_with(count);

        let started = Instant::now();
        let rows = edge
            .store_catalog()
            .unwrap_or_else(|e| panic!("catalogue: {e}"));
        let catalogue = started.elapsed();
        assert_eq!(rows.len(), count);

        let connection = edge.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        let started = Instant::now();
        let page = pricing::store_catalog_page(
            &guard,
            SHOP,
            pricing::STORE_CHANNEL,
            chrono::Utc::now(),
            pricing::CatalogQuery {
                limit: Some(100),
                ..Default::default()
            },
        )
        .unwrap_or_else(|e| panic!("catalogue page: {e}"));
        let page_time = started.elapsed();
        assert_eq!(page.items.len(), count.min(100));

        let basket: Vec<String> = (0..5).map(|i| format!("SKU{i:08}")).collect();

        // The guard: a five-item basket reads five prices, whatever the shop's
        // range. Asserted on the snapshot rather than the clock so it cannot
        // flake on a loaded machine.
        let narrowed =
            pricing::load_snapshot_for(&guard, SHOP, pricing::STORE_CHANNEL, Some(&basket))
                .unwrap_or_else(|e| panic!("snapshot: {e}"));
        assert_eq!(
            narrowed.entries.len(),
            basket.len(),
            "pricing {} items read {} prices out of {count} — a basket must not \
             read the whole price book",
            basket.len(),
            narrowed.entries.len(),
        );

        let started = Instant::now();
        let quoted = pricing::quote(
            &guard,
            SHOP,
            pricing::STORE_CHANNEL,
            chrono::Utc::now(),
            &basket,
            &[],
            None,
            &[],
        )
        .unwrap_or_else(|e| panic!("quote: {e}"));
        let sale = started.elapsed();
        assert!(quoted.is_some());

        println!(
            "  {count:>5} | {:>13.1}ms | {:>9.1}ms | {:>13.1}ms",
            catalogue.as_secs_f64() * 1000.0,
            page_time.as_secs_f64() * 1000.0,
            sale.as_secs_f64() * 1000.0
        );
    }
    println!();
}
