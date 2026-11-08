-- migrate:up
-- Automação face ao BackTest: o preço do sinal no momento do envio (o BackTest executa na abertura ou no fecho dessa sessão).
ALTER TABLE saxo_automation_orders ADD COLUMN signal_price DECIMAL(18,6) NULL AFTER reason;

-- Laboratório: registo das experiências (ideias testadas, a decorrer, mantidas ou abandonadas, e o que se aprendeu).
CREATE TABLE experiments (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title       VARCHAR(160)    NOT NULL,
  status      ENUM('idea','running','kept','dropped') NOT NULL DEFAULT 'idea',
  hypothesis  TEXT            NULL,
  metric      TEXT            NULL,
  result      TEXT            NULL,
  started_on  DATE            NULL,
  decided_on  DATE            NULL,
  created_by  BIGINT UNSIGNED NULL,
  created_at  TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_experiments_status (status, updated_at),
  CONSTRAINT fk_experiments_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Experiências já feitas (documentos em docs/arquitectura).
INSERT INTO experiments (title, status, started_on, decided_on, hypothesis, metric, result) VALUES
('B-Opus: tendência com momentum ajustado ao risco', 'kept', '2026-10-24', '2026-10-24', 'Uma estratégia de tendência com decisão semanal, momentum ajustado à volatilidade e stop chandelier ganha no catálogo.', 'Soma dos resultados no BackTest (2 anos, 15 000 € por compra), instrumentos com ganho/perda, 10 piores.', 'Mantida na versão B (sem filtro do Efficiency Ratio, stop de 4 × ATR, reforços a +10%): 840 975 € (135/149) contra 126 035 € (125/122) da especificação original. Resultados indicativos: sem validação fora da amostra. Ver b-opus-ablacao.md.'),
('B-Opus: filtro do Efficiency Ratio na entrada', 'dropped', '2026-10-24', '2026-10-24', 'Exigir tendência eficiente (ER) antes de comprar evita entradas em mercados laterais.', 'Soma dos resultados e instrumentos com ganho/perda, contra a versão sem o filtro.', 'Abandonado: 220 967 € (105/142) contra 840 975 € (135/149) sem o filtro.'),
('B-Opus: revisão mensal em vez de semanal', 'dropped', '2026-10-24', '2026-10-24', 'Decidir uma vez por mês reduz operações sem perder resultado.', 'Soma dos resultados e instrumentos com ganho/perda.', 'Abandonado: 559 214 € (114/164) contra 840 975 € (135/149) com a revisão semanal.'),
('C-AI: tendência (SMA200) com momentum de 12 meses e stop de 5 × ATR', 'kept', '2026-10-24', '2026-10-24', 'Comprar só com o preço acima da SMA200 e momentum positivo, com stop largo, dá o melhor resultado por euro investido.', 'Resultado sobre o capital máximo investido, instrumentos com ganho/perda em cada ano.', 'Mantida: 15,6 % sobre o capital máximo investido (A-Momentum 12,6 %, B-Opus 8,0 %) e a única com mais instrumentos a ganhar do que a perder em cada um dos dois anos. Ver C-AI.md.'),
('D-Reversão: reversão à média nos instrumentos sem tendência', 'kept', '2026-11-02', '2026-11-02', 'Os instrumentos que perdem com as estratégias de tendência (sem tendência, muitos cruzamentos da SMA200) ganham com compras em quedas anormais e venda no ressalto.', 'Resultado nos 75 perdedores das estratégias de tendência e no catálogo, resultado com comissões.', 'Mantida: catálogo +250 k€ (215/78), perdedores das estratégias de tendência +42 k€ (eram −722 k€), com comissões de 0,1 % por lado, +212 k€. Ver D-Reversao.md.'),
('D-Reversão: entrada RSI2 < 10 com saída na SMA20', 'dropped', '2026-11-02', '2026-11-02', 'Uma entrada mais frequente e uma saída mais tardia aumentam o resultado da reversão à média.', 'Soma dos resultados, número de operações e resultado com comissões nos perdedores.', 'Abandonada: soma mais (+499 k€), mas faz 6 700 operações e, com comissões, deixa de ganhar nos perdedores.'),
('Promessas: sinais que anunciaram ganhadores nos 12 meses seguintes', 'kept', '2026-10-24', '2026-10-24', 'Os instrumentos com tendência e momentum fortes nos últimos 3 meses ganham mais vezes nos 12 meses seguintes do que o catálogo.', 'Percentagem de ganhadores nas estratégias e rendimento do top 30, contra o catálogo, em listas feitas no passado só com os dados até essa data.', 'Mantida como lista indicativa. Validada em 5 janelas (listas de out. 2025, jan. 2026 e abr. 2026), com três anos de dados as janelas sobrepõem-se e não são independentes. Ver promessas.md.'),
('Sazonalidade: comprar em Dezembro e vender até Abril', 'dropped', NULL, NULL, 'A melhor altura para comprar acções é Dezembro, vendendo até Abril.', 'Rendimento do catálogo de Dezembro a Abril contra os restantes meses, nos anos com dados.', 'Conclusão da análise: parcialmente verdadeira. Não deu origem a uma estratégia.'),
('Carteira = conta de simulação da SAXO', 'kept', '2026-11-06', '2026-11-06', 'Usar a conta de simulação da SAXO, em vez de uma carteira virtual própria, aproxima a aplicação do ambiente real.', 'Ordens, execuções e valor da conta vêm da SAXO, gráfico da evolução com uma leitura por sessão.', 'Mantida: a carteira virtual foi retirada e os seus dados apagados (6 nov. 2026).'),
('Automação dos sinais na conta de simulação', 'idea', NULL, NULL, 'Os sinais das estratégias, enviados sozinhos à SAXO de hora a hora, executam perto do preço que o BackTest assume.', 'Na página Automação, «Automação face ao BackTest»: percentagem de ordens executadas e desvio médio do preço executado face ao do BackTest.', 'Pronta, desligada. Próximo passo: ligar uma só estratégia, no SIM, durante 1 a 2 semanas, e ler a comparação.'),
('BackTest com custos e período de verificação', 'running', '2026-11-08', NULL, 'A classificação das estratégias mantém-se depois das comissões, do spread e da custódia da SAXO, e nos 2 anos anteriores aos usados para as afinar.', 'No Comparar: a ordem das estratégias e o resultado sobre o capital, com e sem custos, nos últimos 2 anos e no período de verificação.', NULL);

-- migrate:down
DROP TABLE experiments;
ALTER TABLE saxo_automation_orders DROP COLUMN signal_price;
