import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';

@Entity({ name: 'audit_log' })
@Index('audit_by_patient', { synchronize: false })
@Index('audit_by_user', { synchronize: false })
export class AuditLogEntity {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id!: string;

  @Column('timestamptz', { name: 'occurred_at', default: () => 'now()' })
  occurredAt!: Date;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity | null;

  @Column('text')
  action!: string;

  @Column('text', { name: 'entity_type' })
  entityType!: string;

  @Column('uuid', { name: 'entity_id', nullable: true })
  entityId!: string | null;

  @Column('uuid', { name: 'patient_id', nullable: true })
  patientId!: string | null;

  @Column('inet', { name: 'ip_address', nullable: true })
  ipAddress!: string | null;

  @Column('jsonb', { default: () => "'{}'" })
  metadata!: Record<string, unknown>;
}
