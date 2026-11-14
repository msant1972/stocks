-- migrate:up
-- As estratégias G a L (rotura de canais, cruzamento 50/200, máximo de 52 semanas, Bollinger, Keltner e MACD) nascem desligadas em
-- Definições → Estratégias: ligadas, mudariam a «melhor estratégia» de cada instrumento e, com ela, os instrumentos em que a
-- Automação compra. O administrador liga as que quiser. A F-Mergulho e as anteriores mantêm-se como estavam.
INSERT IGNORE INTO strategy_settings (strategy_id, enabled) VALUES
  ('g-donchian', 0), ('h-cruzamento', 0), ('i-maximo52', 0), ('j-bollinger', 0), ('k-keltner', 0), ('l-macd', 0);

-- migrate:down
DELETE FROM strategy_settings WHERE strategy_id IN ('g-donchian', 'h-cruzamento', 'i-maximo52', 'j-bollinger', 'k-keltner', 'l-macd');
