# Plano de Implementação — Plataforma de Simulação e Acompanhamento de Acções

Estado em 2 nov. 2026. Versão 1 em produção em https://stocks.graus.pt, no ramo `main`; desde 2 nov. 2026 num servidor novo (VPS com Ubuntu), instalado de raiz com a base de dados vazia.

Documentos relacionados: [Arquitectura](arquitectura.md) (o que está construído), [Análise e decisões](analise_e_decisoes.md) (porquê), [Guia de estilos](guia_estilos.md) (interface) e [deploy/README.md](../../deploy/README.md) (operação).

## 1. Resumo

As oito fases do plano (F0 a F7) foram executadas e a aplicação está publicada com HTTPS, recolha diária agendada, alertas e cópias de segurança diárias. Depois da publicação foram acrescentadas várias funcionalidades a pedido (secção 4), entre elas a simulação de uma estratégia no histórico, que estava fora do âmbito inicial.

Os três pendentes da versão 1 foram fechados pelo administrador a 18 out. 2026:

1. SMTP configurado em Definições (OVH, `ssl0.ovh.net:465`, SSL/TLS, remetente `stocks@graus.pt`), com email de teste aceite;
2. carteira de produção passada para 1 000 000 € e valor por omissão actualizado em `/etc/stocks/stocks.env`;
3. cópia fora do servidor e restauro testado. Com a mudança de servidor a 2 nov. 2026, a cópia fora do servidor passou a ser o autobackup do VPS; falta repetir o teste de restauro (secção 8, P1).

## 2. Âmbito

### 2.1. Requisitos (todos cumpridos)

- Negociação exclusivamente simulada e acompanhamento de acções; sem operações reais. Opcionalmente, envio de ordens para a conta de simulação (SIM) da SAXO Bank.
- Histórico de cinco anos por instrumento (dois mostrados nos gráficos e simulados, dois de verificação do BackTest, um de aquecimento), com granularidade diária.
- Alertas por email com no máximo uma notificação por hora, cumprido com um resumo por utilizador após cada recolha diária e um intervalo mínimo de 60 minutos.
- Cinco módulos: interface React, API Node.js, MariaDB, motor de recolha Python e motor de alertas Python.

### 2.2. Decisões aplicadas

Detalhe em [Análise e decisões](analise_e_decisoes.md).

- Grupo privado de utilizadores; contas criadas por administradores.
- yfinance atrás de um adaptador substituível, com versão fixada.
- Instrumentos e conta SAXO em EUR; catálogo global partilhado com importação de Excel.
- Recolha nos dias úteis às 19h01 de Lisboa (fechos definitivos) e de hora a hora durante a sessão; cotações nunca apagadas.
- Operações ao último fecho não ajustado; gráficos e indicadores sobre o fecho ajustado.
- Quantidades inteiras, sem posições curtas nem comissões; custo médio ponderado.
- Carteira: a conta de simulação da SAXO Bank, com 1 000 000 € à partida (a carteira virtual própria foi retirada a 6 nov. 2026); um só utilizador por agora.

### 2.3. Fora do âmbito (mantém-se)

- Negociação real (a conta real da SAXO fica bloqueada), pagamentos e custódia.
- Cotações em tempo real e alertas intradiários (a recolha horária guarda só a vela provisória do dia).
- Negociação automática: a estratégia só é simulada no histórico e não executa operações.
- Aplicações móveis nativas, contas multimoeda, vendas a descoberto e tratamento completo de dividendos e desdobramentos.
- Alta disponibilidade.

## 3. Execução das fases

