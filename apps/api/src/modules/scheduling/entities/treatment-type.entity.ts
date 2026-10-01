import { Check, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'treatment_types' })
@Check('treatment_types_default_duration_minutes_check', 'default_duration_minutes > 0')
@Check('treatment_types_default_price_cents_check', 'default_price_cents >= 0')
export class TreatmentTypeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('text', { unique: true })
  name!: string;

  @Column('text', { name: 'procedure_code', nullable: true })
  procedureCode!: string | null;

  @Column('integer', { name: 'default_duration_minutes' })
  defaultDurationMinutes!: number;

  @Column('bigint', { name: 'default_price_cents' })
  defaultPriceCents!: string;

  @Column('boolean', { name: 'patient_bookable', default: false })
  patientBookable!: boolean;

  @Column('boolean', { name: 'is_active', default: true })
  isActive!: boolean;
}