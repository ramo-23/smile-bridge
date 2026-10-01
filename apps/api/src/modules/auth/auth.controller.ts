import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AuthenticatedRequest } from '../../common/guards/request-context';
import { SESSION_COOKIE } from '../../common/guards/authentication.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async login(
    @Req() request: Request,
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(
      body.email,
      body.password,
      request.ip ?? null,
      request.get('user-agent') ?? null,
    );
    response.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: this.config.get<boolean>('AUTH_COOKIE_SECURE', false),
      sameSite: 'strict',
      path: '/',
      expires: result.expiresAt,
    });
    return result.user;
  }

  @Post('logout')
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(request.authSession!, request.user!.id, request.ip ?? null);
    response.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: this.config.get<boolean>('AUTH_COOKIE_SECURE', false),
      sameSite: 'strict',
      path: '/',
    });
    return { success: true };
  }

  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    const { id, name, role } = request.user!;
    return { id, name, role };
  }
}
