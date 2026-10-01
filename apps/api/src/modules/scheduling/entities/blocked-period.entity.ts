import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProviderEntity } from '../../providers/entities/provider.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity({ name: 'blocked_periods' })
@Check('blocked_periods_during_check', 'NOT isempty(during)')
export class BlockedPeriodEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => ProviderEntity, { nullable: false })
  @JoinColumn({ name: 'provider_id' })
  provider!: ProviderEntity;

  @Column('tstzrange')
  during!: string;

  @Column('text', { nullable: true })
  reason!: string | null;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'created_by' })
  createdBy!: UserEntity;
}