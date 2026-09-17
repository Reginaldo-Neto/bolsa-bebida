import { loginRequestSchema, type LoginRequest } from '@bolsa/shared';
import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { zodPipe } from '../../common/zod.pipe';
import type { Env } from '../../config/env';
import {
  AuthService,
  STAFF_COOKIE,
  STAFF_SESSION_SECONDS,
  type StaffContext,
} from './auth.service';
import { StaffGuard, currentStaff, type RequestWithStaff } from './staff.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'Entrada de staff e admin, com TOTP para admin' })
  async login(
    @Body(zodPipe(loginRequestSchema)) body: LoginRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StaffContext> {
    const { staff, token } = await this.auth.login(body);

    void reply.setCookie(STAFF_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      signed: true,
      path: '/',
      maxAge: STAFF_SESSION_SECONDS,
    });

    return staff;
  }

  @Post('logout')
  @ApiOperation({ summary: 'Termina a sessao de staff' })
  logout(@Res({ passthrough: true }) reply: FastifyReply): { ok: true } {
    void reply.clearCookie(STAFF_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(StaffGuard)
  @ApiOperation({ summary: 'Devolve o utilizador de staff da sessao' })
  me(@Req() request: RequestWithStaff): StaffContext {
    return currentStaff(request);
  }
}
