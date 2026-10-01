import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SessionEntity } from '../../modules/auth/entities/session.entity';
import { UserEntity } from '../../modules/users/entities/user.entity';
import { AuthenticatedRequest } from './request-context';

export const SESSION_COOKIE = 'smile_bridge_session';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    @InjectRepository(SessionEntity) private readonly sessions: Repository<SessionEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token) throw new UnauthorizedException();

    const session = await this.sessions.findOne({
      where: { tokenHash: createHash('sha256').update(token).digest('hex'), revokedAt: IsNull() },
    });
    if (!session) throw new UnauthorizedException();

    const now = Date.now();
    const idleLimit = this.config.get<number>('SESSION_IDLE_MINUTES', 30) * 60_000;
    if (session.expiresAt.getTime() <= now || session.lastSeenAt.getTime() + idleLimit <= now) {
      throw new UnauthorizedException();
    }

    const user = await this.users.findOne({ where: { id: session.userId, isActive: true } });
    if (!user) throw new UnauthorizedException();

    request.user = { id: user.id, name: user.fullName, role: user.role };
    request.authSession = session;

    const lastSeenCutoff = new Date(now - 60_000);
    if (session.lastSeenAt <= lastSeenCutoff) {
      await this.sessions
        .createQueryBuilder()
        .update(SessionEntity)
        .set({ lastSeenAt: new Date(now) })
        .where('id = :id AND last_seen_at <= :cutoff', { id: session.id, cutoff: lastSeenCutoff })
        .execute();
    }
    return true;
  }

  private readCookie(cookieHeader: string | undefined, name: string): string | null {
    const cookie = cookieHeader
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`));
    if (!cookie) return null;
    try {
      return decodeURIComponent(cookie.slice(name.length + 1)) || null;
    } catch {
      return null;
    }
  }
}
