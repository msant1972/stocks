# Guia de Estilo UI/UX — Plataforma de Simulação e Acompanhamento de Acções

## 1. Objectivo

Definir uma interface web elegante, fluida e consistente para a aplicação React, inspirada na clareza, contenção visual e qualidade de interacção associadas às interfaces Apple.

A aplicação terá identidade própria. Não deve copiar ecrãs, logótipos, ícones proprietários ou elementos de marca Apple, nem apresentar-se como produto oficial dessa empresa.

Este guia estabelece uma proposta visual e funcional para implementação. Os valores de cor, dimensões e duração são decisões deste projecto, não especificações oficiais da Apple.

### Contexto funcional obrigatório

- Negociação exclusivamente simulada.
- Carteira e saldo virtuais.
- Histórico diário dos últimos dois anos, sujeito à disponibilidade dos dados.
- Alertas por email agrupados num único resumo por utilizador, enviado após a recolha diária das cotações.
- Instrumentos cotados em EUR e carteira em EUR.
- Ausência de cotações intradiárias e de execução real em bolsa.

A interface nunca deve criar a impressão de negociação real ou de acompanhamento em tempo real.

## 2. Direcção artística

### Conceito

Uma aplicação financeira serena e precisa: superfícies claras, tipografia cuidada, muito espaço útil, cores contidas, informação organizada e animações discretas.

A sensação de qualidade deve resultar da consistência e da atenção aos detalhes, não do excesso de efeitos. O conteúdo financeiro permanece a prioridade.

### Princípios

1. Clareza antes da decoração: cada ecrã deve tornar evidente o que consultar e o que fazer.
2. Hierarquia inequívoca: um título, um contexto e uma acção principal por área.
3. Profundidade subtil: fundos, superfícies e elevações distinguem camadas sem competir com os dados.
4. Continuidade: preservar contexto, filtros e posição de navegação sempre que possível.
5. Fluidez funcional: feedback imediato, sem bloquear o utilizador para terminar animações.
6. Honestidade dos dados: mostrar moeda, data da cotação e natureza simulada das operações.
7. Acessibilidade de base: teclado, contraste e movimento reduzido fazem parte do desenho inicial.

As HIG da Apple servem como inspiração de interacção e apresentação, adaptada ao contexto web e não como imposição de componentes nativos.

## 3. Linguagem visual

### 3.1. Paleta de cores

Adoptar tema claro como apresentação inicial e disponibilizar modo escuro e opção «Sistema».

| Token | Tema claro | Tema escuro | Aplicação |
|---|---|---|---|
| background | #F5F5F7 | #101114 | Fundo geral |
| surface | #FFFFFF | #1C1D22 | Cartões e painéis |
| surface-muted | #ECEEF2 | #25272E | Áreas secundárias |
| text-primary | #1D1D1F | #F5F5F7 | Texto principal |
| text-secondary | #555963 | #B6BAC5 | Legendas e contexto |
| accent | #005FCC | #99C7FF | Links e selecção |
| primary-fill | #005FCC | #99C7FF | Botão principal |
| on-primary | #FFFFFF | #101114 | Texto sobre botão principal |
| positive | #166534 | #86EFAC | Resultados positivos |
| negative | #B42318 | #FDA29B | Resultados negativos e erros |
| warning | #854D0E | #FDE68A | Avisos |
| border-subtle | #DADDE3 | #363A45 | Separadores decorativos |
| control-border | #737985 | #8C93A3 | Limites de campos quando necessários |
| focus | #005FCC | #99C7FF | Indicador de foco |

Estas cores são uma base de desenho. Todas as combinações efectivamente utilizadas devem ser verificadas, incluindo transparências, estados desactivados e fundos dinâmicos. Um separador decorativo não deve ser usado como único limite de um controlo se não oferecer contraste suficiente.

Não utilizar verde e vermelho como único meio de comunicar resultados: associar sinal, texto e, quando adequado, ícone. Exemplo: «+2,35% · Subida».

### 3.2. Tipografia

