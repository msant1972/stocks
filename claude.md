# Stocks — Plataforma de Simulação e Acompanhamento de Acções

Aplicação para acompanhar acções da Euronext (EUR), consultar o histórico diário (três anos guardados, dois mostrados), gerir uma carteira virtual com operações simuladas e receber alertas por email.

A negociação é exclusivamente simulada: não há operações com dinheiro real nem integração com corretoras.

## Módulos

| Pasta | Módulo | Tecnologia |
|---|---|---|
| `frontend/` | Interface | React |
| `api/` | Middleware / API | Node.js |
| `db/` | Esquema e migrações | MariaDB |
| `engines/fetcher/` | Motor de recolha de cotações | Python (yfinance) |
| `engines/alerts/` | Motor de alertas por email | Python |

## Documentação

- [Arquitectura](docs/arquitectura/arquitectura.md)
- [Plano de implementação](docs/arquitectura/plano_implementacao.md)
- [Guia de estilos UI/UX](docs/arquitectura/guia_estilos.md)
- [Análise e decisões](docs/arquitectura/analise_e_decisoes.md)

usar o /model opusplan
