-- migrate:up
-- A ligação à SAXO passa a ser só por OAuth (aplicação SAXO do utilizador): os tokens de 24 h colados à mão deixam de ser aceites.
DELETE FROM user_integration_tokens WHERE auth_kind = 'manual';
ALTER TABLE user_integration_tokens MODIFY auth_kind ENUM('oauth') NOT NULL DEFAULT 'oauth';

-- migrate:down
ALTER TABLE user_integration_tokens MODIFY auth_kind ENUM('manual','oauth') NOT NULL DEFAULT 'manual';
