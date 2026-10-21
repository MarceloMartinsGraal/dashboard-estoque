import { BadRequestException } from '@nestjs/common';
const LIMIT = 9_000_000_000_000_000n;
export function parseQuantity(value: string, unit: string): bigint {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9]\d{0,12})(\.\d{1,3})?$/.test(value) ||
    unit !== 'unidade'
  )
    throw new BadRequestException('Quantidade inválida; use números inteiros.');
  const [integer, fraction = ''] = value.split('.');
  const result = BigInt(integer) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (
    result <= 0n ||
    result > LIMIT ||
    (unit === 'unidade' && result % 1000n !== 0n)
  )
    throw new BadRequestException(
      'Quantidade deve ser positiva e respeitar a unidade.',
    );
  return result;
}
export function formatQuantity(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const n = value < 0n ? -value : value;
  return `${sign}${n / 1000n}.${String(n % 1000n).padStart(3, '0')}`;
}
