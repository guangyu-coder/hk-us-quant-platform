use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::env;

/// Application configuration structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub database: DatabaseConfig,
    pub redis: RedisConfig,
    pub server: ServerConfig,
    pub logging: LoggingConfig,
    pub trading: TradingConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConfig {
    pub url: String,
    pub max_connections: u32,
    pub min_connections: u32,
    pub connection_timeout: u64,
    pub idle_timeout: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisConfig {
    pub url: String,
    pub max_connections: u32,
    pub connection_timeout: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub workers: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    pub level: String,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradingConfig {
    pub default_portfolio_id: String,
    pub max_order_size: i64,
    pub risk_check_enabled: bool,
    pub paper_trading: bool,
}

impl AppConfig {
    /// Load configuration from environment variables and config files
    pub fn load() -> Result<Self> {
        // Load .env file if it exists
        dotenvy::dotenv().ok();

        let config = Self {
            database: DatabaseConfig {
                url: env::var("DATABASE_URL").unwrap_or_else(|_| {
                    "postgresql://postgres:password@localhost:5432/quant_platform".to_string()
                }),
                max_connections: env::var("DATABASE_MAX_CONNECTIONS")
                    .unwrap_or_else(|_| "20".to_string())
                    .parse()
                    .context("Invalid DATABASE_MAX_CONNECTIONS")?,
                min_connections: env::var("DATABASE_MIN_CONNECTIONS")
                    .unwrap_or_else(|_| "5".to_string())
                    .parse()
                    .context("Invalid DATABASE_MIN_CONNECTIONS")?,
                connection_timeout: env::var("DATABASE_CONNECTION_TIMEOUT")
                    .unwrap_or_else(|_| "30".to_string())
                    .parse()
                    .context("Invalid DATABASE_CONNECTION_TIMEOUT")?,
                idle_timeout: env::var("DATABASE_IDLE_TIMEOUT")
                    .unwrap_or_else(|_| "600".to_string())
                    .parse()
                    .context("Invalid DATABASE_IDLE_TIMEOUT")?,
            },
            redis: RedisConfig {
                url: env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string()),
                max_connections: env::var("REDIS_MAX_CONNECTIONS")
                    .unwrap_or_else(|_| "10".to_string())
                    .parse()
                    .context("Invalid REDIS_MAX_CONNECTIONS")?,
                connection_timeout: env::var("REDIS_CONNECTION_TIMEOUT")
                    .unwrap_or_else(|_| "5".to_string())
                    .parse()
                    .context("Invalid REDIS_CONNECTION_TIMEOUT")?,
            },
            server: ServerConfig {
                host: env::var("SERVER_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
                port: env::var("SERVER_PORT")
                    .unwrap_or_else(|_| "8080".to_string())
                    .parse()
                    .context("Invalid SERVER_PORT")?,
                workers: env::var("SERVER_WORKERS")
                    .unwrap_or_else(|_| "4".to_string())
                    .parse()
                    .context("Invalid SERVER_WORKERS")?,
            },
            logging: LoggingConfig {
                level: env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string()),
                format: env::var("LOG_FORMAT").unwrap_or_else(|_| "json".to_string()),
            },
            trading: TradingConfig {
                default_portfolio_id: env::var("DEFAULT_PORTFOLIO_ID")
                    .unwrap_or_else(|_| "default".to_string()),
                max_order_size: env::var("MAX_ORDER_SIZE")
                    .unwrap_or_else(|_| "10000".to_string())
                    .parse()
                    .context("Invalid MAX_ORDER_SIZE")?,
                risk_check_enabled: env::var("RISK_CHECK_ENABLED")
                    .unwrap_or_else(|_| "true".to_string())
                    .parse()
                    .context("Invalid RISK_CHECK_ENABLED")?,
                paper_trading: env::var("PAPER_TRADING")
                    .unwrap_or_else(|_| "true".to_string())
                    .parse()
                    .context("Invalid PAPER_TRADING")?,
            },
        };

        Self::validate(&config)?;
        Ok(config)
    }

    /// Validate configuration parameters
    fn validate(config: &AppConfig) -> Result<()> {
        // Validate database configuration
        if config.database.max_connections == 0 {
            anyhow::bail!("Database max_connections must be greater than 0");
        }

        if config.database.min_connections > config.database.max_connections {
            anyhow::bail!("Database min_connections cannot be greater than max_connections");
        }

        // Validate Redis configuration
        if config.redis.max_connections == 0 {
            anyhow::bail!("Redis max_connections must be greater than 0");
        }

        // Validate server configuration
        if config.server.port == 0 {
            anyhow::bail!("Server port must be greater than 0");
        }

        if config.server.workers == 0 {
            anyhow::bail!("Server workers must be greater than 0");
        }

        // Validate trading configuration
        if config.trading.max_order_size <= 0 {
            anyhow::bail!("Max order size must be greater than 0");
        }

        // Validate log level
        match config.logging.level.to_lowercase().as_str() {
            "trace" | "debug" | "info" | "warn" | "error" => {}
            _ => anyhow::bail!("Invalid log level: {}", config.logging.level),
        }

        Ok(())
    }

    /// Get environment-specific configuration
    pub fn get_environment(&self) -> String {
        env::var("ENVIRONMENT").unwrap_or_else(|_| "development".to_string())
    }

    /// Check if running in production environment
    pub fn is_production(&self) -> bool {
        self.get_environment().to_lowercase() == "production"
    }

    /// Check if running in development environment
    pub fn is_development(&self) -> bool {
        self.get_environment().to_lowercase() == "development"
    }
}
