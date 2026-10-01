import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ClaimStatus } from '../../../database/enums';
import { UserEntity } from '../../users/entities/user.entity';
import { ClaimEntity } from './claim.entity';

@Entity({ name: 'claim_status_history' })
export class ClaimStatusHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => ClaimEntity, { nullable: false })
  @JoinColumn({ name: 'claim_id' })
  claim!: ClaimEntity;

  @Column('enum', { name: 'from_status', enum: ClaimStatus, enumName: 'claim_status', nullable: true })
  fromStatus!: ClaimStatus | null;

  @Column('enum', { name: 'to_status', enum: ClaimStatus, enumName: 'claim_status' })
  toStatus!: ClaimStatus;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'changed_by' })
  changedBy!: UserEntity;

  @Column('timestamptz', { name: 'changed_at', default: () => 'now()' })
  changedAt!: Date;
}