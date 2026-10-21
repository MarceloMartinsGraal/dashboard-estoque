import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { SessionGuard } from './auth';
import { Database } from './db';
import { StockService, openingSchema, movementSchema } from './stock';
import { eventDate, text, uuid, validate } from './validation';
@Controller()
@UseGuards(SessionGuard)
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly db: Database,
  ) {}
  @Get('products/:id/balances') balances(@Param('id') id: string) {
    return this.stock.balances(id);
  }
  @Post('products/:id/opening') opening(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const d = validate(openingSchema, body);
    return this.stock.opening(
      req.employee!.id,
      id,
      d.eventDate,
      d.counts,
      d.justification,
    );
  }
  @Post('movements') move(@Req() req: Request, @Body() body: unknown) {
    return this.stock.move(req.employee!.id, validate(movementSchema, body));
  }
  @Post('movements/:id/reverse') reverse(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const d = validate(
      z.object({ eventDate, justification: text }).strict(),
      body,
    );
    return this.stock.reverse(
      req.employee!.id,
      validate(uuid, id),
      d.eventDate,
      d.justification,
    );
  }
}
