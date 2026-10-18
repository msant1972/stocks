# Plano de Implementação — Plataforma de Simulação e Acompanhamento de Acções

## 1. Objectivo do plano

Implementar uma primeira versão funcional da aplicação, organizada em cinco módulos: interface React, middleware/API Node.js, base de dados MariaDB, motor de recolha Python e motor de alertas Python.

Este plano é uma proposta de execução. As durações são estimativas de planeamento, não compromissos de entrega. O início depende da validação do âmbito, da disponibilidade da equipa e do acesso aos serviços externos.

## 2. Âmbito da primeira versão

### 2.1. Requisitos confirmados

- Negociação exclusivamente simulada e acompanhamento de acções.
- Histórico de dois anos por instrumento, com granularidade diária.
- Alertas por email com frequência máxima de uma notificação por hora.
- Cinco módulos funcionais, de acordo com a arquitectura definida.
- Ausência de operações reais ou integração com corretoras.

### 2.2. Interpretações e propostas a validar na fase inicial

- Limite horário aplicado por regra e por utilizador, com intervalo móvel de 60 minutos, e não por hora de relógio.
- Histórico mantido numa janela móvel de dois anos.
- Recolha diária após disponibilização dos dados de cada sessão.
- Simulações executadas ao último fecho diário disponível, claramente identificado.
- Uma carteira e uma moeda por utilizador no MVP; instrumentos de outras moedas ficam excluídos até existir suporte cambial.
- Quantidades inteiras, sem posições curtas, alavancagem ou derivados.
- Capital inicial configurável; reposição de capital fora do fluxo normal do MVP.
- Custo médio ponderado para cálculo do custo de aquisição.
- Sem comissões, dividendos ou ajustamentos automáticos de eventos societários no MVP.
- Apenas instrumentos cuja política de preços e eventos societários tenha sido validada no piloto.
- Alertas iniciais de fecho acima/abaixo de um limite e variação percentual entre sessões.

Qualquer alteração destas propostas deverá actualizar o âmbito, os testes e a estimativa.

### 2.3. Fora do âmbito

- Negociação real, pagamentos, integração com corretoras e custódia de activos.
- Streaming, cotações intradiárias e alertas de mercado em tempo real.
- Aplicações móveis nativas.
- Backtesting de estratégias e negociação automática.
- Carteiras multimoeda, vendas a descoberto e tratamento completo de dividendos e desdobramentos.
- Alta disponibilidade distribuída na primeira implantação.

## 3. Equipa, duração e premissas

### 3.1. Equipa de referência

| Papel | Participação prevista |
|---|---|
| Responsável funcional | Validação de regras, prioridades e aceitação; disponibilidade semanal |
| Programador full-stack | Desenvolvimento React, Node.js, Python, integração e testes |
| Apoio de infraestrutura/DevOps | Ambientes, pipeline, segurança, publicação e recuperação |
| Apoio QA/segurança | Revisão de testes e validação antes do piloto |

Os papéis podem ser acumulados, mas a capacidade e o prazo devem ser revistos quando isso acontecer.

### 3.2. Estimativa de referência

- Execução base: dez semanas de calendário.
- Reserva de planeamento: duas semanas adicionais.
- Horizonte indicativo: dez a doze semanas, a confirmar após a prova de conceito do fornecedor de dados.
- Esforço indicativo de desenvolvimento: 40 a 50 dias-pessoa.
- Esforço adicional de apoio técnico e validação: 6 a 10 dias-pessoa, distribuídos pelo projecto.

A estimativa pressupõe um programador experiente com dedicação predominante, uma interface simples, um conjunto limitado de mercados no piloto e ausência de alterações significativas ao âmbito. Não se deve somar o esforço de várias pessoas e tratá-lo directamente como duração de calendário.

## 4. Cronograma e marcos

