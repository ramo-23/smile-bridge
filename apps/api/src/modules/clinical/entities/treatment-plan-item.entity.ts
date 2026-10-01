import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PlanStatus } from '../../../database/enums';
import { TreatmentTypeEntity } from '../../scheduling/entities/treatment-type.entity';
import { TreatmentPlanEntity } from './treatment-plan.entity';

@Entity({ name: 'treatment_plan_items' })
@Check('treatment_plan_items_tooth_number_check', 'tooth_number BETWEEN 1 AND 32')
@Check('treatment_plan_items_price_cents_check', 'price_cents >= 0')
export class TreatmentPlanItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => TreatmentPlanEntity, { nullable: false })
  @JoinColumn({ name: 'plan_id' })
  plan!: TreatmentPlanEntity;

  @ManyToOne(() => TreatmentTypeEntity, { nullable: false })
  @JoinColumn({ name: 'treatment_type_id' })
  treatmentType!: TreatmentTypeEntity;

  @Column('smallint', { name: 'tooth_number', nullable: true })
  toothNumber!: number | null;

  @Column('bytea', { nullable: true })
  description!: Buffer | null;

  @Column('bigint', { name: 'price_cents' })
  priceCents!: string;

  @Column('smallint', { default: 2 })
  priority!: number;

  @Column('enum', { enum: PlanStatus, enumName: 'plan_status', default: PlanStatus.Proposed })
  status!: PlanStatus;
}