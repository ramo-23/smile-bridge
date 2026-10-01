import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProviderEntity } from '../../providers/entities/provider.entity';

@Entity({ name: 'working_hours' })
@Check('working_hours_weekday_check', 'weekday BETWEEN 0 AND 6')
@Check('working_hours_check', 'end_time > start_time')
export class WorkingHourEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => ProviderEntity, { nullable: false })
  @JoinColumn({ name: 'provider_id' })
  provider!: ProviderEntity;

  @Column('smallint')
  weekday!: number;

  @Column('time')
  start_time!: string;

  @Column('time')
  end_time!: string;
}