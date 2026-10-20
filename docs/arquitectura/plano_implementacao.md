# Plano de Implementação — Plataforma de Simulação e Acompanhamento de Acções

Estado em 18 out. 2026. Versão 1 em produção em https://stocks.graus.pt, no ramo `main`.

Documentos relacionados: [Arquitectura](arquitectura.md) (o que está construído), [Análise e decisões](analise_e_decisoes.md) (porquê), [Guia de estilos](guia_estilos.md) (interface) e [deploy/README.md](../../deploy/README.md) (operação).

## 1. Resumo

As oito fases do plano (F0 a F7) foram executadas e a aplicação está publicada com HTTPS, recolha diária agendada, alertas e cópias de segurança diárias. Depois da publicação foram acrescentadas várias funcionalidades a pedido (secção 4), entre elas a simulação de uma estratégia no histórico, que estava fora do âmbito inicial.

Os três pendentes da versão 1 foram fechados pelo administrador a 18 out. 2026:

1. SMTP configurado em Definições (OVH, `ssl0.ovh.net:465`, SSL/TLS, remetente `stocks@graus.pt`), com email de teste aceite;
2. carteira de produção passada para 1 000 000 € e valor por omissão actualizado em `/etc/stocks/stocks.env`;
3. cópia fora do servidor por snapshots EBS do volume (geridos na AWS) e restauro testado.

## 2. Âmbito

### 2.1. Requisitos (todos cumpridos)

- Negociação exclusivamente simulada e acompanhamento de acções; sem operações reais nem corretoras.
- Histórico de dois anos por instrumento, com granularidade diária.
- Alertas por email com no máximo uma notificação por hora, cumprido com um resumo por utilizador após cada recolha diária e um intervalo mínimo de 60 minutos.
- Cinco módulos: interface React, API Node.js, MariaDB, motor de recolha Python e motor de alertas Python.

### 2.2. Decisões aplicadas

Detalhe em [Análise e decisões](analise_e_decisoes.md).

- Grupo privado de utilizadores; contas criadas por administradores.
- yfinance atrás de um adaptador substituível, com versão fixada.
- Instrumentos e carteira em EUR; catálogo global partilhado com importação de Excel.
- Recolha nos dias úteis às 19h00 de Lisboa; cotações nunca apagadas.
- Operações ao último fecho não ajustado; gráficos e indicadores sobre o fecho ajustado.
- Quantidades inteiras, sem posições curtas nem comissões; custo médio ponderado.
- Capital virtual inicial de 1 000 000 € por omissão.

### 2.3. Fora do âmbito (mantém-se)

- Negociação real, pagamentos, corretoras e custódia.
- Cotações intradiárias e alertas em tempo real.
- Negociação automática: a estratégia só é simulada no histórico e não executa operações.
- Aplicações móveis nativas, carteiras multimoeda, vendas a descoberto e tratamento completo de dividendos e desdobramentos.
- Alta disponibilidade.

## 3. Execução das fases

| Fase | Resultado previsto | Estado | Observações |
|---|---|---|---|
| F0 — Requisitos e prova de conceito | Âmbito e fonte validados | Concluída | Decisões registadas; prova de conceito do motor de recolha; lista inicial de 41 símbolos. O SMTP não foi confirmado nesta fase |
| F1 — Fundação técnica | Repositório, ambientes, BD, pipeline | Concluída, com lacunas | Stack fixada, migrações dbmate, OpenAPI gerado, CI com testes em cada componente. Falta análise estática (lint) e auditoria de dependências no CI; desenvolvimento e produção partilham o servidor |
| F2 — Recolha e histórico | Dois anos consultáveis | Concluída | 295 instrumentos activos, cerca de 148 mil sessões; idempotência, validação, novas tentativas e concorrência testadas |
| F3 — API e acompanhamento | Login, pesquisa, lista, gráficos | Concluída | Isolamento entre utilizadores testado; importação de Excel com pré-visualização |
| F4 — Carteira e simulação | Operações transaccionais | Concluída | Concorrência, idempotência, custo médio e aritmética decimal exacta testados |
| F5 — Alertas e email | Regras, resumo, registos | Concluída | Resumo por utilizador, desduplicação, envios falhados e incertos testados. SMTP da OVH configurado em Definições e email de teste aceite |
| F6 — Integração e segurança | Versão testada, restauro demonstrado | Concluída, com lacunas | Testes ponta a ponta no browser, revisão de sessões, CSRF, CSP e segredos; restauro testado pelo administrador. Falta medir desempenho com carga e registar controlos OWASP ASVS |
| F7 — Piloto e publicação | Aplicação em produção | Concluída | Publicada com Caddy (HTTPS), systemd e backup diário. Piloto informal com o responsável funcional, sem aceitação formal registada |

