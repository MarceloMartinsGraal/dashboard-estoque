let csrf = '';
export async function api(path: string, body?: unknown): Promise<any> {
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers:
      body === undefined
        ? {}
        : { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response
    .json()
    .catch(() => ({ message: 'Resposta indisponível' }));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('auth/'))
      window.dispatchEvent(new CustomEvent('session-expired'));
    throw new Error(result.message ?? 'Não foi possível concluir a operação');
  }
  if (result.csrf) csrf = result.csrf;
  return result;
}
