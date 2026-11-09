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
  SetMetadata,
  ConflictException,
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
        must_change_password: boolean;
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
        'SELECT id,name,username,manages_accounts,must_change_password,session_version::text FROM employees WHERE id=$1 AND active',
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
      must_change_password: employee.must_change_password,
    };
    if(employee.must_change_password && !Reflect.getMetadata('auth:initial-access',context.getHandler()))throw new ForbiddenException({message:'Troque a senha inicial antes de utilizar o sistema.',code:'PASSWORD_CHANGE_REQUIRED'});
    return true;
  }
}
@Injectable()
export class AuthService {
  private dummy = argon2.hash(randomBytes(32), { type: argon2.argon2id });
  constructor(private readonly db: Database) {}
  private attemptKey(value: string) {
    return createHmac('sha256', process.env.SESSION_SECRET!).update(value).digest('hex');
  }
  private async limitAttempts(key: string, limit: number) {
    const attempts = (await this.db.pool.query(
      `INSERT INTO login_attempts(key,count,expires) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN login_attempts.expires<now() THEN 1 ELSE login_attempts.count+1 END,expires=CASE WHEN login_attempts.expires<now() THEN now()+interval '15 minutes' ELSE login_attempts.expires END RETURNING count`,
      [key],
    )).rows[0].count;
    if (attempts > limit)
      throw new HttpException('Muitas tentativas; aguarde 15 minutos', 429);
  }
  async changePassword(id:string,version:string|undefined,body:unknown){
    const data = validate(z.object({
      password: z.string().min(12).max(128),
      confirmPassword: z.string().max(128),
      currentPassword: z.string().min(1).max(128).optional(),
    }).strict().refine(v => v.password === v.confirmPassword, 'Confirmação da senha divergente'), body);
    const row = (await this.db.pool.query(
      'SELECT active,must_change_password,password_hash,session_version::text FROM employees WHERE id=$1',
      [id],
    )).rows[0];
    if (!row?.active || row.session_version !== version)
      throw new UnauthorizedException('Sessão inválida. Entre novamente.');
    if (!row.must_change_password && !data.currentPassword)
      throw new ConflictException('Informe a senha atual para alterar sua senha.');
    const attemptKey = this.attemptKey(`password-change:${id}`);
    if (data.currentPassword) {
      await this.limitAttempts(attemptKey, 5);
      if (!(await argon2.verify(row.password_hash, data.currentPassword)))
        throw new UnauthorizedException('Senha atual incorreta');
    }
    const samePassword = data.currentPassword
      ? data.currentPassword === data.password
      : await argon2.verify(row.password_hash, data.password);
    if (samePassword)
      throw new HttpException('Escolha uma senha diferente da atual', 400);
    const hash = await argon2.hash(data.password, { type: argon2.argon2id });
    return this.db.transaction(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(742106)');
      const current = (await c.query(
        'SELECT active,session_version::text FROM employees WHERE id=$1 FOR UPDATE', [id],
      )).rows[0];
      if (!current?.active || current.session_version !== version)
        throw new UnauthorizedException('Sessão inválida. Entre novamente.');
      await c.query('UPDATE employees SET password_hash=$2,must_change_password=false,session_version=session_version+1 WHERE id=$1',[id,hash]);
      await c.query("DELETE FROM sessions WHERE sess->>'employeeId'=$1",[id]);
      await c.query('DELETE FROM login_attempts WHERE key=$1', [attemptKey]);
      await audit(c,id,row.must_change_password ? 'trocar_senha_inicial' : 'trocar_propria_senha','funcionario',id,{firstAccessCompleted:row.must_change_password,sessionsRevoked:true});
      return {ok:true,loginRequired:true};
    });
  }
  async login(username: string, password: string, ip: string) {
    const userKey = this.attemptKey(`user:${username.toLowerCase()}`);
    await this.limitAttempts(this.attemptKey(`ip:${ip}`), 30);
    await this.limitAttempts(userKey, 5);
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
      userKey,
    ]);
    return {
      id: employee.id,
      name: employee.name,
      username: employee.username,
      manages_accounts: employee.manages_accounts,
      must_change_password: employee.must_change_password,
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
  @SetMetadata('auth:initial-access',true)
  @UseGuards(SessionGuard) @Get('me') me(@Req() req: Request) {
    return req.employee;
  }
  @SetMetadata('auth:initial-access',true)
  @UseGuards(SessionGuard) @Post('change-password') async changePassword(@Req() req:Request,@Body() body:unknown,@Res({passthrough:true}) res:Response){
    const result=await this.auth.changePassword(req.employee!.id,req.session.employeeVersion,body);
    try{await new Promise<void>((resolve,reject)=>req.session.destroy(error=>error?reject(error):resolve()));}
    finally{res.clearCookie(process.env.NODE_ENV==='production'?'__Host-graal.sid':'graal.sid',{path:'/'});}
    return result;
  }
  @SetMetadata('auth:initial-access',true)
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
        'SELECT id,username,name,active,manages_accounts,must_change_password FROM employees ORDER BY name',
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
          mustChangePassword: z.boolean().optional(),
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
            'SELECT id FROM employees WHERE id=$1 AND active AND manages_accounts AND NOT must_change_password AND session_version::text=$2 FOR SHARE',
            [req.employee!.id,req.session.employeeVersion??null],
          )
        ).rowCount
      )
        throw new ForbiddenException('Permissão revogada');
      if (d.id && (!d.active || !d.managesAccounts)) {
        const managers = await c.query(
          'SELECT id FROM employees WHERE active AND manages_accounts AND NOT must_change_password',
        );
        if (managers.rows.length === 1 && managers.rows[0].id === d.id)
          throw new HttpException(
            'Preserve pelo menos um responsável ativo',
            409,
          );
      }
      const r = d.id
        ? await c.query(
            'UPDATE employees SET username=$2,name=$3,active=$4,manages_accounts=$5,password_hash=COALESCE($6,password_hash),must_change_password=COALESCE($7,must_change_password),session_version=session_version+1 WHERE id=$1 RETURNING id,must_change_password',
            [d.id, d.username, d.name, d.active, d.managesAccounts, hash, d.mustChangePassword ?? null],
          )
        : await c.query(
            'INSERT INTO employees(username,name,password_hash,active,manages_accounts,must_change_password) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,must_change_password',
            [d.username, d.name, hash, d.active, d.managesAccounts, d.mustChangePassword ?? false],
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
          mustChangePassword: r.rows[0].must_change_password,
        },
      );
      return { id: r.rows[0].id };
    });
  }
}
