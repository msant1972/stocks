# Análise dos documentos — Plataforma de Simulação e Acompanhamento de Acções

Data: 18 out. 2026
Documentos analisados: arquitectura, plano de implementação, guia de estilos UI/UX e diagrama `stocks.drawio.png`.

## 1. Resumo

Os três documentos são coerentes entre si e com o diagrama: os mesmos cinco módulos (React, Node.js, MariaDB, recolha Python, alertas Python), o mesmo âmbito (só simulação, dados diários, dois anos, email com limite de 1 h) e as mesmas regras de simulação. A qualidade é alta, sobretudo nas partes de integridade (transacções, idempotência, desduplicação de alertas) e de honestidade dos dados na interface.

Os problemas não estão na coerência, estão em quatro pontos que bloqueiam o arranque ou que vão gerar trabalho desnecessário:

1. **Quem vai usar a aplicação** não está definido (só o Miguel, um grupo pequeno, ou público). Esta resposta decide a fonte de dados, a criação de contas e o tamanho do plano.
2. **A fonte de dados (Yahoo Finance via yfinance)** não é oficial e é, na prática, para uso pessoal. Serve para um projecto pessoal; não serve para um serviço público.
3. **O limite de "1 email por hora por regra" quase nunca actua** com dados diários. A desduplicação por evento já garante, no máximo, um email por regra por dia. O limite só tem efeito se for global por utilizador, e aí o mais simples é enviar um resumo único por utilizador.
4. **O plano está dimensionado para uma equipa de 4 papéis e 10 a 12 semanas**, com piloto, marcos formais e OWASP ASVS. Se for um projecto individual, convém uma versão mais leve.

## 2. Consistência entre documentos e diagrama

| Ponto | Situação | Comentário |
|---|---|---|
| Cinco módulos e tecnologias | Coerente | Diagrama, arquitectura e plano coincidem. |
| UI fora do servidor Ubuntu | Parcialmente coerente | O diagrama põe o React fora da caixa Ubuntu; a arquitectura deixa em aberto; o plano propõe conteúdo estático atrás de um proxy HTTPS (muito provavelmente no mesmo servidor). Decidir e actualizar o diagrama. |
| Setas | Simplificadas no diagrama | O diagrama tem setas num só sentido (UI→API→BD, alertas→BD); a arquitectura usa bidireccionais. Não é um problema, mas o diagrama não mostra a coordenação recolha→alertas nem o agendador. |
| Gralhas no diagrama | Confirmado pelo Miguel | «maradb» é MariaDB e «pyton» é Python. |
| Limite de alertas | Coerente | Os três documentos adoptam «por regra e por utilizador, janela móvel de 60 min». |
| Moeda | Coerente, mas ambíguo | Plano: «uma carteira e uma moeda por utilizador; instrumentos de outras moedas excluídos». Não diz se ficam excluídos só da carteira ou também da watchlist e alertas. O guia usa «150,00 USD» como exemplo de alerta. |
| Retenção de 2 anos | Coerente | Mas ver secção 4.4: apagar dados antigos não traz benefício. |
| Referências `[web:21]`, `[web:27]`, etc. | Resto de exportação | São marcadores de citações de uma conversa e não apontam para nada. Substituir por links reais ou remover. |

## 3. Lacunas (o que falta para começar a escrever código)

### 3.1. Origem do catálogo de instrumentos
A UI pesquisa instrumentos (US02) e a API «valida o instrumento» (fluxo 5.1), mas só o motor Python fala com o Yahoo. Falta definir:
- de onde vem a lista pesquisável (tabela pré-carregada com o conjunto piloto, ou pesquisa em tempo real no fornecedor);
- como a API valida um ticker novo sem falar com o fornecedor.

**Decisão do Miguel (18 out. 2026):** o catálogo é preenchido pelo utilizador, por introdução manual ou por importação de um ficheiro Excel com a lista de instrumentos.