| Fase | Resultado previsto | Estado | Observações |
|---|---|---|---|
| F0 — Requisitos e prova de conceito | Âmbito e fonte validados | Concluída | Decisões registadas; prova de conceito do motor de recolha; lista inicial de 41 símbolos. O SMTP não foi confirmado nesta fase |
| F1 — Fundação técnica | Repositório, ambientes, BD, pipeline | Concluída, com lacunas | Stack fixada, migrações dbmate, OpenAPI gerado, CI com testes em cada componente. Falta análise estática (lint) e auditoria de dependências no CI; desenvolvimento e produção partilham o servidor |
| F2 — Recolha e histórico | Dois anos consultáveis (três guardados, para a SMA200 completa) | Concluída | 295 instrumentos activos, cerca de 148 mil sessões; idempotência, validação, novas tentativas e concorrência testadas |
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
| HeatMap | Treemap dos 20 instrumentos com maior valor negociado em 1, 5, 10 ou 20 sessões |
| Momento do mercado | Quadro na Visão geral com a distribuição do SMA10/SMA200 e os 5 mais fortes e mais fracos |
| Cruzamentos SMA10/SMA50 | Quadro na Visão geral com os cruzamentos ascendentes e descendentes das últimas 5 sessões |
| Sinais | Página com os sinais da estratégia em todos os instrumentos (cálculo partilhado em `shared/`) e botões Comprar/Vender |
| Orderbook | Campo ISIN-MIC no catálogo e livro de ofertas Euronext segundo a [especificação](orderbook-spec.md): biblioteca, CLI, API e página com gráfico de profundidade |
| Validar agora | Arranque imediato do motor de recolha (unit `.path` do systemd) e botão para forçar a validação |
| Coluna Volume | Volume da última sessão em Acompanhar |
| Gestão de utilizadores | Página para administradores: criar, redefinir palavra-passe, remover |
| Configuração SMTP | Em Definições, com palavra-passe cifrada na BD e email de teste pelo motor de alertas |
| Capital de 1 M€ | Valor por omissão das contas novas |
| A-Momentum: filtro e protecção | Só compra com o preço acima da SMA200; com reforços, vende se o fecho cair mais de 15% abaixo do último reforço. Perdas dos 10 piores de −172 k€ para −48 k€; soma dos resultados de +4,8 M€ para +2,1 M€ |
| Actualização horária | Recolha de hora a hora entre as 08h20 e as 16h20 de Lisboa nos dias úteis (ao minuto 20, desde 12 nov. 2026) (sessão em curso, provisória), mantendo a recolha das 19h00 com os fechos definitivos e os alertas; indicação «sessão em curso» na interface |
| Promessas | Lista dos instrumentos com sinais de continuarem ou passarem a ganhadores nos 12 meses seguintes, com a regra validada em 5 janelas do passado ([promessas.md](promessas.md)) |
| WinnersLoosers | Página com os instrumentos em que as três estratégias ganham e em que as três perdem (24 out. 2026: 102 e 80), a partir dos resultados do BackTest |
| Estratégia D-Reversão | Reversão à média definida a partir da análise dos perdedores do WinnersLoosers ([D-Reversao.md](D-Reversao.md)): compra com z < −2,5 face à média de 20 sessões, vende com RSI2 > 70 ou ao fim de 10 sessões; +250 k€ no catálogo, +42 k€ nos perdedores das outras três |
| Charts | Gráfico do instrumento com a lista de acompanhamento à direita, para ver todos os gráficos sem mudar de página; lista da carteira ou do catálogo, pesquisa e ordenação |
| Comparar estratégias, alertas de sinais, evolução da carteira | Quadro comparativo das estratégias; alertas quando uma estratégia dá sinal; gráfico do valor da carteira (3 nov. 2026) |
| Charts único, painel do dia, navegação | Velas e volume; ações do instrumento no Charts; Visão geral com carteira, sinais, alertas e subidas/descidas da lista; menu em secções; botão «Mais» (3 nov. 2026) |
| Operação e qualidade | Aviso operacional diário aos administradores; revalidação semanal das análises; ESLint, Ruff e auditoria de dependências no CI com as versões da produção; páginas do frontend carregadas a pedido (ficheiro principal de 761 KB para 316 KB) |
| Melhor estratégia por instrumento | Coluna em Acompanhar e estratégia aplicada por omissão na página do instrumento (`GET /strategies/best`) |
| Estratégia C-AI | Especificada a partir da análise de todos os instrumentos ([C-AI.md](C-AI.md)) e implementada: entrada acima da SMA200 com M2 > 0, stop chandelier de 5 × ATR, reforços a +10% só com M2 > 2 (até 5); +1 491 k€, 182 com ganho e 106 com perda |
| Estratégia B-Opus | Tendência e momentum por instrumento (SMA50/SMA200, M1, M2, liquidez), decisão semanal, execução na abertura seguinte, reforços a +10% (até 5), stop chandelier de 4 × ATR (versão B, +841 k€ contra +126 k€ das regras originais); no instrumento, BackTest e Sinais; ablação em `b-opus-ablacao.md` |
| Registo de estratégias | A estratégia passa a chamar-se A-Momentum; menu «Estratégia» (Nenhuma, A-Momentum) no instrumento e no BackTest; B-Opus registada como «em preparação» |
| BackTest | Página com o resultado da estratégia de momento em cada instrumento nos últimos 2 anos (os mesmos valores do «Aplicar estratégia»), resumo de ganhos/perdas, comparação com comprar e manter e ordenação |
| Ordenação em Acompanhar | Instrumento, volume e variação ordenam o catálogo inteiro no servidor; desequilíbrio ordena os instrumentos mostrados (o livro só é pedido para esses); a lista do utilizador ordena-se no browser |
| Mid e desequilíbrio em Acompanhar | Botão «Mostrar OB» (desligado ao abrir); colunas com o resumo do livro Euronext de cada instrumento com ISIN-MIC, em lotes de 50 para toda a lista (máx. 4 pedidos simultâneos à Euronext, limite global; cache de 30 s) |
| Histórico de 3 anos | Carga inicial passou de dois para três anos, para a SMA200 estar completa; comando `backfill` para os instrumentos existentes (executado a 20 out. 2026: 288 de 295 com três anos; os restantes 7 cotam há menos tempo) |
| Autenticação em dois passos | TOTP obrigatório para todos, configurado no primeiro login (QR code), códigos de recuperação, reposição pelo administrador ou pelo CLI `reset-mfa` |

