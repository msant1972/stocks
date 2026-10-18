/**
 * Administração de contas (não há registo público).
 *
 *   npm run cli -- create-user --email ana@exemplo.pt --name "Ana" [--admin] [--capital 1000000]
 *   npm run cli -- set-password --email ana@exemplo.pt
 *   npm run cli -- disable-user --email ana@exemplo.pt
 *   npm run cli -- enable-user --email ana@exemplo.pt
 *   npm run cli -- list-users
 *
 * A palavra-passe é pedida no terminal sem eco, ou lida de STOCKS_NEW_PASSWORD (para automatização).
 */
import { parseArgs } from 'node:util';
import readline from 'node:readline';
import { loadConfig } from './config.js';
import { audit, createPool, withTransaction } from './db.js';
import { destroyUserSessions } from './auth/sessions.js';
import { createUser, normaliseEmail, passwordError, setPassword } from './services/users.js';

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(prompt)) rl.output.write(prompt); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function readNewPassword() {
  if (process.env.STOCKS_NEW_PASSWORD) return process.env.STOCKS_NEW_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('defina STOCKS_NEW_PASSWORD ou corra num terminal interactivo');
  const first = await askHidden('Nova palavra-passe: ');
  const err = passwordError(first);
  if (err) throw new Error(err);
  if ((await askHidden('Repetir: ')) !== first) throw new Error('as palavras-passe não coincidem');
  return first;
}

async function findUser(pool, email) {
  const [[u]] = await pool.query('SELECT id FROM users WHERE email = ?', [normaliseEmail(email)]);
  if (!u) throw new Error(`utilizador ${email} não existe`);
  return Number(u.id);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      email: { type: 'string' }, name: { type: 'string' },
      admin: { type: 'boolean', default: false }, capital: { type: 'string' },
    },
  });
  const [command] = positionals;
  const cfg = loadConfig();
  const pool = createPool(cfg.db);
  try {
    switch (command) {
      case 'create-user': {
        if (!values.email || !values.name) throw new Error('indique --email e --name');
        const password = await readNewPassword();
        const id = await createUser(pool, {
          email: values.email, name: values.name, password, isAdmin: values.admin,
          initialCapital: values.capital ?? cfg.initialCapital,
        });
        console.log(`utilizador ${id} criado, com carteira de ${values.capital ?? cfg.initialCapital} EUR`);
        break;
      }
      case 'set-password': {
        const id = await findUser(pool, values.email ?? '');
        await setPassword(pool, id, await readNewPassword());
        console.log('palavra-passe alterada; as sessões abertas foram terminadas');
        break;
      }
      case 'disable-user':
      case 'enable-user': {
        const id = await findUser(pool, values.email ?? '');
        const disable = command === 'disable-user';
        await withTransaction(pool, async (conn) => {
          await conn.query(`UPDATE users SET disabled_at = ${disable ? 'NOW(3)' : 'NULL'} WHERE id = ?`, [id]);
          if (disable) await destroyUserSessions(conn, id);
          await audit(conn, null, disable ? 'user.disable' : 'user.enable', 'user', id);
        });
        console.log(disable ? 'utilizador desactivado' : 'utilizador reactivado');
        break;
      }
      case 'list-users': {
        const [rows] = await pool.query('SELECT id, email, name, is_admin, disabled_at FROM users ORDER BY id');
        for (const u of rows) {
          console.log(`${u.id}\t${u.email}\t${u.name}${u.is_admin ? '\t[admin]' : ''}${u.disabled_at ? '\t[desactivado]' : ''}`);
        }
        break;
      }
      default:
        throw new Error('comando desconhecido; use create-user, set-password, disable-user, enable-user ou list-users');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`erro: ${err.message}`);
  process.exit(1);
});