Implicações e proposta:
- **Validação assíncrona:** como só o motor Python fala com o fornecedor, a API grava o instrumento com estado «A validar» e cria um pedido em `fetch_jobs`. O motor confirma que o ticker existe, preenche nome, mercado e moeda, faz a carga de dois anos e passa o estado para «Activo», ou para «Inválido» com o motivo. A UI mostra estes estados.
- **Formato do Excel:** um modelo fixo, descarregável na aplicação, com colunas `ticker` (símbolo Yahoo, ex.: `GALP.LS`, `AAPL`), `nome` (opcional), `mercado` (opcional) e `moeda` (opcional). Só a coluna ticker é obrigatória; o resto vem do fornecedor.
- **Importação:** pré-visualização antes de gravar, com linhas válidas, duplicadas e com erro; aceitar só `.xlsx` (e eventualmente `.csv`), com limite de tamanho e de linhas. A leitura pode ser feita na API (ex.: biblioteca `exceljs`) ou no browser.
- **Catálogo partilhado ou por utilizador:** recomendo um catálogo global único (chave: ticker + mercado), onde cada utilizador adiciona instrumentos e os associa à sua watchlist. Evita recolher o mesmo ticker várias vezes.
- **Moeda:** instrumentos noutra moeda podem ser importados e acompanhados; só a simulação fica limitada à moeda da carteira (ver 4.3).

### 3.2. Coordenação entre API, recolha e alertas
O fluxo 5.1 diz que o motor «identifica a necessidade de carga inicial», sem dizer como. O plano tem uma tabela `fetch_jobs`, o que sugere uma fila na BD.
**Proposta:** a API insere um pedido em `fetch_jobs`; o motor de recolha corre por timer systemd (ex.: a cada minuto para cargas iniciais, e uma vez por dia para o incremental); o motor de alertas corre no fim da recolha diária (encadeado no mesmo timer ou a fazer polling a `job_runs`). Não é preciso fila externa nem sexto módulo.

### 3.3. Hora da recolha diária
Não está definida. Se os mercados forem EU e EUA, uma única execução depois do fecho americano (cerca das 22h30–23h em Lisboa) cobre ambos. Se forem só Euronext, pode ser ao fim da tarde.

### 3.4. Criação de contas
O guia proíbe registo público e recuperação de conta «sem implementação aprovada», e o plano tem login/logout, mas ninguém diz como uma conta nasce. **Proposta:** comando de administração (CLI) para criar utilizadores no MVP.

### 3.5. Escolhas técnicas concretas
Nenhum documento fixa: framework Node (Express/Fastify), acesso à BD (Knex, Prisma, mysql2), ferramenta de migrações, bibliotecas React (build, routing, dados remotos, gráficos), versões de Node/Python/MariaDB, e se é monorepo. Ponto crítico: **duas linguagens escrevem na mesma BD**, por isso é preciso uma única fonte das migrações (ex.: migrações do lado Node, ou uma ferramenta neutra como dbmate/Flyway) e o Python apenas consome o esquema.

### 3.6. SMTP
Não há fornecedor escolhido. Para volumes pequenos, Gmail com palavra-passe de aplicação ou um serviço transaccional (Brevo, Mailgun, SES) chegam. Com domínio próprio é preciso SPF/DKIM, senão os emails vão para spam.

### 3.7. Representação das posições e resultados
A arquitectura deixa em aberto; o plano propõe custo médio ponderado. Está bem, mas tem de passar a decisão fechada (afecta o modelo de dados de `positions`).

## 4. Riscos e observações técnicas