## 5. Backlog

| ID | Item | Prioridade | Estado |
|---|---|---|---|
| US01 | Autenticação | P0 | Feito |
| US02 | Pesquisa de instrumentos | P0 | Feito |
| US02b | Adicionar e importar instrumentos | P0 | Feito |
| US03 | Histórico diário | P0 | Feito |
| US04 | Lista de acompanhamento | P1 | Feito |
| US05 | Carteira virtual (retirada a 6 nov. 2026, US59) | P0 | Feito |
| US06 | Compra simulada | P0 | Feito |
| US07 | Venda simulada | P0 | Feito |
| US08 | Posições e resultados | P0 | Feito |
| US09 | Regras de alerta | P0 | Feito |
| US10 | Envio de alertas | P0 | Feito (SMTP da OVH) |
| US11 | Estado das recolhas | P1 | Feito (`/status`, Definições, «Validar agora») |
| US12 | Backup e recuperação | P0 | Feito: dumps diários e autobackup do VPS; restauro testado no servidor anterior, por repetir no actual |
| US13 | Indicadores e momento | — | Feito |
| US14 | Estratégia simulada | — | Feito |
| US15 | HeatMap e momento do mercado | — | Feito |
| US16 | Gestão de utilizadores | — | Feito |
| US17 | Configuração SMTP na interface | — | Feito |
| US18 | Sinais da estratégia em todos os instrumentos | — | Feito |
| US20 | Registo de estratégias e estratégia A-Momentum com filtro de tendência e protecção dos reforços | — | Feito |
| US21 | Módulo BackTest | — | Feito |
| US22 | Estratégia B-Opus (especificação, implementação e versão B) | — | Feito |
| US23 | Estratégia C-AI (especificação a partir da análise do catálogo e implementação) | — | Feito |
| US26 | Estratégia D-Reversão (análise dos perdedores, especificação e implementação) | — | Feito |
| US27 | Melhor estratégia por instrumento em Acompanhar e por omissão na página do instrumento | — | Feito |
| US28 | Módulo Charts (gráficos da lista sem mudar de página; fonte lista/carteira/catálogo, pesquisa e ordenação) | — | Feito |
| US29 | Aviso operacional aos administradores | — | Feito |
| US30 | Página Comparar estratégias | — | Feito |
| US31 | Alertas de sinais das estratégias | — | Feito |
| US32 | Revalidação semanal das Promessas e da persistência dos ganhadores | — | Feito |
| US33 | Evolução da carteira | — | Feito |
| US37 | Cartão «SAXO Bank» com o token de cada utilizador, guardado cifrado | — | Feito |
| US38 | Ordens para a conta de simulação da SAXO: testar ligação, resolução do instrumento, pré-validação, confirmação, envio, estado e cancelamento | — | Feito |
| US41 | Ordens SAXO: preço limite validado contra o passo de preço do instrumento (`SAXO_TICK_SIZE`, com sugestão) e preço inicial arredondado | — | Feito |
| US40 | Grupo «SAXO» no menu: Carteira SAXO, Ordens SAXO e Alertas SAXO (email quando uma ordem deixa de estar aberta) | — | Feito |
| US39 | SAXO: ligação OAuth («Authorization Code») com aplicação por utilizador, renovação automática e atómica do refresh token; o token de 24 h foi retirado | — | Feito |
| US42 | SAXO: estado real das ordens (executada com quantidade e preço, expirada, cancelada) nas Ordens e nos Alertas SAXO | — | Feito |
| US43 | SAXO: vender posições a partir da Carteira SAXO; posições fechadas; comparação com a carteira virtual | — | Feito |
| US44 | SAXO: stop fixo ou móvel associado à compra; alterar ordens abertas | — | Feito |
| US45 | SAXO: envio em lote dos sinais de uma estratégia; streaming das ordens (avisos instantâneos) | — | Feito |
| US46 | Charts: painel «Empresa» com actividade, indicadores e contas anuais (Yahoo, recolha semanal) | — | Feito |
| US47 | Charts: secção «Valorização» (sector, P/E histórico, analistas, Graham, DCF invertido) com veredicto indicativo | — | Feito |
| US48 | Estratégias → Pechinchas: lista dos instrumentos classificados como barato | — | Feito |
| US49 | Estratégias → Calor (desde 12 nov. 2026 no grupo Mercado, por baixo do HeatMap): valor negociado diário do catálogo (2 anos) com SMA200 | — | Feito |
| US50 | Calor: histograma «Valor mensal negociado» com os meses mais quentes a cores | — | Feito |
| US51 | Calor: gráfico «Capitalização Mercado» (soma de fecho × número de acções) com SMA200 | — | Feito |
| US75 | «Vender Tudo»: uma ordem a cada 6 segundos (a SAXO recusou pedidos seguidos), com contagem decrescente e repetição se responder «demasiados pedidos» | — | Feito |
| US76 | Barra lateral sem cabeçalho em ecrã largo (sem pesquisa; estado dos dados em duas linhas por baixo do nome); fotografia do utilizador (Utilizadores) mostrada à esquerda do nome, com «Terminar sessão» no botão direito sobre ela | — | Feito |
| US77 | Logotipos das empresas (Brandfetch Logo API): cartão «Logotipos» nas Definições com o Client ID; logotipo no cabeçalho e no cartão «Empresa» do Charts e no HeatMap; interruptor global; cores do HeatMap como no Timelapse | — | Feito |
| US78 | Logotipos internos: módulo Administração → Logotipos descarrega no browser, da Brandfetch, os logotipos em falta (10 de cada vez) e guarda-os na base de dados; Charts e HeatMap mostram só os internos | — | Feito |
| US74 | Horários: recolha ao minuto 20 (08:20 a 16:20), Automação ao minuto 23 (08:23 a 16:23, ordens até às 16:35), temporizador de 5 min sem coincidir; Automação só na lista, pela melhor estratégia | — | Feito |
| US73 | Charts: painel RSI14, botão «Posições» (X verde na compra das posições da conta SAXO) e três cartões (gráfico, Estratégia e Empresa, os dois últimos a pedido e com o estado guardado) | — | Feito |
| US72 | Charts: eixo dos valores à direita, cursor em cruz e medida (sessões, dias e %) ao arrastar; Calor passa para o grupo Mercado, por baixo do HeatMap | — | Feito |
| US71 | Carteira SAXO: botão «Vender Tudo» (emergência: vende a mercado todas as posições; desliga a Automação e cancela as compras abertas) | — | Feito |
| US69 | Definições → Estratégias: ligar e desligar estratégias, com efeito em Acompanhar, Sinais, BackTest, Comparar, WinnersLoosers, Charts, Visão geral e Automação | — | Feito |
| US68 | Definições: cartão «Cópias de segurança» (listar, criar e descarregar; restauro manual) e Correspondência SAXO passa de módulo a cartão (menu Administração só com Utilizadores e Definições) | — | Feito |
| US67 | Pechinchas: botão por linha para adicionar ou remover o instrumento da minha lista | — | Feito |
| US66 | WinnersLoosers: cartão «Resultados mistos» e remoção em bloco da minha lista nos perdedores e nos mistos; Sinais só nos instrumentos da minha lista | — | Feito |
| US65 | Estratégia E-Ondas (correcções numa tendência de subida, inversão confirmada), a partir do desenho do utilizador na A2A.MI; especificação em [E-Ondas.md](E-Ondas.md) | — | Feito |
| US64 | Laboratório (registo das experiências), Automação face ao BackTest e BackTest/Comparar com custos SAXO e período de verificação; histórico de 5 anos | — | Feito |
| US63 | Revisão de segurança do backend (BD, motores e API): limites de tentativas por conta no login e no 2.º factor, correspondência SAXO protegida, Automação sem vender a mais, SMTP sem palavra-passe às claras, documentação da API só com sessão, limpeza de sessões e registos sem o código OAuth | — | Feito |
| US62 | Interface revista: todas as páginas com a largura toda do ecrã (como o Charts), menu e cartões compactos, cartões lado a lado em ecrãs largos, gráficos à altura da janela; Timelapse: duplo clique abre o instrumento no Charts | — | Feito |
| US61 | Timelapse: cor pela variação do preço (verde, cinzento, vermelho) e 5 sessões somadas por omissão | — | Feito |
| US60 | Timelapse (Mercado): animação do top 30 por valor negociado de 10 sessões nas últimas 22 sessões, com universo lista, Saxo ou catálogo; testes no navegador (Playwright) | — | Feito |
| US59 | Carteira virtual retirada e dados apagados: a carteira é a conta de simulação da SAXO, com o valor guardado por sessão para o gráfico da evolução; Visão geral e Sinais passam a usá-la | — | Feito |
| US58 | Automação de hora a hora (10 min depois de cada recolha), com os sinais da sessão em curso e da última sessão | — | Feito |
| US57 | Charts: lista «Saxo» com os instrumentos da Carteira SAXO | — | Feito |
| US56 | Automação (grupo SAXO): sinais enviados automaticamente à conta de simulação, com interruptor geral e por estratégia e lista das ordens; Correspondência SAXO passa para o grupo Administração (antes «Conta») | — | Feito |
| US55 | Painel Empresa: indicadores ao último preço, intervalo de 52 semanas alargado, resultado por acção e ano fiscal ao lado de cada P/E | — | Feito |
| US54 | Ordens SAXO num só passo («Confirmar e enviar», sem pré-validação; obrigatória só na conta real), também no envio em lote dos Sinais | — | Feito |
| US53 | Ordens SAXO: precheck da SAXO só nas ordens a mercado, com stop ou na conta real; a confirmação em dois passos mantém-se | — | Feito |
| US52 | Correspondência SAXO: regras por bolsa (ExchangeId), ISIN, símbolo e nome; ligação do catálogo inteiro, revalidação semanal e página de administração com escolha manual | — | Feito |
| US34 | Charts como sítio único do instrumento, com velas e volume (a página do instrumento redirecciona) | — | Feito |
| US35 | Cálculos antecipados e caches stale-while-revalidate: páginas de estratégias imediatas | — | Feito |
| US36 | Visão geral como painel do dia; menu em secções e botão «Mais» em telemóvel | — | Feito |
| US24 | Módulo WinnersLoosers | — | Feito |
| US25 | Módulo Promessas | — | Feito (regra validada em 5 janelas; revalidar à medida que o histórico cresce) |
| US19 | ISIN-MIC no catálogo e módulo Orderbook | — | Feito; ISIN-MIC preenchido a 20 out. 2026 a partir de `ISIN.xlsx` em 162 dos 171 instrumentos Euronext (faltam 9 que não constam do ficheiro) |

