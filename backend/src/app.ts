import { InvoiceController } from './invoices/controller';
import { InvoiceService } from './invoices/service';
import { InvoiceStorage } from './invoices/storage';
import { requestDiagnostics } from './diagnostics';
import { SafeErrors } from './http-errors';
import 'reflect-metadata';
import {
  Global,
  Module,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import { json } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Database } from './db';
import { ProductService } from './products';
import {
  IntegrationController,
  IntegrationGuard,
  IntegrationService,
  isIntegrationRequest,
} from './integration';
import {
  AuthController,
  AuthService,
  EmployeesController,
  SessionGuard,
} from './auth';
import { StockService } from './stock';
import { StockController } from './api';
import { CatalogController } from './catalog';
import { ImportController, ImportService } from './imports';
@Global()
@Module({
  providers: [Database, SessionGuard],
  exports: [Database, SessionGuard],
})
class DatabaseModule {}
@Module({
  controllers: [AuthController, EmployeesController],
  providers: [AuthService],
})
class AuthModule {}
@Module({
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
class StockModule {}
@Module({
  controllers: [CatalogController],
  providers: [ProductService],
  exports: [ProductService],
})
class CatalogModule {}
@Module({ controllers: [ImportController], providers: [ImportService] })
class ImportModule {}
@Module({
  imports: [StockModule, CatalogModule],
  controllers: [IntegrationController],
  providers: [IntegrationService, IntegrationGuard],
})
class IntegrationModule {}
@Module({imports:[CatalogModule],controllers:[InvoiceController],providers:[InvoiceService,InvoiceStorage]})
class InvoiceModule {}
@Module({
  imports: [
    InvoiceModule,
    DatabaseModule,
    AuthModule,
    StockModule,
    CatalogModule,
    ImportModule,
    IntegrationModule,
  ],
})
class AppModule {}
export async function createApp() {
  const secret = process.env.SESSION_SECRET;
  const origin = process.env.PUBLIC_ORIGIN;
  const production = process.env.NODE_ENV === 'production';
  if (!secret || secret.length < 32 || !origin)
    throw new Error(
      'SESSION_SECRET com 32 caracteres e PUBLIC_ORIGIN obrigatórias',
    );
  const url = new URL(origin);
  if (url.origin !== origin || (production && url.protocol !== 'https:'))
    throw new Error('PUBLIC_ORIGIN inválida');
  const app = await NestFactory.create(AppModule, {
    logger: false,
    bodyParser: false,
  });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new SafeErrors());
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  if (production) express.set('trust proxy', 1);
  app.use(requestDiagnostics);
  app.use(helmet());
  app.use(json({ limit: '12mb', strict: true }));
  const Store = connectPgSimple(session);
  const store = new Store({
    pool: app.get(Database).pool,
    tableName: 'sessions',
    createTableIfMissing: false,
    pruneSessionInterval: false,
  });
  const sessionMiddleware = session({
    store,
    secret,
    name: production ? '__Host-graal.sid' : 'graal.sid',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: production,
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000,
    },
  });
  // Rotas entre serviços não leem, criam ou autenticam cookies pessoais.
  app.use((req: Request, res: Response, next: NextFunction) =>
    isIntegrationRequest(req) ? next() : sessionMiddleware(req, res, next),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (
      !isIntegrationRequest(req) &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    ) {
      const token = req.headers['x-csrf-token'];
      const expected = req.session.csrf;
      if (
        req.headers.origin !== origin ||
        typeof token !== 'string' ||
        !expected ||
        !/^[a-f0-9]{64}$/.test(token) ||
        token.length !== expected.length ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
      ) {
        res.status(403).json({ message: 'Proteção CSRF: recarregue a página' });
        return;
      }
    }
    next();
  });
  express.get('/api/health', async (_req: Request, res: Response) => {
    try {
      await app.get(Database).pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.enableShutdownHooks();
  return app;
}
