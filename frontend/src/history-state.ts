export const historyFilterKeys = [
  'q',
  'productId',
  'categoryId',
  'subcategoryId',
  'locationId',
  'dateFrom',
  'dateTo',
  'reason',
  'employeeId',
  'ticket',
] as const;
export type HistoryState = {
  flow: string;
  regime: string;
  page: number;
  limit: number;
} & Record<(typeof historyFilterKeys)[number], string>;
export function readHistoryState(search: string): HistoryState {
  const p = new URLSearchParams(search);
  const flow = p.get('flow') ?? 'entrada',
    regime = p.get('regime') ?? 'todos';
  return {
    flow: ['entrada', 'saida', 'realocacao', 'abertura'].includes(flow)
      ? flow
      : 'entrada',
    regime: ['operacional', 'legado', 'todos'].includes(regime)
      ? regime
      : 'todos',
    page: Math.max(1, Math.min(100000, Math.floor(Number(p.get('page')) || 1))),
    limit: 50,
    ...Object.fromEntries(historyFilterKeys.map((k) => [k, p.get(k) ?? ''])),
  } as HistoryState;
}
export function historySearch(state: HistoryState): string {
  const p = new URLSearchParams({
    view: 'history',
    flow: state.flow,
    regime: state.regime,
    page: String(state.page),
  });
  for (const key of historyFilterKeys) if (state[key]) p.set(key, state[key]);
  return p.toString();
}
export function historyApiSearch(state: HistoryState): string {
  const p = new URLSearchParams(historySearch(state));
  p.delete('view');
  p.set('limit', String(state.limit));
  return p.toString();
}
