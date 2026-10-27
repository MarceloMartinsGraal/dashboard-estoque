import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const databaseCode = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
    ? code
    : undefined;
};
const operation = (path: string) => {
  if (path.startsWith('/api/integration/')) return 'integracao';
  if (path.startsWith('/api/imports')) return 'importacao';
  if (
    path.startsWith('/api/movements') ||
    /^\/api\/products\/[^/]+\/(opening|balances)/.test(path)
  )
    return 'estoque';
  if (path.startsWith('/api/auth/') || path.startsWith('/api/employees'))
    return 'autenticacao';
  if (path === '/api/health') return 'health';
  return 'catalogo';
};
const category = (status: number) => {
  if (status === 503) return 'unavailable';
  if (status >= 500) return 'internal';
  if (status === 401) return 'authentication';
  if (status === 403) return 'authorization';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limit';
  return 'validation';
};
// Identificador gerado pelo servidor, compartilhado entre resposta e log.
// Nunca registrar URL, parâmetros, headers, corpo, mensagens SQL ou stack.
export function requestDiagnostics(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id',requestId);
  res.once('finish', () => {
    const status = res.statusCode;
    if (status < 400) return;
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      operation: operation(req.path),
      category: category(status),
      status,
      requestId,
      databaseCode: databaseCode({ code: res.locals.databaseCode }),
    });
    if (status >= 500) console.error(record);
    else console.warn(record);
  });
  next();
}
export function captureDatabaseCode(res: Response, error: unknown) {
  res.locals.databaseCode = databaseCode(error);
}
export function logProcessFailure(
  operation: 'startup' | 'migrate',
  error: unknown,
  missingConfiguration?: string[],
) {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      operation,
      category: 'process',
      databaseCode: databaseCode(error),
      missingConfiguration,
    }),
  );
}
