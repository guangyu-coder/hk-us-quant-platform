-- Audit log table for trading and risk decisions

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(50),
    details JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);
