use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

/// Application error types
#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Redis error: {0}")]
    Redis(#[from] redis::RedisError),

    #[error("Configuration error: {0}")]
    Config(#[from] anyhow::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Validation error: {message}")]
    Validation { message: String },

    #[error("Not found: {resource}")]
    NotFound { resource: String },

    #[error("Unauthorized access")]
    Unauthorized,

    #[error("Forbidden access")]
    Forbidden,

    #[error("Internal server error: {message}")]
    Internal { message: String },

    #[error("Service unavailable: {service}")]
    ServiceUnavailable { service: String },

    #[error("Rate limit exceeded")]
    RateLimitExceeded,

    #[error("Market data error: {message}")]
    MarketData { message: String },

    #[error("Strategy error: {message}")]
    Strategy { message: String },

    #[error("Execution error: {message}")]
    Execution { message: String },

    #[error("Portfolio error: {message}")]
    Portfolio { message: String },

    #[error("Risk management error: {message}")]
    Risk { message: String },

    #[error("Broker error: {message}")]
    Broker { message: String },

    #[error("WebSocket error: {0}")]
    WebSocket(String),

    #[error("Broker API error: {0}")]
    BrokerApi(String),
}

impl AppError {
    /// Create a database error
    pub fn database(message: impl Into<String>) -> Self {
        // Wrap the message in a generic sqlx error since we can't easily construct specific sqlx errors
        Self::Internal {
            message: format!("Database error: {}", message.into()),
        }
    }

    /// Create a validation error
    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation {
            message: message.into(),
        }
    }

    /// Create a not found error
    pub fn not_found(resource: impl Into<String>) -> Self {
        Self::NotFound {
            resource: resource.into(),
        }
    }

    /// Create an internal error
    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            message: message.into(),
        }
    }

    /// Create a service unavailable error
    pub fn service_unavailable(service: impl Into<String>) -> Self {
        Self::ServiceUnavailable {
            service: service.into(),
        }
    }

    /// Create a market data error
    pub fn market_data(message: impl Into<String>) -> Self {
        Self::MarketData {
            message: message.into(),
        }
    }

    /// Create a strategy error
    pub fn strategy(message: impl Into<String>) -> Self {
        Self::Strategy {
            message: message.into(),
        }
    }

    /// Create an execution error
    pub fn execution(message: impl Into<String>) -> Self {
        Self::Execution {
            message: message.into(),
        }
    }

    /// Create a portfolio error
    pub fn portfolio(message: impl Into<String>) -> Self {
        Self::Portfolio {
            message: message.into(),
        }
    }

    /// Create a risk management error
    pub fn risk(message: impl Into<String>) -> Self {
        Self::Risk {
            message: message.into(),
        }
    }

    /// Create a broker error
    pub fn broker(message: impl Into<String>) -> Self {
        Self::Broker {
            message: message.into(),
        }
    }

    /// Get the HTTP status code for this error
    pub fn status_code(&self) -> StatusCode {
        match self {
            AppError::Database(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::Redis(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::Config(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::Serialization(_) => StatusCode::BAD_REQUEST,
            AppError::Validation { .. } => StatusCode::BAD_REQUEST,
            AppError::NotFound { .. } => StatusCode::NOT_FOUND,
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden => StatusCode::FORBIDDEN,
            AppError::Internal { .. } => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::ServiceUnavailable { .. } => StatusCode::SERVICE_UNAVAILABLE,
            AppError::RateLimitExceeded => StatusCode::TOO_MANY_REQUESTS,
            AppError::MarketData { .. } => StatusCode::BAD_GATEWAY,
            AppError::Strategy { .. } => StatusCode::UNPROCESSABLE_ENTITY,
            AppError::Execution { .. } => StatusCode::UNPROCESSABLE_ENTITY,
            AppError::Portfolio { .. } => StatusCode::UNPROCESSABLE_ENTITY,
            AppError::Risk { .. } => StatusCode::UNPROCESSABLE_ENTITY,
            AppError::Broker { .. } => StatusCode::BAD_GATEWAY,
            AppError::WebSocket(_) => StatusCode::BAD_GATEWAY,
            AppError::BrokerApi(_) => StatusCode::BAD_GATEWAY,
        }
    }

    /// Get error category for logging and monitoring
    pub fn category(&self) -> &'static str {
        match self {
            AppError::Database(_) => "database",
            AppError::Redis(_) => "redis",
            AppError::Config(_) => "configuration",
            AppError::Serialization(_) => "serialization",
            AppError::Validation { .. } => "validation",
            AppError::NotFound { .. } => "not_found",
            AppError::Unauthorized => "unauthorized",
            AppError::Forbidden => "forbidden",
            AppError::Internal { .. } => "internal",
            AppError::ServiceUnavailable { .. } => "service_unavailable",
            AppError::RateLimitExceeded => "rate_limit",
            AppError::MarketData { .. } => "market_data",
            AppError::Strategy { .. } => "strategy",
            AppError::Execution { .. } => "execution",
            AppError::Portfolio { .. } => "portfolio",
            AppError::Risk { .. } => "risk",
            AppError::Broker { .. } => "broker",
            AppError::WebSocket(_) => "websocket",
            AppError::BrokerApi(_) => "broker_api",
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let category = self.category();

        let body = Json(json!({
            "error": {
                "message": self.to_string(),
                "category": category,
                "status": status.as_u16(),
                "timestamp": chrono::Utc::now(),
            }
        }));

        // Log the error
        match status {
            StatusCode::INTERNAL_SERVER_ERROR => {
                tracing::error!(
                    error = %self,
                    category = category,
                    "Internal server error occurred"
                );
            }
            StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY => {
                tracing::warn!(
                    error = %self,
                    category = category,
                    "Client error occurred"
                );
            }
            _ => {
                tracing::info!(
                    error = %self,
                    category = category,
                    "Request error occurred"
                );
            }
        }

        (status, body).into_response()
    }
}

/// Result type alias for application operations
pub type AppResult<T> = Result<T, AppError>;

/// Validation result for data quality checks
#[derive(Debug, Clone)]
pub enum ValidationResult {
    Valid,
    Invalid { reasons: Vec<String> },
    Warning { reasons: Vec<String> },
}

impl ValidationResult {
    pub fn is_valid(&self) -> bool {
        matches!(
            self,
            ValidationResult::Valid | ValidationResult::Warning { .. }
        )
    }

    pub fn is_invalid(&self) -> bool {
        matches!(self, ValidationResult::Invalid { .. })
    }

    pub fn has_warnings(&self) -> bool {
        matches!(self, ValidationResult::Warning { .. })
    }

    pub fn get_reasons(&self) -> Vec<String> {
        match self {
            ValidationResult::Valid => vec![],
            ValidationResult::Invalid { reasons } | ValidationResult::Warning { reasons } => {
                reasons.clone()
            }
        }
    }
}
