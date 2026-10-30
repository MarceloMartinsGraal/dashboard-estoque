import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { captureDatabaseCode } from './diagnostics';
import { uuid } from './validation';
const codes: Record<number, string> = {
    400: 'INVALID_INPUT', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
    405: 'METHOD_NOT_ALLOWED', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 429: 'RATE_LIMITED',
    503: 'SERVICE_UNAVAILABLE',
};
const unavailable = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
    '08000', '08001', '08003', '08004', '08006', '08007', '08P01', '53300', '57P01', '57P02', '57P03']);
// Apenas dados de erro públicos conhecidos. Nunca copiar um erro/objeto de banco na resposta.
@Catch()
export class SafeErrors implements ExceptionFilter {
    catch(error: any, host: ArgumentsHost) {
        const res = host.switchToHttp().getResponse<Response>();
        captureDatabaseCode(res, error);
        let status = 500, message: string | string[] = 'Falha interna; tente novamente';
        let details: {
            code?: string;
            candidateIds?: string[];
            documentId?: string;
        } = {};
        if (error instanceof HttpException) {
            status = error.getStatus();
            const response = error.getResponse();
            message = typeof response === 'string' ? response : (response as {
                message: string | string[];
            }).message;
            if (status === 409 && typeof response === 'object' && 'code' in response && response.code === 'PRODUCT_CANDIDATES'
                && 'candidateIds' in response && Array.isArray(response.candidateIds)
                && response.candidateIds.every(id => uuid.safeParse(id).success)) {
                details = { code: 'PRODUCT_CANDIDATES', candidateIds: response.candidateIds };
            }
            if(status===409 && typeof response==='object' && 'code' in response && response.code==='INVOICE_DUPLICATE' && 'documentId' in response && uuid.safeParse(response.documentId).success)details={code:'INVOICE_DUPLICATE',documentId:response.documentId as string};
            if(status===403 && typeof response==='object' && 'code' in response && response.code==='PASSWORD_CHANGE_REQUIRED')details={code:'PASSWORD_CHANGE_REQUIRED'};
        }
        else if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
            status = error.type === 'entity.too.large' ? 413 : 400;
            message = 'JSON inválido ou limite de tamanho excedido';
        }
        else if (['23505', '23503', '23514', '22P02'].includes(error?.code)) {
            status = 409;
            message = 'Dados conflitantes ou referência inválida';
        }
        else if (unavailable.has(error?.code)) {
            status = 503;
            message = 'Dependência temporariamente indisponível; consulte o resultado antes de repetir operações';
            details = { code: 'DEPENDENCY_UNAVAILABLE' };
        }
        res.status(status).json({ statusCode: status, message, code: codes[status] ?? 'INTERNAL_ERROR',
            ...details, requestId: res.locals.requestId });
    }
}
