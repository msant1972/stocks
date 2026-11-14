# Stocks — Plataforma de Simulação e Acompanhamento de Acções

Aplicação para acompanhar acções cotadas em EUR (Euronext, Xetra, Madrid, Helsínquia, Viena…), consultar o histórico diário (cinco anos guardados, dois mostrados), testar estratégias e receber alertas por email.

A carteira é a **conta de simulação (SIM) da SAXO Bank**: as ordens vão para essa conta (grupo «SAXO» do menu), com um passo de confirmação, e o valor da conta é guardado em cada sessão para o gráfico da evolução. Não há carteira virtual própria (foi retirada a 6 nov. 2026). A conta real da SAXO está bloqueada por omissão. A Automação pode enviar sozinha as ordens dos sinais das estratégias escolhidas, só na conta de simulação e desligada por omissão. Para já, a aplicação tem um só utilizador.

## Módulos

| Pasta | Módulo | Tecnologia |
|---|---|---|
| `frontend/` | Interface | React |
| `api/` | Middleware / API | Node.js |
| `shared/` | Cálculos partilhados pela interface e pela API: momento, estratégias (A-Momentum, B-Opus, C-AI, D-Reversão, E-Ondas, F-Mergulho, G a L e a carteira «Rotação» por momentum relativo), custos de negociação estimados e Promessas | JavaScript |
| `db/` | Esquema e migrações | MariaDB |
| `engines/fetcher/` | Motor de recolha de cotações | Python (yfinance) |
| `engines/alerts/` | Motor de alertas por email | Python |
| `scripts/` | Análises fora da aplicação (ex.: ablação da B-Opus) | Node.js |
| `e2e/` | Testes no navegador (Playwright) e capturas de ecrã de todas as páginas (`shots.mjs`) | Node.js |
| `deploy/` | Instalação no servidor: systemd, Caddy, MariaDB, fail2ban, SSH | Shell |

## Documentação

- [Arquitectura](docs/arquitectura/arquitectura.md)
- [Plano de implementação](docs/arquitectura/plano_implementacao.md)
- [Guia de estilos UI/UX](docs/arquitectura/guia_estilos.md)
- [Análise e decisões](docs/arquitectura/analise_e_decisoes.md)
- Especificações: [livro de ofertas](docs/arquitectura/orderbook-spec.md), [estratégia B-Opus](docs/arquitectura/B-Opus.md) (e [ablação](docs/arquitectura/b-opus-ablacao.md)), [estratégia C-AI](docs/arquitectura/C-AI.md), [estratégia D-Reversão](docs/arquitectura/D-Reversao.md), [estratégia E-Ondas](docs/arquitectura/E-Ondas.md), [estratégia F-Mergulho](docs/arquitectura/F-Mergulho.md), [rotação por momentum relativo](docs/arquitectura/Rotacao.md), [estratégias G a L](docs/arquitectura/Novas-estrategias.md), [Promessas](docs/arquitectura/promessas.md)

Módulos da interface, por grupo do menu:

- Visão geral
- **Mercado:** Acompanhar, Charts, Orderbook, HeatMap, Calor, Timelapse, Alertas
- **SAXO:** Carteira SAXO, Ordens SAXO, Alertas SAXO, Automação
- **Estratégias:** Sinais, BackTest, Comparar, WinnersLoosers, Promessas, Pechinchas, Laboratório (registo das experiências)
- **Administração:** Utilizadores (administradores), Definições (com os cartões Estratégias, Cópias de segurança e Correspondência SAXO, para administradores)

Todas as páginas usam a largura toda do ecrã (ver o [guia de estilos](docs/arquitectura/guia_estilos.md), secção 4).

usar o /model opusplan
