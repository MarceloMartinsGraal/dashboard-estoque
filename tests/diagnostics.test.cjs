const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  requestDiagnostics,
  logProcessFailure,
} = require('../dist/backend/diagnostics');
function response(status) {
  const res = new EventEmitter();
  res.locals = {};
  res.statusCode = status;
  return res;
}
test('logs correlacionam falhas sem expor corpo, query, tokens, cookies ou IDs externos', () => {
  const warn = mock.method(console, 'warn', () => {}),
    error = mock.method(console, 'error', () => {});
  try {
    const cases = [
      ['/api/imports/secret-batch/confirm', 'importacao', 400, 'validation'],
      ['/api/movements/secret-movement/reverse', 'estoque', 409, 'conflict'],
      [
        '/api/integration/v1/operations/secret-key',
        'integracao',
        401,
        'authentication',
      ],
      ['/api/auth/login', 'autenticacao', 403, 'authorization'],
      ['/api/integration/v1/movements', 'integracao', 500, 'internal'],
    ];
    const ids = new Set();
    for (const [path, operation, status, category] of cases) {
      const req = {
        path,
        method: 'POST',
        url: path + '?token=private-query',
        headers: {
          authorization: 'Bearer private-token',
          cookie: 'private-cookie',
          'x-request-id': 'untrusted-id',
        },
        body: { password: 'private-password', externalUserId: 'private-user' },
      };
      const res = response(status);
      res.locals.databaseCode = '23514';
      let next = 0;
      requestDiagnostics(req, res, () => next++);
      assert.equal(next, 1);
      res.emit('finish');
      const fn = status >= 500 ? error : warn;
      const record = JSON.parse(fn.mock.calls.at(-1).arguments[0]);
      assert.equal(record.operation, operation);
      assert.equal(record.category, category);
      assert.equal(record.status, status);
      assert.equal(record.databaseCode, '23514');
      assert.match(record.requestId, /^[0-9a-f-]{36}$/);
      ids.add(record.requestId);
      assert.deepEqual(
        Object.keys(record).sort(),
        [
          'timestamp',
          'operation',
          'category',
          'status',
          'requestId',
          'databaseCode',
        ].sort(),
      );
      assert.equal(JSON.stringify(record).includes('private-'), false);
      assert.equal(JSON.stringify(record).includes('secret-'), false);
      assert.equal(JSON.stringify(record).includes('untrusted-id'), false);
    }
    assert.equal(ids.size, cases.length);
  } finally {
    warn.mock.restore();
    error.mock.restore();
  }
});
test('respostas de sucesso não geram log de falha; código não reconhecido não vaza', () => {
  const warn = mock.method(console, 'warn', () => {}),
    error = mock.method(console, 'error', () => {});
  try {
    const req = { path: '/api/products', method: 'GET' };
    let res = response(200);
    requestDiagnostics(req, res, () => {});
    res.emit('finish');
    assert.equal(warn.mock.callCount() + error.mock.callCount(), 0);
    res = response(404);
    res.locals.databaseCode = 'private-token';
    requestDiagnostics(req, res, () => {});
    res.emit('finish');
    const record = JSON.parse(warn.mock.calls[0].arguments[0]);
    assert.equal(record.databaseCode, undefined);
    assert.equal(record.category, 'not_found');
  } finally {
    warn.mock.restore();
    error.mock.restore();
  }
});
test('falhas de processo registram apenas contexto seguro e nomes de configuração ausente', () => {
  const error = mock.method(console, 'error', () => {});
  try {
    logProcessFailure(
      'startup',
      {
        message: 'postgresql://private-password@host',
        stack: 'private-cookie',
        code: 'private-token',
      },
      ['DATABASE_URL'],
    );
    const record = JSON.parse(error.mock.calls[0].arguments[0]);
    assert.equal(record.operation, 'startup');
    assert.deepEqual(record.missingConfiguration, ['DATABASE_URL']);
    assert.equal(JSON.stringify(record).includes('private-'), false);
  } finally {
    error.mock.restore();
  }
});
