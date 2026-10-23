import { foldText } from './search';
// Normalização apenas para comparação. Descrições persistidas permanecem intactas.
export function comparisonTokens(value: string): string[] {
  const normalized = foldText(value).replace(/(\d+)\s+(gb|tb|mb|mhz|ghz)\b/g, '$1$2');
  return [...new Set((normalized.match(/[a-z0-9]+/g) ?? []).filter(t => !['ram','de','da','do','para'].includes(t)))].sort();
}
export function compareProducts(a: string, b: string) {
  const left=comparisonTokens(a), right=comparisonTokens(b);
  const shared=left.filter(t=>right.includes(t)).length;
  const score=shared/Math.max(1,Math.min(left.length,right.length));
  const technical=(tokens:string[])=>tokens.filter(t=>/\d/.test(t)||['notebook','desktop','novo','usado','kit','avulsa','sodimm','dimm','sata','nvme'].includes(t)).join('|');
  return {similar:(shared>=2&&score>=0.5)||(left.length>0&&left.join('|')===right.join('|')), score, exact:left.join('|')===right.join('|'), technicalDifferences:technical(left)!==technical(right)};
}