Prazo: o plano previa 10 a 12 semanas para uma equipa de 4 papéis. A execução foi feita com apoio de IA num único dia (18 out. 2026), com o responsável funcional a validar cada passo. As lacunas acima resultam sobretudo das actividades que exigem tempo de calendário: piloto, restauro testado e medições de carga.

## 4. Funcionalidades acrescentadas após o plano inicial

| Funcionalidade | Descrição |
|---|---|
| Indicadores técnicos | EMA9, SMA10/50/125/200 guardados na BD e recalculados em cada recolha; botões para os mostrar no gráfico |
| Gráfico de momento | SMA10/SMA200 − 1 (verde a subir, vermelho a descer) e SMA8/SMA125 − 1, sincronizado com o histórico |
| Estratégia de momento | Simulação no histórico: compra 15 000 € após descer-subir-subir, vende após subir-descer-descer com SMA8/SMA125 < 1%, ignora sinais com SMA10/SMA200 entre −1% e +1%, reforça a cada +10% desde a última compra |
| HeatMap | Treemap dos 20 instrumentos com maior valor negociado em 1, 5, 15 ou 30 sessões |
| Momento do mercado | Quadro na Visão geral com a distribuição do SMA10/SMA200 e os 5 mais fortes e mais fracos |
| Cruzamentos SMA10/SMA50 | Quadro na Visão geral com os cruzamentos ascendentes e descendentes das últimas 5 sessões |
| Sinais | Página com os sinais da estratégia em todos os instrumentos (cálculo partilhado em `shared/`) e botões Comprar/Vender |
| Orderbook | Campo ISIN-MIC no catálogo e livro de ofertas Euronext segundo a [especificação](orderbook-spec.md): biblioteca, CLI, API e página com gráfico de profundidade |
| Validar agora | Arranque imediato do motor de recolha (unit `.path` do systemd) e botão para forçar a validação |
| Coluna Volume | Volume da última sessão em Acompanhar |
| Gestão de utilizadores | Página para administradores: criar, redefinir palavra-passe, remover |
| Configuração SMTP | Em Definições, com palavra-passe cifrada na BD e email de teste pelo motor de alertas |
| Capital de 1 M€ | Valor por omissão das contas novas |
| Autenticação em dois passos | TOTP obrigatório para todos, configurado no primeiro login (QR code), códigos de recuperação, reposição pelo administrador ou pelo CLI `reset-mfa` |

## 5. Backlog

| ID | Item | Prioridade | Estado |
|---|---|---|---|
| US01 | Autenticação | P0 | Feito |
| US02 | Pesquisa de instrumentos | P0 | Feito |
| US02b | Adicionar e importar instrumentos | P0 | Feito |
| US03 | Histórico diário | P0 | Feito |
| US04 | Lista de acompanhamento | P1 | Feito |
| US05 | Carteira virtual | P0 | Feito |
| US06 | Compra simulada | P0 | Feito |
| US07 | Venda simulada | P0 | Feito |
| US08 | Posições e resultados | P0 | Feito |
| US09 | Regras de alerta | P0 | Feito |
| US10 | Envio de alertas | P0 | Feito (SMTP da OVH) |
| US11 | Estado das recolhas | P1 | Feito (`/status`, Definições, «Validar agora») |
| US12 | Backup e recuperação | P0 | Feito: dumps diários locais, snapshots EBS e restauro testado |
| US13 | Indicadores e momento | — | Feito |
| US14 | Estratégia simulada | — | Feito |
| US15 | HeatMap e momento do mercado | — | Feito |
| US16 | Gestão de utilizadores | — | Feito |
| US17 | Configuração SMTP na interface | — | Feito |
| US18 | Sinais da estratégia em todos os instrumentos | — | Feito |
| US19 | ISIN-MIC no catálogo e módulo Orderbook | — | Feito; ISIN-MIC por preencher nos instrumentos Euronext |

## 6. Testes

| Componente | Ferramenta | Testes |
|---|---|---|
| API | Vitest contra a base `stocks_test` | 91 (+1 de contrato com rede, opcional) |
| Motor de recolha | pytest, fornecedor simulado | 21 |
| Motor de alertas | pytest, mailer simulado | 18 |
| Frontend (cálculos) | `node --test` | 11 |

O CI no GitHub Actions corre estes testes em cada push para `main` e em cada pull request, com MariaDB 10.11, e verifica que o contrato OpenAPI está actualizado. Os testes nunca contactam o Yahoo nem enviam emails. Cada funcionalidade de interface foi também verificada no browser (Chromium headless) em desktop e telemóvel, com uma cópia dos dados reais na base de testes.

