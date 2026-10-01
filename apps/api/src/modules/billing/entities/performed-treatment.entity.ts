import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PatientEntity } from '../../patients/entities/patient.entity';
import { AppointmentEntity } from '../../scheduling/entities/appointment.entity';
import { TreatmentTypeEntity } from '../../scheduling/entities/treatment-type.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity({ name: 'performed_treatments' })
@Check('performed_treatments_tooth_number_check', 'tooth_number BETWEEN 1 AND 32')
@Check('performed_treatments_price_cents_check', 'price_cents >= 0')
export class PerformedTreatmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => AppointmentEntity, { nullable: false })
  @JoinColumn({ name: 'appointment_id' })
  appointment!: AppointmentEntity;

  @ManyToOne(() => PatientEntity, { nullable: false })
  @JoinColumn({ name: 'patient_id' })
  patient!: PatientEntity;

  @ManyToOne(() => TreatmentTypeEntity, { nullable: false })
  @JoinColumn({ name: 'treatment_type_id' })
  treatmentType!: TreatmentTypeEntity;

  @Column('smallint', { name: 'tooth_number', nullable: true })
  toothNumber!: number | null;

  @Column('bigint', { name: 'price_cents' })
  priceCents!: string;

  @Column('timestamptz', { name: 'performed_at', default: () => 'now()' })
  performedAt!: Date;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'performed_by' })
  performedBy!: UserEntity;
}