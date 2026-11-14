# Testes no navegador (Playwright)

Percorrem a aplicação inteira num Chromium sem interface: entrada com o 2.º factor, Visão geral, menu, Carteira SAXO,
ordens a partir dos Charts e dos Sinais, Timelapse, Laboratório, Comparar, Estratégias ligadas e desligadas, Charts (eixo à direita, cruz, medida, RSI14, Posições e cartões a pedido), «Vender Tudo», Definições, fotografia do utilizador e «Terminar sessão» com o botão direito, logotipos (com o CDN da Brandfetch simulado), limites de segurança da Automação, todas as páginas sem erros de JavaScript e a barra inferior em telemóvel (23 testes).

- `server.mjs` arranca a API real com o frontend compilado (`frontend/dist`) sobre a **base de dados de testes**
  (`STOCKS_TEST_DB_*` do `.env` na raiz; é apagada e recriada), com dados de exemplo e uma **SAXO falsa**
  (`fake-saxo.mjs`) dentro do processo. Nunca toca na base de produção nem na SAXO.
- `tests/app.spec.js` são os testes; correm em série, porque partilham o estado.

```sh
cd e2e
npm install
npx playwright install chromium   # uma vez; no Ubuntu 26.04 o Chromium precisa ainda de
                                  # libxdamage1 libasound2t64 libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64
set -a; . ../.env; set +a
npm test                          # compila o frontend, arranca o servidor na porta 3999 e corre os testes
```

`shots.mjs` tira capturas de ecrã de todas as páginas com o servidor já a correr (`node server.mjs` noutro terminal;
`node shots.mjs <pasta> [largura] [altura]`, `FULL=1` para a página inteira, `ONLY=/,/charts` para algumas), para rever a interface.

Não fazem parte do CI (precisam de um navegador e da base de testes). Correr antes de alterações grandes à interface.