| Fase | Janela indicativa | Resultado | Dependências |
|---|---|---|---|
| F0 — Requisitos e prova de conceito | Semana 1 | Âmbito e fonte de dados validados | Acesso aos serviços e responsável funcional |
| F1 — Fundação técnica | Semana 2 | Repositório, ambientes, base de dados e pipeline | F0 aprovada |
| F2 — Recolha e histórico | Semanas 3–4 | Dois anos de dados diários consultáveis | F1 e contrato de dados |
| F3 — API e acompanhamento | Semanas 4–5 | Login, pesquisa, watchlist e gráficos | Fundação da API e dados de F2 |
| F4 — Carteira e simulação | Semanas 6–7 | Compras, vendas e resultados simulados | F3 e regras de simulação fechadas |
| F5 — Alertas e email | Semana 8 | Regras, limitação horária e registos | F2, autenticação e SMTP |
| F6 — Integração e endurecimento | Semana 9 | Versão candidata testada | F2 a F5 concluídas |
| F7 — Piloto e publicação | Semana 10 | Aceitação e aplicação operacional | F6 aprovada |
| Reserva | Semanas 11–12, se necessária | Correcções e imprevistos | Aprovação do responsável |

Na semana 4, as tarefas de F2 e F3 são sequenciadas dentro da capacidade disponível; não se pressupõe que o mesmo programador execute ambas a tempo inteiro.

Marcos de aprovação:

- M0: requisitos e política de dados aprovados.
- M1: histórico diário validado e API de consulta funcional.
- M2: simulação transaccional aprovada.
- M3: alertas e limite de 60 minutos aprovados.
- M4: piloto, recuperação e publicação aprovados.

## 5. Plano detalhado por fase

### F0 — Requisitos e prova de conceito

Tarefas:

- Validar as propostas da secção 2.2 e registar decisões.
- Seleccionar um conjunto piloto proposto de 10 a 20 instrumentos, de um mercado e moeda iniciais.
- Confirmar identificação por instrumento e mercado, datas de sessão e fuso horário.
- Ensaiar a recolha de dois anos diários, dados em falta e actualizações incrementais.
- Validar abertura, máximo, mínimo, fecho, volume e política de preços ajustados.
- Avaliar eventos societários: não misturar séries ajustadas e não ajustadas; documentar limitações e tratamento de posições afectadas.
- Confirmar SMTP, destinatários de teste e credenciais.
- Desenhar e validar os ecrãs principais.

O eventual uso de yfinance fica condicionado à avaliação das condições de utilização dos dados. A documentação do projecto declara que não é uma integração oficial da Yahoo, remete para os termos da Yahoo e alerta para utilização pessoal. A viabilidade de um serviço multiutilizador não deve ser assumida. [web:27]

Entregáveis:

- Backlog priorizado e regras de negócio.
- Registo das decisões de arquitectura.
- Prova de conceito de dados e SMTP.
- Esboços dos ecrãs.

Critério de saída: fonte tecnicamente adequada e utilização autorizada para o cenário pretendido, ou decisão de substituir o fornecedor antes de avançar.

### F1 — Fundação técnica e infraestrutura

Tarefas:

- Criar repositório com áreas frontend, API, motores, migrações e documentação.
- Definir versões suportadas e fixar dependências.
- Criar ambientes local e de testes; preparar produção separada.
- Implementar pipeline com análise estática, testes e construção dos artefactos.
- Criar esquema inicial e migrações versionadas.
- Configurar segredos, logs, HTTPS e contas de serviço.
- Definir o contrato OpenAPI e o formato comum de erros.
- Preparar autenticação e autorização de base.

Modelo de implantação proposto: serviços separados no Ubuntu, geridos por systemd, com proxy inverso HTTPS. O frontend é publicado como conteúdo estático. Docker pode ser adoptado mediante decisão explícita, sem duplicar abordagens de implantação.

Critério de saída: instalação repetível num ambiente vazio, API com health check e migrações executadas com sucesso.

### F2 — Base de dados e motor de recolha

Tarefas:

- Criar instrumentos, cotações, tarefas de carga e estados de recolha.
- Definir unicidade por instrumento e data de sessão.
- Implementar carga inicial de dois anos e actualização incremental.
- Fazer inserção/actualização idempotente e tratar correcções do fornecedor.
- Validar valores, cobertura, moeda e datas.
- Implementar novas tentativas com espera progressiva e limite configurável.
- Impedir sobreposição de recolhas do mesmo instrumento.
- Manter janela móvel de dois anos sem apagar dados de operações simuladas.
- Disponibilizar métricas da última sessão recolhida e dos erros.

Entregáveis:

- Migrações de instrumentos e cotações.
- Comando de carga inicial e processo agendado incremental.
- Relatório de cobertura e falhas do conjunto piloto.

Critérios de saída:

- Recolhas repetidas não criam duplicações.
- Instrumentos com menos de dois anos apresentam cobertura real, sem dados fabricados.
- Fins de semana e feriados não são preenchidos como sessões artificiais.
- Uma falha num instrumento não interrompe todos os restantes.

### F3 — API, autenticação e interface de acompanhamento

Tarefas:

- Implementar início e fim de sessão e protecção dos endpoints.
- Validar propriedade dos recursos em todas as operações.
- Criar pesquisa, detalhe de instrumento, histórico paginado e watchlist.
- Construir gráficos diários e estados de carregamento/erro.
- Mostrar data da cotação, moeda, cobertura e aviso de dados desactualizados.
- Definir um limiar de desactualização adequado ao calendário das sessões.
- Criar testes de isolamento entre utilizadores.

Critério de saída: um utilizador autenticado acompanha instrumentos e consulta o histórico sem conseguir aceder aos recursos privados de outro utilizador.

### F4 — Carteira virtual e simulação

Tarefas:

- Criar carteira, movimentos de saldo, operações e posições.
- Usar representação decimal para quantidades monetárias, com política de arredondamento explícita.
- Validar saldo e quantidade antes de concluir operações.
- Guardar preço aplicado, moeda, data da cotação e instante do pedido.
- Implementar idempotência dos pedidos de operação.
- Aplicar transacções e controlo de concorrência nas actualizações do saldo e das posições.
- Calcular custo médio, ganhos realizados e valorização não realizada.
- Mostrar aviso de execução simplificada ao último fecho disponível.

A implementação de concorrência poderá usar bloqueio de linhas com SELECT FOR UPDATE dentro de uma transacção. A documentação MariaDB esclarece que a cláusula depende de uma transacção ou de autocommit desactivado para produzir o efeito esperado no InnoDB. [web:21]

Critérios de saída:

- Duas compras concorrentes não podem gastar o mesmo saldo.
- Uma venda não pode tornar a posição negativa.
- Repetir um pedido com a mesma chave de idempotência não duplica a operação.
- Uma falha a meio da operação não deixa saldo, posição e histórico inconsistentes.
- Os resultados coincidem com cenários de referência calculados para os testes.

### F5 — Motor de alertas e SMTP

Tarefas:

- Criar regras por instrumento e utilizador.
- Avaliar regras após actualização das cotações diárias.
- Registar eventos com chave única por regra, sessão e tipo de condição.
- Verificar intervalo móvel de 60 minutos desde o último envio bem-sucedido.
- Reservar tarefas atomicamente para impedir dois processos de enviarem o mesmo evento em simultâneo.
- Criar templates de email com instrumento, condição, valor, moeda e data da cotação.
- Registar tentativas, estados e falhas SMTP.
- Implementar repetição limitada e painel de diagnóstico.

Política proposta: um evento bloqueado pelo intervalo horário fica pendente até expirar o intervalo, se a regra continuar activa e o evento ainda for relevante. A validade e eventual substituição por evento mais recente deverão ser aprovadas em F0.

A limitação de frequência e a desduplicação são controlos distintos. Não se deve prometer entrega exactamente uma vez por SMTP: se o servidor aceitar a mensagem e a ligação falhar antes da confirmação local, pode existir incerteza. Nesses casos, registar estado incerto e aplicar a política de reconciliação aprovada, evitando reenvio cego.

Critérios de saída:

- Não existe novo envio conhecido como bem-sucedido da mesma regra/utilizador antes de decorridos 60 minutos.
- Reavaliar o mesmo evento não produz novo envio após sucesso registado.
- Reiniciar processos não elimina o histórico de controlo.
- Falhas e estados incertos ficam visíveis para diagnóstico.

### F6 — Integração, segurança e fiabilidade

Tarefas:

- Executar testes ponta a ponta e regressão.
- Rever autenticação, sessões, autorização, validação de entradas e gestão de segredos.
- Testar injecção SQL, acesso indevido a recursos e limitação de pedidos.
- Verificar dependências e remover credenciais de logs.
- Ensaiar indisponibilidade do fornecedor e do SMTP.
- Executar testes de concorrência das operações e dos alertas.
- Medir tempos de resposta com um volume de dados e concorrência aprovados na F0.
- Realizar backup e restauro completo num ambiente separado.