## 7. Riscos

| Risco | Mitigação | Estado |
|---|---|---|
| Fonte de dados não oficial | Uso privado; adaptador substituível; versão fixada | Aceite |
| Alterações no yfinance (429, endpoints) | Novas tentativas com espera progressiva; testes com fornecedor simulado | Mitigado |
| Dados do fornecedor incorrectos | Validação das sessões; releitura de 7 dias; datas visíveis | Mitigado (ex.: fechos repetidos observados a 16 out.) |
| Eventos societários | Gráficos ajustados; limitação documentada | Aceite |
| Gastos concorrentes do saldo | Transacções, bloqueio da carteira, testes concorrentes | Resolvido |
| Alertas repetidos | Chave única por regra e sessão; reserva por utilizador | Resolvido |
| Aceitação SMTP ambígua | Estado `uncertain`, sem reenvio cego | Resolvido |
| Servidor único | Dumps diários, snapshots EBS e restauro testado | Mitigado; indisponibilidade conjunta aceite |
| Perda da chave de cifra | Chave criada uma vez e nunca substituída | Aceite: perdê-la obriga a reintroduzir a palavra-passe SMTP |
| Desenvolvimento no servidor de produção | Base de testes separada; publicação só com `install.sh` | Pendente: ambiente de testes separado |
| Aumento do âmbito | Alterações pequenas, com testes e commit por funcionalidade | Em curso |

## 8. Próximos passos

### P0 — fechar a versão 1

Concluído a 18 out. 2026 (SMTP, carteira a 1 M€, cópia externa e restauro). Recomenda-se repetir o teste de restauro periodicamente, por exemplo a cada trimestre.

### P1 — robustez

4. Análise estática (ESLint, Ruff) e auditoria de dependências (`npm audit`, `pip-audit`) no CI.
5. Ambiente de testes separado da produção (outra máquina ou contentores), e trabalho por ramos com pull requests.
6. Contas de BD por componente (API e motores com permissões mínimas).
7. Alerta operacional ao administrador quando a recolha diária ou os alertas falham (`job_runs` em `failed`).
8. Medição de desempenho com o volume real e registo dos controlos OWASP ASVS aplicados.

### P2 — evolução funcional (a decidir com o responsável funcional)

9. Estratégia: opção de execução ao fecho do dia seguinte (mais realista), parâmetros configuráveis e aplicação a vários instrumentos de uma vez.
10. Histórico: períodos «5A» e «Tudo» no gráfico à medida que o histórico cresce.
11. Simulação: comissões opcionais e tratamento de desdobramentos nas posições.
12. Logótipos ou categorias por sector no HeatMap, se houver fonte com direitos de uso.

## 9. Publicação e rollback

Lista de verificação da versão 1:

- [x] Âmbito e regras aprovados (validação contínua com o responsável funcional).
- [x] Fonte de dados validada para uso privado.
- [x] Configuração e segredos de produção em `/etc/stocks` (modo 640).
- [x] Migrações aplicadas com dbmate pelo `install.sh`.
- [x] Testes de saldo, concorrência e isolamento aprovados.
- [x] Testes de resumo único e desduplicação de alertas aprovados.
- [ ] Monitorização com alerta operacional (hoje: `journalctl`, `/status` e Definições).
- [x] Backup externo (snapshots EBS) e restauro demonstrado.
- [x] Envio real de email verificado (email de teste pelo SMTP da OVH).
- [x] Procedimento de rollback documentado em [deploy/README.md](../../deploy/README.md).

Rollback:

1. Suspender os timers (`stocks-fetcher-run`, `stocks-daily`), preservando logs e eventos.
2. Verificar se a versão anterior é compatível com o esquema actual; as migrações não são revertidas automaticamente.
3. `git checkout <versão anterior>` e `sudo deploy/install.sh`.
4. Se for preciso restaurar dados, obter aprovação explícita para a perda ou reconciliação das escritas posteriores ao backup.
5. Validar saldos, posições, recolhas e alertas antes de retomar os timers.

## 10. Critério de conclusão

A versão 1 considera-se concluída quando permite:

- acompanhar instrumentos com histórico diário até dois anos — **cumprido**;
- simular compras e vendas com integridade de saldo e posições — **cumprido**;
- gerir alertas por email com um resumo por utilizador após cada recolha diária — **cumprido**;
- operar com monitorização e recuperação testadas — **recuperação testada; falta o alerta operacional ao administrador (P1)**.

A aplicação comunica de forma inequívoca que não executa operações reais e que usa dados diários, não cotações em tempo real.
