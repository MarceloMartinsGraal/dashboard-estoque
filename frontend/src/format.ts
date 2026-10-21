const groups = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
/** API: texto decimal com ponto. Apenas apresentação; sem cálculos em ponto flutuante. */
export function quantity(
  value: string | number | bigint | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return '—';
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  return (
    match[1] +
    groups.format(BigInt(match[2])) +
    (fraction ? ',' + fraction : '')
  );
}
export function positive(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^\d+(\.\d+)?$/.test(value) &&
    /[1-9]/.test(value)
  );
}
export function eventDay(value: string | null | undefined): string {
  return value ? value.split('-').reverse().join('/') : '—';
}
export function label(value: string): string {
  return (
    (
      {
        entrada: 'Entrada',
        saida: 'Saída',
        ajuste_entrada: 'Ajuste de entrada',
        ajuste_saida: 'Ajuste de saída',
        realocacao: 'Realocação',
        abertura: 'Abertura',
        estorno: 'Estorno',
        uso_interno: 'Uso interno',
        chamado: 'Chamado',
        recebimento: 'Recebimento',
        rma: 'RMA',
        outro: 'Outro',
        correcao_estoque: 'Correção de estoque',
        contagem_fisica: 'Contagem física',
        legado_nao_informado: 'Legado não informado',
        operacional: 'Operacional',
        legado: 'Legado importado',
        todos: 'Todas as origens',
      } as Record<string, string>
    )[value] ?? value
  );
}

export function locationSummary(
  locations: Array<{
    code: string;
    name: string;
    active: boolean;
    delta: string | null;
  }>,
  flow: string,
): string {
  const name = (l: (typeof locations)[number]) =>
    l.code === 'NAO_INFORMADA'
      ? 'Localização não informada'
      : l.code + ' · ' + l.name + (l.active ? '' : ' (inativo)');
  if (flow !== 'realocacao') return locations.map(name).join(', ');
  const ordered = [...locations].sort(
    (a, b) =>
      Number(!a.delta?.startsWith('-')) - Number(!b.delta?.startsWith('-')),
  );
  return ordered
    .map((l) => (l.delta?.startsWith('-') ? 'Origem: ' : 'Destino: ') + name(l))
    .join(' → ');
}
