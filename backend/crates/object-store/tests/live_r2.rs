//! Round-trip against a real bucket.
//!
//! Unit tests prove the signature is built the way the specification says.
//! They cannot prove R2 agrees — a signature can be self-consistently wrong.
//! This test is the only thing that settles that, so it exists; it is
//! `#[ignore]` because it needs credentials and a network, and CI has neither.
//!
//! ```sh
//! R2_ACCOUNT_ID=... R2_BUCKET=images R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//!   cargo test -p object-store -- --ignored --nocapture
//! ```

use object_store::{Config, Error, ObjectStore};

fn store_from_env() -> Option<ObjectStore> {
    let account = std::env::var("R2_ACCOUNT_ID").ok()?;
    let bucket = std::env::var("R2_BUCKET").ok()?;
    let key_id = std::env::var("R2_ACCESS_KEY_ID").ok()?;
    let secret = std::env::var("R2_SECRET_ACCESS_KEY").ok()?;
    ObjectStore::new(Config::r2(&account, bucket, key_id, secret)).ok()
}

#[tokio::test]
#[ignore = "needs R2 credentials and network"]
async fn put_head_get_presign_delete_round_trip() {
    let Some(store) = store_from_env() else {
        panic!("set R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY");
    };
    let key = "_smoke/object-store-round-trip.txt";
    let body = b"catalogue smoke test".to_vec();

    let meta = store
        .put(key, body.clone(), "text/plain", Some("no-store"))
        .await
        .unwrap_or_else(|e| panic!("put: {e}"));
    assert_eq!(meta.size, body.len() as u64);
    println!("put   ok  etag={:?}", meta.etag);

    let head = store
        .head(key)
        .await
        .unwrap_or_else(|e| panic!("head: {e}"));
    assert_eq!(head.map(|m| m.size), Some(body.len() as u64));
    println!("head  ok");

    let fetched = store.get(key).await.unwrap_or_else(|e| panic!("get: {e}"));
    assert_eq!(fetched, body, "bytes came back changed");
    println!("get   ok  {} bytes", fetched.len());

    // A presigned URL must work from a client that holds no credentials at all.
    let url = store
        .presign_get(key, 300)
        .unwrap_or_else(|e| panic!("presign: {e}"));
    let via_url = reqwest::get(&url)
        .await
        .unwrap_or_else(|e| panic!("presigned fetch: {e}"));
    assert!(via_url.status().is_success(), "presigned GET {}", via_url.status());
    let bytes = via_url.bytes().await.unwrap_or_default().to_vec();
    assert_eq!(bytes, body);
    println!("presign ok");

    store
        .delete(key)
        .await
        .unwrap_or_else(|e| panic!("delete: {e}"));
    assert!(matches!(store.get(key).await, Err(Error::NotFound(_))));
    println!("delete ok — gone");
}

/// An object this client did not write should be readable through it, which is
/// a stronger check than a key we put there ourselves a moment ago.
///
/// The supplier prefix, not the catalogue one: `catalogue/` is keyed by our own
/// article codes and stays empty until articles exist, while `supplier/hm/`
/// holds the imported photographs under the supplier's own numbering.
#[tokio::test]
#[ignore = "needs R2 credentials and network"]
async fn reads_an_uploaded_catalogue_image() {
    let Some(store) = store_from_env() else {
        panic!("set the R2_* environment variables");
    };
    let key = "supplier/hm/0108775015.jpg";
    let meta = store
        .head(key)
        .await
        .unwrap_or_else(|e| panic!("head: {e}"));
    let meta = meta.unwrap_or_else(|| panic!("{key} is not in the bucket"));
    assert!(meta.size > 0);
    println!("{key}: {} bytes, type {:?}", meta.size, meta.content_type);
}
