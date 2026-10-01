import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ToothRecordType, ToothSurface } from '../../../database/enums';
import { PatientEntity } from '../../patients/entities/patient.entity';
import { AppointmentEntity } from '../../scheduling/entities/appointment.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity({ name: 'tooth_records' })
@Index('tooth_records_chart', { synchronize: false })
@Check('tooth_records_tooth_number_check', 'tooth_number BETWEEN 1 AND 32')
@Check('tooth_records_check', '(voided_at IS NULL) = (void_reason IS NULL)')
export class ToothRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => PatientEntity, { nullable: false })
  @JoinColumn({ name: 'patient_id' })
  patient!: PatientEntity;

  @Column('smallint', { name: 'tooth_number' })
  toothNumber!: number;

  @Column('enum', { enum: ToothSurface, enumName: 'tooth_surface', nullable: true })
  surface!: ToothSurface | null;

  @Column('enum', { name: 'record_type', enum: ToothRecordType, enumName: 'tooth_record_type' })
  recordType!: ToothRecordType;

  @Column('text', { name: 'condition_code' })
  conditionCode!: string;

  @Column('bytea', { nullable: true })
  note!: Buffer | null;

  @ManyToOne(() => AppointmentEntity, { nullable: true })
  @JoinColumn({ name: 'appointment_id' })
  appointment!: AppointmentEntity | null;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'recorded_by' })
  recordedBy!: UserEntity;

  @Column('timestamptz', { name: 'recorded_at', default: () => 'now()' })
  recordedAt!: Date;

  @Column('timestamptz', { name: 'voided_at', nullable: true })
  voidedAt!: Date | null;

  @Column('text', { name: 'void_reason', nullable: true })
  voidReason!: string | null;
}