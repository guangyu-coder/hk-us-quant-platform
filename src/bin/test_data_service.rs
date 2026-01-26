use hk_us_quant_platform::config::AppConfig;
use hk_us_quant_platform::data::DataService;
use hk_us_quant_platform::events::EventBus;
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // This is just a manual smoke test
    let config = AppConfig::load().unwrap_or_else(|_| {
        println!("Config load failed, using defaults...");
        // Provide enough for service init if possible, or just fail
        panic!("Need config for DB/Redis");
    });

    let db_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database.url)
        .await?;

    let redis_client = redis::Client::open(config.redis.url.as_str())?;
    let redis_conn = redis_client.get_multiplexed_async_connection().await?;
    let event_bus = Arc::new(EventBus::new(redis_client.clone()).await?);

    let data_service = DataService::new(db_pool, redis_conn, event_bus).await?;

    println!("Testing AAPL (TwelveData popular)...");
    match data_service
        .collect_market_data(vec!["AAPL".to_string()])
        .await
    {
        Ok(_) => println!("Successfully collected AAPL"),
        Err(e) => println!("Failed to collect AAPL: {}", e),
    }

    println!("Testing 0700.HK (Yahoo fallback)...");
    match data_service
        .collect_market_data(vec!["0700.HK".to_string()])
        .await
    {
        Ok(_) => println!("Successfully collected 0700.HK"),
        Err(e) => println!("Failed to collect 0700.HK: {}", e),
    }

    Ok(())
}
