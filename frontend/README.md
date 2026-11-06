# Frontend

Interface React (Vite), segundo o [guia de estilos](../docs/arquitectura/guia_estilos.md). Usa TanStack Query para os dados remotos, React Router e Recharts, este último carregado só na página do instrumento.

## Desenvolvimento

```bash
cd frontend
npm ci
npm run dev        # http://127.0.0.1:5173; /api é encaminhado para a API em 127.0.0.1:3000
```

A API tem de estar a correr (`cd api && npm run dev`) e é preciso uma conta criada com `npm run cli -- create-user`.

## Produção

```bash
npm run build      # gera dist/
```

A API serve `dist/` quando `STOCKS_FRONTEND_DIST` aponta para essa pasta, na mesma origem que `/api`. Assim o cookie de sessão `SameSite=Strict` funciona sem CORS. Os ficheiros com hash ficam em cache durante um ano; o `index.html` nunca fica em cache.

## Testes

```bash
npm test           # node --test: cálculos do momento e da estratégia (shared/momentum.js, shared/strategy.js)
```

## Organização

```text
src/
  app/          rotas e protecção da sessão
  components/   ui (botões, campos, modal), layout, finance (valores, gráfico), feedback (estados, avisos)
  features/     uma pasta por ecrã: auth, overview, watchlist, instruments, heatmap, saxo, signals, alerts, users, settings
  lib/          cliente da API, consultas, formatação pt-PT e tema; momentum.js e strategy.js reexportam ../shared (partilhado com a API)
  styles/       tokens.css (cores e medidas do guia) e global.css
```

Princípios aplicados:
- Os valores monetários chegam da API como strings decimais e só passam a número para apresentação.
- Cada preço mostra a data da sessão. A conta SAXO aparece sempre como conta de simulação.
- Não há actualizações optimistas: a interface espera pela confirmação do servidor.
- Temas claro, escuro e «Sistema», sem flash no carregamento. O movimento reduzido é respeitado.
