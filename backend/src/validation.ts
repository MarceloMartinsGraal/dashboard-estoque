import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'Identificador UUID inválido',
  );
export const text = z.string().trim().min(1).max(2000);
export const eventDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v &&
      v <= new Date().toISOString().slice(0, 10),
    'Data inválida ou futura',
  );
export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new BadRequestException(
      'Dados inválidos: ' +
        result.error.issues
          .map((i) => i.path.join('.') + ': ' + i.message)
          .join('; '),
    );
  return result.data;
}

export const pageFields = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};