### 4.1. Yahoo Finance / yfinance (risco alto, bloqueante)
- O yfinance não é uma API oficial: faz pedidos aos endpoints públicos do site da Yahoo. A própria documentação do projecto avisa que é para uso pessoal e remete para os termos da Yahoo.
- Riscos práticos: bloqueios por limite de pedidos (HTTP 429), mudanças sem aviso nos endpoints que partem a biblioteca, e mudanças de comportamento entre versões (por exemplo, o valor por omissão de `auto_adjust` mudou em versões recentes, o que altera os preços devolvidos sem erro visível).
- **Para uso pessoal/pequeno grupo privado:** risco aceitável, desde que a biblioteca fique atrás de um adaptador substituível e a versão seja fixada.
- **Para um serviço aberto a terceiros:** não deve ser assumido; usar um fornecedor com licença (EODHD, Tiingo, Twelve Data, Alpha Vantage, Financial Modeling Prep, entre outros). Preços e limites dos planos gratuitos mudam com frequência e devem ser verificados no momento da escolha.

### 4.2. Limite de 1 h com dados diários (decisão de desenho)
Com uma cotação por sessão e desduplicação por (regra, sessão, condição), cada regra só pode disparar uma vez por dia. O limite de 60 min por regra fica, na prática, sem efeito, mas obriga a implementar e testar a política de «evento pendente até expirar o intervalo» (plano, F5).

O caso que realmente incomoda o utilizador é outro: 10 regras a disparar na mesma noite geram 10 emails seguidos. Um limite global por utilizador resolveria, mas com a política de pendentes iria espalhar os emails por 10 horas.

**Proposta:** um **email de resumo por utilizador por execução** com todos os alertas disparados. Cumpre o requisito «no máximo um por hora» em qualquer das interpretações, elimina a política de pendentes e simplifica os testes.

### 4.3. Moeda única
Se a carteira for em EUR e o catálogo tiver acções americanas, a regra do plano exclui-as. Proposta: permitir acompanhar e criar alertas sobre qualquer moeda, e permitir simular só instrumentos na moeda da carteira. Alternativa: escolher a moeda da carteira em função do mercado principal (USD se for sobretudo EUA).

### 4.4. Retenção móvel de dois anos
Dois anos por ticker são cerca de 500 linhas; mil tickers durante dez anos ficam abaixo de 3 milhões de linhas, o que o MariaDB gere sem esforço. Apagar dados antigos acrescenta um processo, testes e risco (gráficos que encolhem) sem ganho. **Proposta:** os «dois anos» passam a ser só a profundidade da carga inicial; não apagar nada no MVP.

### 4.5. Preços ajustados e eventos societários
O plano diz bem para não misturar séries. **Proposta concreta:** guardar o fecho não ajustado e o fecho ajustado na mesma linha; as operações simuladas usam o não ajustado (é o preço que «existiu»); os gráficos usam o ajustado. Um desdobramento numa acção detida continua a distorcer a posição; no MVP, sinalizar e documentar como limitação.

### 4.6. Servidor único
Já identificado nos documentos. Com dados reconstruíveis a partir do fornecedor, o que importa proteger são utilizadores, carteiras, operações e regras. Backup diário com `mariadb-dump` para fora do servidor e um teste de restauro chega para o MVP.

### 4.7. Dimensão do plano
40 a 50 dias-pessoa, quatro papéis, marcos M0–M4, piloto e checklist de publicação formal. Faz sentido para um produto com utilizadores externos; para um projecto pessoal é sobredimensionado. Os controlos de integridade (transacções, idempotência, isolamento entre utilizadores) devem ficar; o processo à volta pode encolher.

### 4.8. Duas linguagens no backend
Node na API e Python nos motores é viável e está bem separado, mas duplica tooling, testes e acesso à BD. Não é um erro; fica registado como custo. Se a simplicidade pesar mais do que a preferência por Node, uma API em Python (FastAPI) unificaria o backend. A recomendação é manter a arquitectura actual, a não ser que o Miguel prefira uma só linguagem.

## 5. Guia de estilos

Bom e alinhado com o resto: proíbe linguagem «ao vivo», obriga a mostrar a data da cotação e o carácter simulado, e cobre acessibilidade.