## 6. Testes

| Componente | Ferramenta | Testes |
|---|---|---|
| API | Vitest contra a base `stocks_test` | 103 (+1 de contrato com rede, opcional) |
| Motor de recolha | pytest, fornecedor simulado | 22 |
| Motor de alertas | pytest, mailer simulado | 18 |
| Frontend (cálculos) | `node --test` | 33 |

O CI no GitHub Actions corre estes testes em cada push para `main` e em cada pull request, com MariaDB 10.11, e verifica que o contrato OpenAPI está actualizado. Os testes nunca contactam o Yahoo nem a SAXO nem enviam emails. Cada funcionalidade de interface foi também verificada no browser (Chromium headless) em desktop e telemóvel, com uma cópia dos dados reais na base de testes.

## 7. Riscos

| Risco | Mitigação | Estado |
|---|---|---|
| Fonte de dados não oficial | Uso privado; adaptador substituível; versão fixada | Aceite |
| Alterações no yfinance (429, endpoints) | Novas tentativas com espera progressiva; testes com fornecedor simulado | Mitigado |
| Dados do fornecedor incorrectos | Validação das sessões; releitura de 7 dias; datas visíveis | Mitigado (ex.: fechos repetidos observados a 16 out.) |
| Eventos societários | Gráficos ajustados; limitação documentada | Aceite |
| Gastos concorrentes do saldo | Transacções, bloqueio da carteira, testes concorrentes (a carteira virtual foi retirada a 6 nov. 2026) | Resolvido |
| Alertas repetidos | Chave única por regra e sessão; reserva por utilizador | Resolvido |
| Aceitação SMTP ambígua | Estado `uncertain`, sem reenvio cego | Resolvido |
| Servidor único | Dumps diários e autobackup do VPS (cópia fora do servidor) | Mitigado; falta testar o restauro no servidor actual; indisponibilidade conjunta aceite |
| Perda da chave de cifra | Chave criada uma vez e nunca substituída | Aceite: perdê-la obriga a reintroduzir a palavra-passe SMTP |
| Desenvolvimento no servidor de produção | Base de testes separada; publicação só com `install.sh` | Pendente: ambiente de testes separado |
| Aumento do âmbito | Alterações pequenas, com testes e commit por funcionalidade | Em curso |
| Memória da API em cálculos sobre o catálogo | Um instrumento de cada vez, cálculos partilhados entre pedidos, cache só do necessário | Resolvido a 24 out. 2026 (incidente 502); medir antes de cada novo módulo deste tipo |
| Estratégias e Promessas ajustadas a um período curto | Separação por ano; período de verificação (os 2 anos antes dos usados para afinar) e custos estimados no BackTest e no Comparar; avisos na interface | Mitigado desde 8 nov. 2026 (5 anos de histórico); as Promessas continuam só com 3 anos |

