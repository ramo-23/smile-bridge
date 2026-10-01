import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { DataSource, IsNull, Repository } from 'typeorm';
import { UserRole } from '../../database/enums';
import { AuditService } from '../audit/audit.service';
import { SessionEntity } from '../auth/entities/session.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';

export type UserResponse = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  async create(dto: CreateUserDto, actorId: string, ip: string | null): Promise<UserResponse> {
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    try {
      return await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [734821]);
        const user = await manager.getRepository(UserEntity).save({
          email: dto.email,
          passwordHash,
          fullName: dto.name,
          role: dto.role,
          isActive: true,
        });
        await this.audit.record(
          {
            userId: actorId,
            action: 'user.create',
            entityType: 'user',
            entityId: user.id,
            patientId: null,
            ip,
            metadata: { role: user.role },
          },
          manager,
        );
        return this.toResponse(user);
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  async list(): Promise<UserResponse[]> {
    const users = await this.users.find({ order: { createdAt: 'ASC' } });
    return users.map((user) => this.toResponse(user));
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actorId: string,
    ip: string | null,
  ): Promise<UserResponse> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(UserEntity);
      const ownerSensitiveChange = dto.role !== undefined || dto.isActive === false;
      if (ownerSensitiveChange) {
        await manager.query(
          `SELECT id FROM users
           WHERE role = $1 AND is_active = true
           ORDER BY id
           FOR UPDATE`,
          [UserRole.DentistOwner],
        );
        const actingOwner = await repository.findOne({
          where: { id: actorId, role: UserRole.DentistOwner, isActive: true },
        });
        if (!actingOwner) {
          throw new BadRequestException(
            'An active dentist owner is required to change user access',
          );
        }
      }

      const user = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!user) throw new NotFoundException('User not found');

      const roleChanged = dto.role !== undefined && dto.role !== user.role;
      const activeChanged = dto.isActive !== undefined && dto.isActive !== user.isActive;
      if (
        actorId === id &&
        ((roleChanged && dto.role !== UserRole.DentistOwner) || dto.isActive === false)
      ) {
        throw new BadRequestException('You cannot demote or deactivate yourself');
      }

      const remainsActiveOwner =
        (dto.role ?? user.role) === UserRole.DentistOwner && (dto.isActive ?? user.isActive);
      if (user.isActive && user.role === UserRole.DentistOwner && !remainsActiveOwner) {
        const activeOwners = await repository.count({
          where: { role: UserRole.DentistOwner, isActive: true },
        });
        if (activeOwners <= 1)
          throw new BadRequestException('At least one active dentist owner is required');
      }

      if (dto.name !== undefined) user.fullName = dto.name;
      if (dto.role !== undefined) user.role = dto.role;
      if (dto.isActive !== undefined) user.isActive = dto.isActive;
      await repository.save(user);

      if (roleChanged) {
        await this.audit.record(
          {
            userId: actorId,
            action: 'user.role_change',
            entityType: 'user',
            entityId: user.id,
            patientId: null,
            ip,
            metadata: { role: user.role },
          },
          manager,
        );
      }
      if (activeChanged) {
        if (!user.isActive) {
          await manager
            .getRepository(SessionEntity)
            .update({ userId: user.id, revokedAt: IsNull() }, { revokedAt: new Date() });
        }
        await this.audit.record(
          {
            userId: actorId,
            action: user.isActive ? 'user.reactivate' : 'user.deactivate',
            entityType: 'user',
            entityId: user.id,
            patientId: null,
            ip,
            metadata: {},
          },
          manager,
        );
      }

      if (ownerSensitiveChange) {
        const [{ count }] = await manager.query(
          'SELECT COUNT(*)::int AS count FROM users WHERE role = $1 AND is_active = true',
          [UserRole.DentistOwner],
        );
        if (count < 1) {
          throw new BadRequestException('At least one active dentist owner is required');
        }
      }
      return this.toResponse(user);
    });
  }

  async resetPassword(
    id: string,
    password: string,
    actorId: string,
    ip: string | null,
  ): Promise<void> {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(UserEntity);
      const user = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!user) throw new NotFoundException('User not found');
      user.passwordHash = passwordHash;
      user.failedLoginCount = 0;
      user.lockedUntil = null;
      await repository.save(user);
      await manager
        .getRepository(SessionEntity)
        .update({ userId: user.id, revokedAt: IsNull() }, { revokedAt: new Date() });
      await this.audit.record(
        {
          userId: actorId,
          action: 'user.password_reset',
          entityType: 'user',
          entityId: user.id,
          patientId: null,
          ip,
          metadata: {},
        },
        manager,
      );
    });
  }

  private toResponse(user: UserEntity): UserResponse {
    return {
      id: user.id,
      email: user.email,
      name: user.fullName,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
    };
  }
}