Usar o OWASP ASVS como referência para seleccionar e registar os controlos de segurança e os respectivos testes, sem alegar certificação automática por seguir uma lista. [web:26]

Critério de saída: nenhum defeito bloqueante ou crítico aberto, testes essenciais aprovados e restauro demonstrado.

### F7 — Piloto, aceitação e publicação

Tarefas:

- Disponibilizar a versão candidata a um grupo piloto.
- Validar os cenários de aceitação com o responsável funcional.
- Corrigir defeitos e actualizar documentação.
- Preparar configuração de produção, DNS e TLS.
- Confirmar backups, monitorização e notificações operacionais.
- Publicar versão identificada e executar testes rápidos pós-publicação.
- Entregar o procedimento de operação e recuperação.

Critério de saída: aceitação formal, aplicação publicada, responsáveis identificados e procedimento de rollback validado.

## 6. Backlog prioritário

| ID | Item | Prioridade | Aceitação resumida |
|---|---|---|---|
| US01 | Autenticação | P0 | Sessões e isolamento de utilizadores testados |
| US02 | Pesquisa de instrumentos | P0 | Identificação inequívoca por instrumento e mercado |
| US03 | Histórico diário | P0 | Até dois anos disponíveis, sem duplicação |
| US04 | Watchlist | P1 | Adicionar/remover apenas da própria lista |
| US05 | Carteira virtual | P0 | Capital inicial e saldo coerentes |
| US06 | Compra simulada | P0 | Saldo validado e operação atómica |
| US07 | Venda simulada | P0 | Quantidade validada e operação atómica |
| US08 | Posições e resultados | P0 | Valores conferidos com cenários de referência |
| US09 | Regras de alerta | P0 | Activação, edição e desactivação funcionais |
| US10 | Envio de alertas | P0 | Intervalo de 60 minutos e desduplicação testados |
| US11 | Estado das recolhas | P1 | Última execução e erros visíveis |
| US12 | Backup e recuperação | P0 | Restauro integral demonstrado |

P0 indica indispensável à publicação; P1 indica importante mas adiável mediante decisão explícita. A redução do âmbito não pode eliminar controlos de integridade ou segurança.

## 7. Modelo de dados a implementar

| Grupo | Tabelas lógicas propostas |
|---|---|
| Identidade | users, sessions |
| Mercado | instruments, daily_quotes, fetch_jobs |
| Acompanhamento | watchlists, watchlist_items |
| Simulação | portfolios, cash_movements, simulated_trades, positions |
| Alertas | alert_rules, alert_events, email_deliveries |
| Operação | audit_log, job_runs |

Os nomes e a normalização final serão definidos em F1. Todas as alterações são introduzidas por migrações versionadas. Os estados e relações devem ter restrições e índices adequados.

Convenções propostas:

- Instantes técnicos em UTC; data de sessão separada segundo o mercado.
- Valores monetários em DECIMAL, com precisão definida no desenho detalhado.
- Chaves únicas para cotações, pedidos idempotentes e eventos de alerta.
- Preço de execução e data da cotação preservados nas operações.
- Registos de auditoria sem passwords, tokens ou credenciais SMTP.

## 8. Contrato de API inicial

| Área | Endpoints indicativos |
|---|---|
| Sessão | POST /api/v1/auth/login; POST /api/v1/auth/logout; GET /api/v1/me |
| Instrumentos | GET /api/v1/instruments; GET /api/v1/instruments/{id} |
| Histórico | GET /api/v1/instruments/{id}/quotes?from=...&to=... |
| Watchlist | GET /api/v1/watchlist; POST /api/v1/watchlist/items; DELETE /api/v1/watchlist/items/{id} |
| Carteira | GET /api/v1/portfolio; GET /api/v1/portfolio/positions |
| Operações | POST /api/v1/simulated-trades; GET /api/v1/simulated-trades |
| Alertas | GET/POST /api/v1/alerts; PATCH/DELETE /api/v1/alerts/{id} |
| Operação | GET /health/live; GET /health/ready |