## 8. Próximos passos

### P0 — fechar a versão 1

Concluído a 18 out. 2026 (SMTP, carteira a 1 M€, cópia externa e restauro). Recomenda-se repetir o teste de restauro periodicamente, por exemplo a cada trimestre.

### P1 — robustez

3. ~~Teste de restauro~~ do dump feito a 3 nov. 2026 no servidor actual; falta experimentar a recuperação de um ficheiro no painel do autobackup.
4. ~~Análise estática (ESLint, Ruff) e auditoria de dependências (`npm audit`, `pip-audit`) no CI~~ (3 nov. 2026, com o CI nas versões da produção).
5. Ambiente de testes separado da produção (outra máquina ou contentores), e trabalho por ramos com pull requests.
6. Contas de BD por componente (API e motores com permissões mínimas).
7. ~~Alerta operacional ao administrador~~ (3 nov. 2026: `stocks-ops.timer`).
8. Medição de desempenho com o volume real e registo dos controlos OWASP ASVS aplicados.
9. Teste automático de memória para os cálculos sobre todo o catálogo (BackTest, WinnersLoosers, Promessas, Sinais) com um heap limitado.

### P2 — evolução funcional (a decidir com o responsável funcional)

10. Estratégias: comissões opcionais no BackTest, execução ao fecho do dia seguinte na A-Momentum (mais realista) e parâmetros configuráveis na interface.
11. Histórico: períodos «5A» e «Tudo» no gráfico à medida que o histórico cresce.
12. Simulação: comissões opcionais e tratamento de desdobramentos nas posições.
13. Logótipos ou categorias por sector no HeatMap, se houver fonte com direitos de uso.
14. Promessas: revalidar a regra (e os valores da tabela de validação, hoje fixos na API) à medida que o histórico cresce; acompanhar o desempenho das listas publicadas.

