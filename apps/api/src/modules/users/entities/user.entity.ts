import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { UserRole } from '../../../database/enums';

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('citext', { unique: true })
  email!: string;

  @Column('text', { name: 'password_hash' })
  passwordHash!: string;

  @Column('text', { name: 'full_name' })
  fullName!: string;

  @Column('enum', { enum: UserRole, enumName: 'user_role' })
  role!: UserRole;

  @Column('boolean', { name: 'is_active', default: true })
  isActive!: boolean;

  @Column('integer', { name: 'failed_login_count', default: 0 })
  failedLoginCount!: number;

  @Column('timestamptz', { name: 'locked_until', nullable: true })
  lockedUntil!: Date | null;

  @Column('timestamptz', { name: 'last_login_at', nullable: true })
  lastLoginAt!: Date | null;

  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
}