O contrato deverá definir paginação, limites, validação, autenticação, idempotência e formato dos erros. Endpoints de diagnóstico detalhado não devem expor dados internos publicamente.

## 9. Estratégia de testes

| Categoria | Cenários essenciais |
|---|---|
| Unitários | Custo médio, saldo, condições de alerta, arredondamento e intervalo horário |
| Base de dados | Unicidade, transacções, migrações e concorrência |
| Fornecedor | Timeouts, falhas parciais, correcções e histórico incompleto |
| API | Autorização, validação, paginação e idempotência |
| Interface | Login, gráficos, estados de erro, compra/venda e alertas |
| Email | Sucesso, falha, reinício, concorrência, limite horário e estado incerto |
| Recuperação | Backup, restauro, reinício e reconciliação de tarefas |
| Segurança | Sessões, acesso entre utilizadores e ausência de segredos nos logs |

Os testes automáticos usam dados e relógio controlados; a passagem do pipeline não depende da disponibilidade do Yahoo Finance nem de email real. Os testes com serviços externos ficam separados e identificados.

## 10. Riscos e mitigação

| Risco | Mitigação | Responsável |
|---|---|---|
| Fonte sem adequação técnica ou direitos de uso | Validar em F0 e manter adaptador substituível | Responsável funcional e desenvolvimento |
| Dados atrasados ou incompletos | Mostrar antiguidade e cobertura; política de bloqueio aprovada | Desenvolvimento |
| Eventos societários distorcem posições | Política explícita e restrições do MVP; sinalizar casos afectados | Responsável funcional |
| Gastos concorrentes do saldo | Transacções, bloqueio e testes concorrentes | Desenvolvimento |
| Alertas repetidos | Chaves únicas, reserva atómica e controlo persistente | Desenvolvimento |
| Aceitação SMTP ambígua | Estado incerto e reconciliação, sem reenvio automático cego | Desenvolvimento e operação |
| Falha do servidor único | Backups, restauro testado e risco aceite | Infraestrutura |
| Aumento do âmbito | Backlog aprovado e controlo de alterações | Responsável funcional |
| Ausência de dedicação prevista | Rever capacidade e replanear marcos | Coordenação |

## 11. Publicação e rollback

Checklist de publicação:

- [ ] Âmbito e regras aprovados.
- [ ] Fonte de dados validada para a utilização pretendida.
- [ ] Configuração e segredos de produção verificados.
- [ ] Migrações ensaiadas e backup pré-publicação disponível.
- [ ] Testes de saldo, concorrência e isolamento aprovados.
- [ ] Testes de limite horário e duplicação de alertas aprovados.
- [ ] Logs, monitorização e alertas operacionais activos.
- [ ] Backup e restauro demonstrados.
- [ ] Piloto aceite e limitações comunicadas.
- [ ] Procedimento de rollback aprovado.

Rollback proposto:

1. Suspender novas operações simuladas e envios, preservando logs e eventos.
2. Avaliar compatibilidade da versão anterior com o esquema actual.
3. Repor a versão anterior apenas quando essa compatibilidade estiver garantida.
4. Se for necessário restaurar dados, obter aprovação explícita para a perda ou reconciliação das escritas posteriores ao backup.
5. Validar saldos, posições, recolhas e notificações antes de retomar os processos.

## 12. Documentação e entrega

Entregáveis finais:

- Código-fonte e instruções de instalação.
- Arquitectura actualizada e decisões registadas.
- Modelo de dados e migrações.
- Contrato OpenAPI.
- Testes automáticos e resultados de aceitação.
- Manual de utilização com as limitações da simulação.
- Guia de configuração de dados e SMTP.
- Procedimentos de publicação, backup, restauro e rollback.
- Lista de limitações conhecidas e backlog de evolução.

## 13. Critério global de conclusão

A primeira versão considera-se concluída quando permite acompanhar instrumentos com histórico diário disponível até dois anos, simular compras e vendas com integridade de saldo e posições, gerir alertas por email com o limite aprovado de 60 minutos e operar com monitorização e recuperação testadas.

A aceitação depende dos critérios funcionais e operacionais, não apenas da conclusão do código. A aplicação deve comunicar de forma inequívoca que não executa operações reais e que utiliza dados diários, não cotações em tempo real.
