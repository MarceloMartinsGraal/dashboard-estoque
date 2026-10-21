import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes, createHmac } from 'node:crypto';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { Database, audit } from './db';
import { text, uuid, validate } from './validation';
declare module 'express-session' {
  interface SessionData {
    employeeId?: string;
    employeeVersion?: string;
    csrf?: string;
  }
}
declare global {
  namespace Express {
    interface Request {
      employee?: {
        id: string;
        name: string;
        username: string;
        manages_accounts: boolean;
      };
    }
  }
}
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly db: Database) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.session.employeeId)
      throw new UnauthorizedException('Autenticação necessária');
    const employee = (
      await this.db.pool.query(
        'SELECT id,name,username,manages_accounts,session_version::text FROM employees WHERE id=$1 AND active',
        [req.session.employeeId],
      )
    ).rows[0];
    if (!employee || employee.session_version !== req.session.employeeVersion)
      throw new UnauthorizedException('Sessão inválida');
    req.employee = {
      id: employee.id,
      name: employee.name,
      username: employee.username,
      manages_accounts: employee.manages_accounts,
    };
    return true;
  }
}
@Injectable()
export class AuthService {
  private dummy = argon2.hash(randomBytes(32), { type: argon2.argon2id });
  constructor(private readonly db: Database) {}
  async login(username: string, password: string, ip: string) {
    const key = (value: string) =>
      createHmac('sha256', process.env.SESSION_SECRET!)
        .update(value)
        .digest('hex');
    for (const [value, limit] of [
      [`ip:${ip}`, 30],
      [`user:${username.toLowerCase()}`, 5],
    ] as const) {
      const attempts = (
        await this.db.pool.query(
          `INSERT INTO login_attempts(key,count,expires) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN login_attempts.expires<now() THEN 1 ELSE login_attempts.count+1 END,expires=CASE WHEN login_attempts.expires<now() THEN now()+interval '15 minutes' ELSE login_attempts.expires END RETURNING count`,
          [key(value)],
        )
      ).rows[0].count;
      if (attempts > limit)
        throw new HttpException('Muitas tentativas; aguarde 15 minutos', 429);
    }
    const employee = (
      await this.db.pool.query('SELECT * FROM employees WHERE username=$1', [
        username.toLowerCase(),
      ])
    ).rows[0];
    const valid = await argon2
      .verify(employee?.password_hash ?? (await this.dummy), password)
      .catch(() => false);
    if (!employee || !valid || !employee.active)
      throw new UnauthorizedException('Credenciais inválidas');
    await this.db.pool.query('DELETE FROM login_attempts WHERE key=$1', [
      key(`user:${username.toLowerCase()}`),
    ]);
    return {
      id: employee.id,
      name: employee.name,
      username: employee.username,
      manages_accounts: employee.manages_accounts,
      sessionVersion: String(employee.session_version),
    };
  }
}
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Get('csrf') csrf(@Req() req: Request) {
    req.session.csrf ??= randomBytes(32).toString('hex');
    return { csrf: req.session.csrf };
  }
  @Post('login') async login(@Req() req: Request, @Body() body: unknown) {
    const data = validate(
      z
        .object({
          username: z.string().trim().min(1).max(100),
          password: z.string().min(1).max(128),
        })
        .strict(),
      body,
    );
    const employee = await this.auth.login(
      data.username,
      data.password,
      req.ip ?? 'unknown',
    );
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    req.session.employeeId = employee.id;
    req.session.employeeVersion = employee.sessionVersion;
    req.session.csrf = randomBytes(32).toString('hex');
    await new Promise<void>((resolve, reject) =>
      req.session.save((error) => (error ? reject(error) : resolve())),
    );
    const { sessionVersion, ...publicEmployee } = employee;
    return { employee: publicEmployee, csrf: req.session.csrf };
  }
  @UseGuards(SessionGuard) @Get('me') me(@Req() req: Request) {
    return req.employee;
  }
  @UseGuards(SessionGuard) @Post('logout') async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((error) => (error ? reject(error) : resolve())),
    );
    res.clearCookie(
      process.env.NODE_ENV === 'production' ? '__Host-graal.sid' : 'graal.sid',
      { path: '/' },
    );
    return { ok: true };
  }
}
@Controller('employees')
@UseGuards(SessionGuard)
export class EmployeesController {
  constructor(private readonly db: Database) {}
  @Get() async list(@Req() req: Request) {
    if (!req.employee!.manages_accounts)
      throw new ForbiddenException('Somente responsáveis administram contas');
    return (
      await this.db.pool.query(
        'SELECT id,username,name,active,manages_accounts FROM employees ORDER BY name',
      )
    ).rows;
  }
  @Post() async save(@Req() req: Request, @Body() body: unknown) {
    if (!req.employee!.manages_accounts)
      throw new ForbiddenException('Somente responsáveis administram contas');
    const d = validate(
      z
        .object({
          id: uuid.optional(),
          username: z.string().regex(/^[a-z0-9._-]{3,100}$/),
          name: text,
          password: z.string().min(12).max(128).optional(),
          active: z.boolean(),
          managesAccounts: z.boolean(),
        })
        .strict(),
      body,
    );
    if (!d.id && !d.password)
      throw new HttpException('Senha inicial obrigatória', 400);
    const hash = d.password
      ? await argon2.hash(d.password, { type: argon2.argon2id })
      : null;
    return this.db.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(742106)');
      if (
        !(
          await c.query(
            'SELECT id FROM employees WHERE id=$1 AND active AND manages_accounts FOR SHARE',
            [req.employee!.id],
          )
        ).rowCount
      )
        throw new ForbiddenException('Permissão revogada');
      if (d.id && (!d.active || !d.managesAccounts)) {
        const managers = await c.query(
          'SELECT id FROM employees WHERE active AND manages_accounts',
        );
        if (managers.rows.length === 1 && managers.rows[0].id === d.id)
          throw new HttpException(
            'Preserve pelo menos um responsável ativo',
            409,
          );
      }
      const r = d.id
        ? await c.query(
            'UPDATE employees SET username=$2,name=$3,active=$4,manages_accounts=$5,password_hash=COALESCE($6,password_hash),session_version=session_version+1 WHERE id=$1 RETURNING id',
            [d.id, d.username, d.name, d.active, d.managesAccounts, hash],
          )
        : await c.query(
            'INSERT INTO employees(username,name,password_hash,active,manages_accounts) VALUES($1,$2,$3,$4,$5) RETURNING id',
            [d.username, d.name, hash, d.active, d.managesAccounts],
          );
      if (!r.rowCount)
        throw new HttpException('Funcionário não encontrado', 404);
      if (d.id)
        await c.query("DELETE FROM sessions WHERE sess->>'employeeId'=$1", [
          d.id,
        ]);
      await audit(
        c,
        req.employee!.id,
        d.id ? 'editar' : 'criar',
        'funcionario',
        r.rows[0].id,
        {
          username: d.username,
          name: d.name,
          active: d.active,
          managesAccounts: d.managesAccounts,
          passwordChanged: !!hash,
        },
      );
      return r.rows[0];
    });
  }
}
