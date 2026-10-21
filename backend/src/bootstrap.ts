import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { z } from 'zod';
import * as argon2 from 'argon2';
import { Database, audit } from './db';
import { text, validate } from './validation';
async function hidden(prompt: string): Promise<string> {
  if (!stdin.isTTY)
    throw new Error('Use um terminal interativo para informar a senha');
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\u0003') {
          cleanup();
          reject(new Error('Cancelado'));
          return;
        }
        if (ch === '\r' || ch === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    stdin.on('data', onData);
  });
}
async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const username = await rl.question(
    'Login individual do primeiro responsável: ',
  );
  const name = await rl.question('Nome: ');
  rl.close();
  const password = await hidden(
    'Senha (mínimo 12 caracteres, não será exibida): ',
  );
  const confirm = await hidden('Confirme a senha: ');
  const data = validate(
    z.object({
      username: z.string().regex(/^[a-z0-9._-]{3,100}$/),
      name: text,
      password: z.string().min(12).max(128),
    }),
    { username, name, password },
  );
  if (password !== confirm) throw new Error('Senhas diferentes');
  const hash = await argon2.hash(data.password, { type: argon2.argon2id });
  const db = new Database();
  try {
    await db.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(742106)');
      if ((await c.query('SELECT id FROM employees LIMIT 1')).rowCount)
        throw new Error(
          'Já existem funcionários; use a administração de contas',
        );
      const employee = (
        await c.query(
          'INSERT INTO employees(username,name,password_hash,manages_accounts) VALUES($1,$2,$3,true) RETURNING id',
          [data.username, data.name, hash],
        )
      ).rows[0];
      await audit(
        c,
        employee.id,
        'primeiro_responsavel',
        'funcionario',
        employee.id,
        { username: data.username, name: data.name },
      );
    });
    console.log('Responsável criado. Entre com seu login individual.');
  } finally {
    await db.onModuleDestroy();
  }
}
main().catch(() => {
  console.error(
    'Não foi possível criar o responsável. Confira entradas, banco e migrações; nenhuma senha é registrada.',
  );
  process.exitCode = 1;
});
