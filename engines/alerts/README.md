# Motor de alertas por email

Avalia as regras de alerta sobre o fecho diário e envia **um email de resumo por utilizador** com todos os alertas disparados. Corre a seguir à recolha diária das cotações.

## Regras

| Tipo | Limite | Quando dispara |
|---|---|---|
| `close_above` | EUR | O fecho passa a estar acima do limite. Não repete enquanto o fecho se mantiver acima; volta a disparar depois de descer e subir de novo |
| `close_below` | EUR | O fecho passa a estar abaixo do limite, com a mesma lógica |
| `change_up` | % | O fecho sobe pelo menos esse valor face à sessão anterior; avaliado em cada sessão |
| `change_down` | % | O fecho desce pelo menos esse valor face à sessão anterior; avaliado em cada sessão |

Cada regra é avaliada uma só vez por sessão. Os eventos têm uma chave única (regra, sessão), por isso o mesmo evento nunca é notificado duas vezes. Criar, editar ou reactivar uma regra na aplicação repõe o estado da avaliação.

## Envio

- **Resumo:** um email por utilizador e por execução, com todos os eventos ainda não notificados.
- **Intervalo mínimo:** nunca se envia a um utilizador que já recebeu um email nos últimos 60 minutos (`STOCKS_ALERT_MIN_INTERVAL_MINUTES`). Os eventos ficam para a execução seguinte.
- **Envio recusado** pelo servidor SMTP (`failed`): os eventos voltam a ficar pendentes e entram no resumo seguinte.
- **Ligação perdida** durante a transmissão da mensagem (`uncertain`): o email pode ter sido entregue, por isso não é reenviado. Um envio que fique em `sending`, porque o processo terminou a meio, passa a `uncertain` na execução seguinte.
- **Eventos antigos:** os eventos com mais de 7 dias (`STOCKS_ALERT_MAX_EVENT_AGE_DAYS`) já não são enviados, por exemplo depois de uma paragem prolongada.
- **Registo:** cada execução fica registada em `job_runs` e é visível na aplicação.

## Instalação

```bash
cd engines/alerts
python3 -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
```

Configuração por variáveis de ambiente:

| Variável | Descrição |
|---|---|
| `STOCKS_DB_*` | Igual ao motor de recolha |
| `STOCKS_SMTP_HOST`, `STOCKS_SMTP_PORT` | Servidor SMTP. A porta por omissão é 587, ou 465 com `ssl` |
| `STOCKS_SMTP_SECURITY` | `starttls` (omissão), `ssl` ou `none` |
| `STOCKS_SMTP_USER`, `STOCKS_SMTP_PASSWORD` | Credenciais, se o servidor as exigir |
| `STOCKS_SMTP_FROM` | Remetente, ex.: `Stocks <alertas@graus.pt>` |
| `STOCKS_PUBLIC_ORIGIN` | Endereço da aplicação, usado na ligação «Gerir alertas» |

Com domínio próprio, configure SPF e DKIM no fornecedor SMTP; sem isso, os emails tendem a ir para spam.

## Utilização

```bash
python -m alerts run --dry-run   # mostra os resumos no terminal; não envia nem grava nada
python -m alerts run             # avalia e envia
```

## Testes

```bash
STOCKS_TEST_DB_PASSWORD=... pytest   # base stocks_test; mailer simulado, nunca envia emails
```
