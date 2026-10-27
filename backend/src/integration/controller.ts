import { Body, Controller, Get, Param, Post, Query, Req, SetMetadata, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { IntegrationGuard } from './auth';
import { IntegrationService } from './service';
@Controller('integration/v1')
@UseGuards(IntegrationGuard)
export class IntegrationController {
    constructor(private readonly service: IntegrationService) { }
    @SetMetadata('integration:scope', 'read')
    @Get('product-options')
    productOptions() { return this.service.productOptions(); }
    @SetMetadata('integration:scope', 'read')
    @Get('product-matches')
    productMatches(
    @Query()
    q: unknown) { return this.service.matches(q); }
    @SetMetadata('integration:scope', 'read')
    @Get('products')
    products(
    @Query()
    q: unknown) {
        return this.service.search(q);
    }
    @SetMetadata('integration:scope', 'read')
    @Get('products/:id/balances')
    balances(
    @Param('id')
    id: string) {
        return this.service.balances(id);
    }
    @SetMetadata('integration:scope', 'read')
    @Get('locations')
    locations(
    @Query()
    q: unknown) {
        return this.service.locations(q);
    }
    @SetMetadata('integration:scope', 'read')
    @Get('products/:id/locations')
    productLocations(
    @Param('id')
    id: string, 
    @Query()
    q: unknown) {
        return this.service.locations(q, id);
    }
    @SetMetadata('integration:scope', 'movements:write')
    @Post('movements')
    move(
    @Req()
    req: Request, 
    @Body()
    body: unknown) {
        return this.service.move(req.integrationClient!, req.headers['idempotency-key'], body);
    }
    @SetMetadata('integration:scope', 'products:write')
    @Post('products')
    create(
    @Req()
    req: Request, 
    @Body()
    body: unknown) {
        return this.service.create(req.integrationClient!, req.headers['idempotency-key'], body);
    }
    @SetMetadata('integration:scope', 'read')
    @Get('operations/:key')
    result(
    @Req()
    req: Request, 
    @Param('key')
    key: string) {
        return this.service.result(req.integrationClient!, key);
    }
    @SetMetadata('integration:scope', 'read')
    @Get('tickets/:ticketId/movements')
    history(
    @Req()
    req: Request, 
    @Param('ticketId')
    ticketId: string, 
    @Query()
    q: unknown) {
        return this.service.history(req.integrationClient!, ticketId, q);
    }
}