Usar a fonte do sistema para integração natural em cada plataforma, sem descarregar ou distribuir fontes proprietárias.

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
  Helvetica, Arial, sans-serif;
```

| Estilo | Dimensão de referência | Peso | Utilização |
|---|---|---|---|
| Valor principal | 36–44 px | 600 | Valor da carteira |
| Título de página | 28–32 px | 600 | Nome da secção |
| Título de painel | 18–20 px | 600 | Grupos de informação |
| Corpo | 16 px | 400 | Conteúdo e formulários |
| Dados compactos | 14–15 px | 400–500 | Tabelas |
| Legenda | 13–14 px | 400 | Fonte, data e ajuda |

Implementar tamanhos em rem e layouts adaptáveis ao aumento de texto. Evitar pesos muito finos e mistura de várias famílias; a orientação da Apple privilegia legibilidade e uma hierarquia tipográfica consistente.

Para números financeiros, usar `font-variant-numeric: tabular-nums`. Não alterar a largura de cartões ou colunas quando os valores mudam.

### 3.3. Espaçamento e forma

- Escala de espaçamento: 4, 8, 12, 16, 24, 32, 40 e 48 px.
- Margens laterais: 16 px em telemóvel; 24 px em tablet; 32–40 px em desktop.
- Espaço interno dos cartões: 20–24 px; 16 px em ecrãs pequenos.
- Distância entre secções: 24–32 px.
- Raio de campos e botões: 12 px.
- Raio de cartões: 20 px.
- Raio de modais: 24 px.
- Etiquetas pequenas: formato cápsula apenas quando melhora a leitura.

Não transformar todas as superfícies em cápsulas nem colocar cartões dentro de cartões sem necessidade.

### 3.4. Elevação e materiais

- Cartões normais: fundo sólido, separador discreto e sombra quase imperceptível.
- Menus e popovers: elevação superior à dos cartões.
- Modais: fundo opaco e scrim escuro leve.
- Barra superior: translucidez opcional e moderada, com fundo alternativo opaco.

Reservar o efeito de vidro para navegação ou controlos flutuantes. Não aplicar transparência a tabelas, gráficos ou valores financeiros. A orientação Apple sobre materiais distingue a camada de controlos da camada de conteúdo e desaconselha Liquid Glass nesta última.

Não depender de blur para conseguir contraste. A versão sem blur deve permanecer visualmente completa.

## 4. Estrutura e navegação

### Desktop — a partir de 1200 px

- Barra lateral de cerca de 232 px.
- Barra superior com pesquisa, estado dos dados e menu do utilizador.
- Área principal com largura confortável e limite proposto de 1440 px.
- Conteúdo em grelha de 12 colunas.
- Menu lateral: Visão geral, Acompanhar, Carteira, Operações, Alertas e Definições.

### Tablet — de 768 a 1199 px

- Barra lateral recolhível.
- Grelha de duas colunas para cartões.
- Painéis de detalhe reposicionados abaixo do conteúdo principal quando necessário.
- Navegação sempre identificável, sem depender apenas de ícones.

### Telemóvel — abaixo de 768 px

- Conteúdo numa coluna.
- Navegação inferior com Visão geral, Acompanhar, Carteira e Alertas.
- Operações acessíveis na Carteira; Definições no menu do utilizador.
- Modais complexos passam a ecrãs completos ou folhas inferiores acessíveis.
- Respeitar áreas seguras do dispositivo e reservar espaço para a navegação fixa.
- Evitar scroll horizontal da página; tabelas podem ter região de scroll própria devidamente identificada.

Os breakpoints são propostas de implementação. Ajustar ao conteúdo e testar também larguras intermédias, não apenas modelos de dispositivos.

## 5. Descrição dos ecrãs

### 5.1. Autenticação

Apresentar um formulário simples, centrado numa superfície limpa, com identificação da aplicação e a mensagem «Acompanha o mercado. Aprende com uma carteira virtual.»

- Campos com rótulos persistentes.
- Mostrar/ocultar palavra-passe com nome acessível.
- Permitir gestores de palavras-passe e colagem.
- Acção principal «Entrar».
- Erros junto aos campos e resumo acessível quando necessário.
- Não incluir registo público ou recuperação de conta como funcionalidades existentes sem implementação aprovada.

### 5.2. Visão geral

Hierarquia proposta:

1. Título e indicação discreta «Ambiente de simulação».
2. Cartão principal com valor da carteira e referência temporal da valorização.
3. Resumo: saldo virtual, montante investido e resultado acumulado.
4. Lista de instrumentos acompanhados, com fecho e variação diária.
5. Operações recentes e alertas activos.

Evitar chamar «rentabilidade» a um valor cujo método de cálculo ainda não foi definido. Cada resultado deve ter descrição clara do período e da base de cálculo.

Não apresentar um gráfico de evolução da carteira antes de existir uma série histórica coerente que considere movimentos de saldo e operações. Até lá, usar resumo e histórico de operações.

### 5.3. Acompanhamento e detalhe de instrumento

- Pesquisa por designação, ticker e mercado.
- Acções «Adicionar instrumento» (símbolo Yahoo, ex.: `GALP.LS`) e «Importar Excel», com modelo descarregável e pré-visualização das linhas válidas, duplicadas e com erro antes de gravar.
- Estados do instrumento: «A validar», «Activo» e «Inválido» (com o motivo, ex.: «Não está cotado em EUR»).
- Ticker em destaque, com nome, mercado e moeda próximos.
- Fecho diário, variação e data da sessão sempre visíveis.
- Gráfico principal com selecção «1M», «3M», «6M», «1A» e «2A».
- Indicação «Dados diários» junto ao selector de período.
- Acções «Adicionar à lista», «Criar alerta» e «Simular operação».
- Disponibilizar resumo textual e acesso aos dados do gráfico em tabela.

Não disponibilizar filtros «Hoje», «1H» ou «Ao vivo». Não animar pontos como se fossem actualizados em tempo real. Se a cobertura for inferior a dois anos, indicar o período efectivamente disponível.

### 5.4. Carteira virtual

- Valor total, saldo disponível e resultados claramente separados.
- Tabela de posições com instrumento, quantidade, custo médio, preço de referência, valor e resultado.
- Valores numéricos alinhados à direita.
- Instrumento e mercado identificados sem ambiguidade.
- Acção «Simular compra» em destaque moderado.
- Compra e venda com igual clareza; não usar estímulos visuais para incentivar operações frequentes.

### 5.5. Simular compra ou venda

Formulário apresentado num modal em desktop e numa vista ampla em telemóvel.

Conteúdo obrigatório:

- Título «Simular compra» ou «Simular venda».
- Instrumento e moeda.
- Quantidade e validação de valores permitidos.
- Último fecho disponível e data correspondente.
- Total calculado e saldo/quantidade após a operação, identificados como pré-visualização.
- Mensagem «Esta operação é virtual e não é enviada para a bolsa.»
- Botão «Confirmar compra simulada» ou «Confirmar venda simulada».

O servidor valida novamente preço e saldo. Se houver mudança relevante face à pré-visualização, actualizar o resumo e pedir nova confirmação em vez de concluir silenciosamente.

Após sucesso, mostrar um recibo simples com preço efectivamente aplicado, quantidade, total e referência da operação. Não usar confettis, sons de jackpot ou contadores de urgência.

### 5.6. Operações

- Lista cronológica com filtros de instrumento, tipo e período.
- Etiqueta textual «Compra simulada» ou «Venda simulada».
- Separar instante do pedido e data da cotação usada.
- Detalhe de cada operação disponível sem depender de hover.
- Manter valores históricos tal como registados, sem os substituir pelo preço actual.

### 5.7. Alertas

- Listagem com instrumento, condição, estado e último envio.
- Interruptor acessível para activar/desactivar.
- Formulário simples com pré-visualização da condição em linguagem natural.
- Texto «Os alertas disparados são enviados num único email de resumo, após a actualização diária das cotações.»
- Ajuda «As condições são avaliadas com cotações diárias, não em tempo real.»
- Distinguir «Activo», «Pausado», «A aguardar dados» e «Falha de envio» apenas quando existirem estados correspondentes no backend.

Exemplo: «Avisar quando o fecho diário de [instrumento] for superior a 150,00 €.»

### 5.8. Definições

- Aparência: Claro, Escuro ou Sistema.
- Preferências de apresentação e informação de conta efectivamente suportadas.
- Explicação das regras da simulação e das limitações dos dados.
- Estado ou data de actualização dos dados, quando disponível.

Não introduzir ecrãs para funcionalidades futuras como se estivessem operacionais.

## 6. Componentes e estados

### Botões

- Primário: fundo accent, uma acção principal por contexto.
- Secundário: superfície neutra e contorno perceptível.
- Terciário: texto ou ícone com rótulo acessível.
- Destrutivo: reservado a acções irreversíveis reais, como apagar uma regra, não à simples venda simulada.
- Altura preferencial mínima de 44 px para interacções frequentes.
- Estado de carregamento preserva a largura e impede submissões repetidas.

### Campos

- Rótulo visível e persistente; placeholder apenas como exemplo.
- Altura de referência de 48 px e fonte de 16 px.
- Estado de erro com texto e associação programática ao campo.
- Validar formato durante a edição sem interromper cada tecla.
- Preservar os valores quando ocorre um erro de rede.

### Tabelas

- Cabeçalhos claros e ordenação anunciada a tecnologias de apoio.
- Linhas com espaço suficiente, sem grelhas pesadas.
- Acções acessíveis por teclado e toque, não apenas em hover.
- Em mobile, mostrar colunas prioritárias ou resumo em cartões sem esconder dados essenciais.

### Modais, menus e notificações

- Gerir foco inicial, manter foco no modal e devolvê-lo ao elemento de origem ao fechar.
- Escape fecha quando não existir impedimento fundamentado.
- Confirmar abandono se houver dados relevantes não guardados.
- Toasts apenas para feedback secundário; erros críticos e confirmações financeiras permanecem visíveis no contexto.
- Nunca depender de um aviso que desaparece rapidamente para comunicar uma falha de operação.

### Estados obrigatórios

Para cada ecrã, desenhar: inicial, carregamento, sucesso, vazio, erro, dados parciais e dados desactualizados.

- Skeletons reservam o espaço final e evitam saltos de layout.
- Lista vazia explica o passo seguinte sem usar valores fictícios.
- Dados antigos permanecem identificados como tal; não os apresentar como novos.
- Actualizações em segundo plano não repõem toda a página em carregamento.

## 7. Gráficos e apresentação financeira

- Linha principal azul, com preenchimento suave opcional.
- Grelha discreta e eixos legíveis.
- Tooltips com data, valor e moeda, acessíveis por toque e por alternativa de teclado/tabela.
- Não depender apenas de cor para distinguir séries.
- Não ligar artificialmente lacunas significativas sem indicação.
- Identificar a escala e evitar cortes de eixo que exagerem movimentos sem contexto.
- Usar formato português: «12 345,67 €» e datas como «16 out. 2026».
- Formatar moedas através de `Intl.NumberFormat('pt-PT', ...)`.
- Mostrar códigos de moeda quando o símbolo for ambíguo.
- Distinguir data da sessão, instante de recolha e instante da operação.

Os exemplos de números usados em protótipos devem ser identificados como dados de demonstração e não permanecer como valores reais na aplicação publicada.

## 8. Movimento e fluidez

| Interacção | Duração proposta | Comportamento |
|---|---|---|
| Hover e foco | 100–140 ms | Cor, contorno ou sombra discreta |
| Botão pressionado | 80–120 ms | Feedback local, sem deslocar o layout |
| Menu/popover | 140–180 ms | Opacidade e deslocação curta |
| Modal/folha | 180–240 ms | Entrada subtil, sem ressalto excessivo |
| Mudança de conteúdo | 150–200 ms | Transição curta, preservando contexto |

Priorizar opacidade e transformações. Evitar animar dimensões, blur de grandes áreas, fundos contínuos, parallax e contadores financeiros a deslizar.

O movimento deve apoiar a compreensão, não atrasar as tarefas. Respeitar `prefers-reduced-motion` e remover movimento não essencial; a Apple recomenda movimento intencional e possibilidade de o reduzir.

Objectivo de fluidez: não bloquear escrita, scroll ou foco durante actualizações. Medir a experiência nos dispositivos de referência; não prometer uma taxa fixa de fotogramas sem validação.

## 9. Acessibilidade

Objectivo de implementação: WCAG 2.2 nível AA, sujeito a testes automáticos e manuais, sem alegar conformidade apenas pela escolha das cores.

- Contraste mínimo de 4,5:1 para texto normal e 3:1 para texto grande, segundo os critérios WCAG.
- Contraste de 3:1 nos elementos não textuais essenciais sujeitos ao critério aplicável.
- Foco visível e não oculto por barras fixas.
- Navegação completa por teclado e ligação para saltar para o conteúdo.
- HTML semântico e nomes acessíveis para controlos.
- Zoom e aumento de texto sem perda de funções.
- Alternativa textual para gráficos e dados financeiros.
- Respeitar movimento reduzido e oferecer superfícies opacas para a aparência sem transparência.
- Não bloquear colagem ou gestores de palavras-passe.

As WCAG 2.2 AA definem um mínimo de 24 × 24 CSS px para alvos de ponteiro, com excepções e regras de espaçamento. Neste projecto adopta-se preferencialmente 44 × 44 px para controlos frequentes, como escolha de conforto, não como mínimo AA obrigatório.

Testar pelo menos com teclado, VoiceOver/Safari e NVDA/Firefox ou combinação equivalente disponível. A preferência por transparência reduzida pode ser oferecida na aplicação, sem depender de suporte uniforme de uma media query no navegador.

## 10. Tokens CSS de referência

```css
:root {
  color-scheme: light;
  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    Helvetica, Arial, sans-serif;
  --bg: #f5f5f7;
  --surface: #ffffff;
  --surface-muted: #eceef2;
  --text: #1d1d1f;
  --text-secondary: #555963;
  --accent: #005fcc;
  --on-accent: #ffffff;
  --positive: #166534;
  --negative: #b42318;
  --warning: #854d0e;
  --border: #dadde3;
  --control-border: #737985;
  --focus: #005fcc;
  --radius-control: 0.75rem;
  --radius-card: 1.25rem;
  --radius-modal: 1.5rem;
  --shadow-card: 0 4px 20px rgb(0 0 0 / 0.04);
  --shadow-overlay: 0 16px 48px rgb(0 0 0 / 0.14);
  --duration-fast: 120ms;
  --duration-normal: 180ms;
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #101114;
  --surface: #1c1d22;
  --surface-muted: #25272e;
  --text: #f5f5f7;
  --text-secondary: #b6bac5;
  --accent: #99c7ff;
  --on-accent: #101114;
  --positive: #86efac;
  --negative: #fda29b;
  --warning: #fde68a;
  --border: #363a45;
  --control-border: #8c93a3;
  --focus: #99c7ff;
  --shadow-card: 0 4px 20px rgb(0 0 0 / 0.14);
  --shadow-overlay: 0 16px 48px rgb(0 0 0 / 0.4);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--font-ui);
  font-size: 1rem;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
}

