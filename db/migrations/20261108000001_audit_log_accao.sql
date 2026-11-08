-- migrate:up
-- Contagem das tentativas falhadas por conta (palavra-passe e códigos do 2.º factor) nos últimos minutos.
ALTER TABLE audit_log ADD KEY ix_audit_action (action, created_at);

-- migrate:down
ALTER TABLE audit_log DROP KEY ix_audit_action;
