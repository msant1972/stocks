# Stocks — Plataforma de Simulação e Acompanhamento de Acções

Aplicação para acompanhar acções da Euronext (EUR), consultar o histórico diário (três anos guardados, dois mostrados), gerir uma carteira virtual com operações simuladas e receber alertas por email.

A negociação é exclusivamente simulada: não há operações com dinheiro real nem integração com corretoras.

## Módulos

| Pasta | Módulo | Tecnologia |
|---|---|---|
| `frontend/` | Interface | React |
| `api/` | Middleware / API | Node.js |
| `shared/` | Cálculos partilhados pela interface e pela API: momento, estratégias (A-Momentum, B-Opus, C-AI) e Promessas | JavaScript |
| `db/` | Esquema e migrações | MariaDB |
| `engines/fetcher/` | Motor de recolha de cotações | Python (yfinance) |
| `engines/alerts/` | Motor de alertas por email | Python |
| `scripts/` | Análises fora da aplicação (ex.: ablação da B-Opus) | Node.js |

## Documentação

- [Arquitectura](docs/arquitectura/arquitectura.md)
- [Plano de implementação](docs/arquitectura/plano_implementacao.md)
- [Guia de estilos UI/UX](docs/arquitectura/guia_estilos.md)
- [Análise e decisões](docs/arquitectura/analise_e_decisoes.md)
- Especificações: [livro de ofertas](docs/arquitectura/orderbook-spec.md), [estratégia B-Opus](docs/arquitectura/B-Opus.md) (e [ablação](docs/arquitectura/b-opus-ablacao.md)), [estratégia C-AI](docs/arquitectura/C-AI.md), [Promessas](docs/arquitectura/promessas.md)

Módulos da interface: Visão geral, Acompanhar, Orderbook, HeatMap, Carteira, Operações, Sinais, BackTest, WinnersLoosers, Promessas, Alertas, Utilizadores (administradores) e Definições.

usar o /model opusplan
