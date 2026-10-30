import { integrationEnabled } from '../config';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Database } from '../db';
import { uuid } from '../validation';
import type { Client } from './contracts';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
declare global {
    namespace Express {
        interface Request {
            integrationClient?: Client;
        }
    }
}
const prefix = '/api/integration/v1';
export const isIntegrationRequest = (req: Request) => req.path === prefix || req.path.startsWith(prefix + '/');
export function enabled() {
    if (!integrationEnabled())
        throw new ServiceUnavailableException('Integração desabilitada');
}
@Injectable()
export class IntegrationGuard implements CanActivate {
    constructor(private readonly db: Database) { }
    async canActivate(context: ExecutionContext) {
        enabled();
        const req = context.switchToHttp().getRequest<Request>();
        const match = /^Bearer ([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(req.headers.authorization ?? '');
        if (!match || !uuid.safeParse(match[1]).success)
            throw new UnauthorizedException('Credencial de integração inválida');
        const row = (await this.db.pool.query('SELECT id,instance_id,scopes,token_hash FROM integration_clients WHERE id=$1 AND active AND expires_at>now()', [match[1]])).rows[0];
        if (!row ||
            !timingSafeEqual(Buffer.from(row.token_hash, 'hex'), Buffer.from(hash(match[2]), 'hex')))
            throw new UnauthorizedException('Credencial de integração inválida');
        const scope: string | undefined = Reflect.getMetadata('integration:scope', context.getHandler());
        if (!scope || !row.scopes.includes(scope))
            throw new ForbiddenException('Permissão de integração insuficiente');
        req.integrationClient = {
            id: row.id,
            instance_id: row.instance_id,
            scopes: row.scopes,
            credentialHash: row.token_hash,
        };
        return true;
    }
}