## 9. Publicação e rollback

Lista de verificação da versão 1:

- [x] Âmbito e regras aprovados (validação contínua com o responsável funcional).
- [x] Fonte de dados validada para uso privado.
- [x] Configuração e segredos de produção em `/etc/stocks` (modo 640).
- [x] Migrações aplicadas com dbmate pelo `install.sh`.
- [x] Testes de saldo, concorrência e isolamento aprovados.
- [x] Testes de resumo único e desduplicação de alertas aprovados.
- [x] Monitorização com alerta operacional (email diário aos administradores quando há problemas).
- [x] Backup externo: autobackup do VPS.
- [ ] Restauro demonstrado no servidor actual (feito no servidor anterior a 18 out. 2026).
- [x] Envio real de email verificado (email de teste pelo SMTP da OVH).
- [x] Procedimento de rollback documentado em [deploy/README.md](../../deploy/README.md).

Rollback:

1. Suspender os timers (`stocks-fetcher-run`, `stocks-intraday`, `stocks-daily`), preservando logs e eventos.
2. Verificar se a versão anterior é compatível com o esquema actual; as migrações não são revertidas automaticamente.
3. `git checkout <versão anterior>` e `sudo deploy/install.sh`.
4. Se for preciso restaurar dados, obter aprovação explícita para a perda ou reconciliação das escritas posteriores ao backup.
5. Validar saldos, posições, recolhas e alertas antes de retomar os timers.

## 10. Critério de conclusão

A versão 1 considera-se concluída quando permite:

- acompanhar instrumentos com histórico diário de dois anos nos gráficos, com três anos guardados para a SMA200 estar completa — **cumprido**;
- simular compras e vendas com integridade de saldo e posições — **cumprido**;
- gerir alertas por email com um resumo por utilizador após cada recolha diária — **cumprido**;
- operar com monitorização e recuperação testadas — **cumprido** (aviso operacional desde 3 nov. 2026; restauro do dump testado).

A aplicação comunica de forma inequívoca que não executa operações reais e que usa dados diários, não cotações em tempo real.
