// `sqlx::migrate!` embeds the migration files at compile time, and cargo does
// not know it read them: adding a migration and rebuilding without touching a
// `.rs` file produced a binary that booted, migrated to the PREVIOUS head and
// said nothing. This makes a new or edited migration a reason to recompile.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
