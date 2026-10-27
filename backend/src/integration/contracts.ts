import { z } from 'zod';
import { movementSchema } from '../stock';
import { productSchema } from '../products';
export type Client = {
    id: string;
    instance_id: string;
    scopes: string[];
    credentialHash: string;
};
export const keySchema = z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/);
export const externalId = z
    .string()
    .min(1)
    .max(200)
    .refine((v) => v === v.trim() && !/\p{Cc}/u.test(v), 'Identificador textual inválido');
export const moveSchema = movementSchema
    .omit({ ticket: true, justification: true, destinationId: true })
    .extend({
    kind: z.enum(['entrada', 'saida']),
    externalUserId: externalId,
    ticketId: externalId.max(100),
    observation: z.string().trim().max(2000).optional(),
})
    .strict();
export const createSchema = productSchema
    .omit({ id: true, locationId: true })
    .extend({ externalUserId: externalId })
    .strict();