button, input, select, textarea { font: inherit; }

.financial-value { font-variant-numeric: tabular-nums; }

.card {
  min-width: 0;
  padding: 1.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-card);
}

.button-primary {
  min-height: 2.75rem;
  min-width: 2.75rem;
  padding: 0.625rem 1rem;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  color: var(--on-accent);
  background: var(--accent);
  cursor: pointer;
  transition: box-shadow var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.button-primary:disabled { cursor: not-allowed; }

:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 3px;
}

.app-motion {
  transition: opacity var(--duration-normal) var(--ease-out),
    transform var(--duration-normal) var(--ease-out);
}

/* Aplicar esta classe apenas a animacoes nao essenciais. */
@media (prefers-reduced-motion: reduce) {
  .app-motion {
    animation: none;
    transition: none;
    transform: none;
  }
  .button-primary { transition: none; }
  html { scroll-behavior: auto; }
}
```

O tema «Sistema» deve resolver o atributo `data-theme` através de `prefers-color-scheme`, respeitar a escolha explícita do utilizador e evitar flashes de tema no carregamento. Estes estilos são uma base; não constituem por si só uma biblioteca completa de componentes acessíveis.

## 11. Organização React proposta

```text
src/
  app/             # rotas, layout e configuracao global
  components/
    ui/            # Button, Input, Dialog, Tabs, Tooltip
    layout/        # Sidebar, Topbar, MobileNavigation
    finance/       # MoneyValue, QuoteDate, PriceChange, DailyChart
    feedback/      # EmptyState, ErrorState, Skeleton, DataStatus
  features/
    auth/
    overview/
    watchlist/
    instruments/
    portfolio/
    trades/
    alerts/
    settings/
  styles/
    tokens.css
    global.css