Verifiquei os contrastes dos tokens de cor (cálculo WCAG):

| Token | Tema claro (sobre fundo / superfície / muted) | Tema escuro |
|---|---|---|
| text-secondary | 6,4 / 7,0 / 6,0 | 9,7 / 8,7 / 7,7 |
| accent | 5,5 / 6,0 / 5,2 | 10,8 / 9,6 / 8,5 |
| positive | 6,6 / 7,1 / 6,1 | 13,5 / 12,0 / 10,6 |
| negative | 6,0 / 6,6 / 5,7 | 9,7 / 8,7 / 7,7 |
| warning | 6,3 / 6,9 / 5,9 | 15,2 / 13,5 / 12,0 |
| control-border | 4,0 / 4,4 / 3,8 | 6,1 / 5,5 / 4,8 |
| Botão primário (texto sobre accent) | 6,0 | 10,8 |

Todos passam AA (4,5:1 para texto, 3:1 para limites de controlos). `border-subtle` fica em 1,2–1,7:1, o que está correcto porque o guia já o restringe a separadores decorativos.

Lacunas menores: não indica biblioteca de gráficos nem de componentes acessíveis; não tem maquetas (o plano prevê esboços em F0).

## 6. Decisões a fechar antes de começar

Por ordem de impacto, com a minha recomendação:

| # | Decisão | Recomendação |
|---|---|---|
| 1 | Utilizadores | **Decidido:** grupo privado. |
| 2 | Fonte de dados | **Decidido:** yfinance, atrás de um adaptador substituível e com versão fixada. |
| 3 | Mercados e moeda da carteira | **Decidido:** carteira em EUR. A lista inicial do Miguel (41 símbolos) inclui Euronext, Xetra (.DE), Madrid (.MC) e Helsínquia (.HE), por isso a regra passa a ser «instrumentos cotados em EUR», verificada pela moeda devolvida pelo fornecedor, e não «só Euronext». Recolha diária às 19h de Lisboa, depois do fecho das 17h30 CET. |
| 4 | Limite de alertas | **Decidido:** email de resumo por utilizador após cada recolha diária. |
| 5 | Catálogo de instrumentos | **Decidido:** catálogo global partilhado, preenchido à mão ou por Excel; cada utilizador escolhe os instrumentos que acompanha na sua lista. |
| 6 | Retenção | Não apagar cotações no MVP. |
| 7 | Preços ajustados | Guardar ambos; operar com não ajustado; gráficos com ajustado. |
| 8 | Capital virtual inicial | Valor configurável (ex.: 10 000 na moeda da carteira), sem reposição no MVP. |
| 9 | Stack concreta | Fixar framework Node, acesso à BD, ferramenta única de migrações, bibliotecas React e versões. |
| 10 | Criação de contas e SMTP | CLI de administração; fornecedor SMTP escolhido. |

As restantes propostas do plano (último fecho, sem comissões, custo médio, quantidades inteiras, sem posições curtas, alertas «acima/abaixo» e «variação %») parecem-me adequadas e podem ser aprovadas tal como estão.

## 7. Próximos passos recomendados

1. Responder às decisões 1 a 4 (são as que mudam o desenho).
2. Criar o repositório (monorepo com `frontend/`, `api/`, `engines/`, `db/migrations/`, `docs/`) e colocar lá estes documentos e um registo de decisões.
3. Fazer uma prova de conceito curta do motor de recolha: carregar dois anos de 10 a 20 tickers do mercado escolhido, guardar no MariaDB com chave única (instrumento, data) e verificar fins-de-semana, feriados, dados em falta e preços ajustados.
4. Fechar o esquema da BD e o contrato OpenAPI a partir das decisões.
5. Seguir a ordem do plano (recolha → consulta e watchlist → carteira e simulação → alertas), com uma versão de processo mais leve se for um projecto individual.
