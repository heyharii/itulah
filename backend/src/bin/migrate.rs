use inventory_edge::{AppConfig, AppError};
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), AppError> {
    dotenvy::dotenv().ok();
    let config = AppConfig::from_env()?;
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&config.database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    println!("inventory migrations applied successfully");
    Ok(())
}