```

- Criar componentes reutilizáveis com estados documentados.
- Usar primitivas acessíveis para modais, menus e selecção, validando o resultado final.
- Separar dados remotos e estado de apresentação.
- Conservar filtros no URL quando fizer sentido.
- Adiar o carregamento de gráficos pesados e evitar reconstruções desnecessárias.
- Não efectuar alterações optimistas no saldo como se a operação estivesse confirmada antes da resposta do servidor.
- Evitar polling frequente quando só existem dados diários.

## 12. Critérios de aceitação visual e funcional

- [ ] Aspecto consistente em todos os ecrãs, com os mesmos tokens e componentes.
- [ ] Tema claro, escuro e sistema sem perda de contraste.
- [ ] Uma hierarquia visual clara e uma acção principal por contexto.
- [ ] Layout funcional a partir de 320 CSS px, sem scroll horizontal global.
- [ ] Datas, moedas e valores formatados de forma consistente em pt-PT.
- [ ] Cotação diária e respectiva data sempre identificadas.
- [ ] Operações e saldos claramente assinalados como virtuais.
- [ ] Confirmação de operações preserva contexto e apresenta os valores aplicados.
- [ ] Alertas explicam o envio em resumo e a base diária dos dados.
- [ ] Estados vazios, erro, carregamento e desactualização desenhados e implementados.
- [ ] Utilização completa por teclado e foco visível.
- [ ] Gráficos com alternativa de consulta dos dados.
- [ ] Movimento reduzido respeitado.
- [ ] Testes com zoom, leitor de ecrã e dispositivos móveis realizados.
- [ ] Sem efeitos de vidro sobre tabelas ou dados financeiros.
- [ ] Sem linguagem «ao vivo», incentivos de casino ou animações decorativas intrusivas.

## 13. Briefing resumido para implementação

> Criar uma interface React premium, serena e fluida para uma plataforma de simulação e acompanhamento de acções. Inspirar-se na clareza e contenção das interfaces Apple sem copiar a marca. Usar tipografia de sistema, grelha consistente, superfícies sólidas, espaços generosos, cantos suaves, sombras discretas e azul como destaque. Disponibilizar temas claro, escuro e sistema. Reservar translucidez para navegação, nunca para os dados. Desenhar Visão geral, Acompanhamento, Detalhe do instrumento, Carteira, Operações, Alertas e Definições. Mostrar sempre a natureza virtual das operações e a data das cotações diárias. Suportar histórico de dois anos e explicar que os alertas chegam num email de resumo após a actualização diária. Priorizar acessibilidade, navegação por teclado, movimento reduzido, estados de erro e clareza financeira. A experiência deve transmitir confiança e qualidade sem sugerir dados em tempo real nem execução real de ordens.
