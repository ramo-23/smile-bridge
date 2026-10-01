import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { SessionEntity } from './entities/session.entity';
import { UserEntity } from '../users/entities/user.entity';

const LOGIN_ERROR = 'Invalid email or password';
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60_000;

@Injectable()
export class AuthService {
  private readonly dummyHash = argon2.hash('smile-bridge-invalid-login-password', {
    type: argon2.argon2id,
  });

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  async login(
    email: string,
    password: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<{
    token: string;
    user: { id: string; name: string; role: UserEntity['role'] };
    expiresAt: Date;
  }> {
    const candidate = await this.users.findOne({ where: { email } });
    const encodedHash = candidate?.passwordHash ?? (await this.dummyHash);
    const passwordMatches = await argon2.verify(encodedHash, password).catch(() => false);
    const token = randomBytes(32).toString('base64url');

    const result = await this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(UserEntity);
      const current = candidate
        ? await userRepository.findOne({
            where: { id: candidate.id },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      const now = new Date();
      const accountLocked = !!current?.lockedUntil && current.lockedUntil.getTime() > now.getTime();
      const succeeds =
        !!current &&
        current.isActive &&
        !accountLocked &&
        passwordMatches &&
        current.passwordHash === candidate?.passwordHash;

      if (!succeeds) {
        let becameLocked = false;
        if (current?.isActive && !accountLocked) {
          current.failedLoginCount += 1;
          if (current.failedLoginCount >= LOCKOUT_THRESHOLD) {
            current.lockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
            becameLocked = true;
          }
          await userRepository.save(current);
        }
        await this.audit.record(
          {
            userId: current?.id ?? null,
            action: 'auth.login.failure',
            entityType: 'user',
            entityId: current?.id ?? null,
            patientId: null,
            ip,
            metadata: {},
          },
          manager,
        );
        if (becameLocked && current) {
          await this.audit.record(
            {
              userId: current.id,
              action: 'auth.account.lockout',
              entityType: 'user',
              entityId: current.id,
              patientId: null,
              ip,
              metadata: {},
            },
            manager,
          );
        }
        return null;
      }

      current.failedLoginCount = 0;
      current.lockedUntil = null;
      current.lastLoginAt = now;
      await userRepository.save(current);

      const session = await manager.getRepository(SessionEntity).save({
        userId: current.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(
          now.getTime() + this.config.get<number>('SESSION_ABSOLUTE_HOURS', 12) * 60 * 60_000,
        ),
        ipAddress: ip,
        userAgent,
      });
      await this.audit.record(
        {
          userId: current.id,
          action: 'auth.login.success',
          entityType: 'session',
          entityId: session.id,
          patientId: null,
          ip,
          metadata: {},
        },
        manager,
      );
      return {
        expiresAt: session.expiresAt,
        user: { id: current.id, name: current.fullName, role: current.role },
      };
    });

    if (!result) throw new UnauthorizedException(LOGIN_ERROR);
    return { token, ...result };
  }

  async logout(session: SessionEntity, userId: string, ip: string | null): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(SessionEntity)
        .update({ id: session.id, revokedAt: IsNull() }, { revokedAt: new Date() });
      await this.audit.record(
        {
          userId,
          action: 'auth.logout',
          entityType: 'session',
          entityId: session.id,
          patientId: null,
          ip,
          metadata: {},
        },
        manager,
      );
    });
  }
}
