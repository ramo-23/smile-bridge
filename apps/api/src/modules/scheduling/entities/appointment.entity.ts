import {
  Column,
  Check,
  Entity,
  Exclusion,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AppointmentSource, AppointmentStatus } from '../../../database/enums';
import { BookingRequestEntity } from '../../booking-requests/entities/booking-request.entity';
import { PatientEntity } from '../../patients/entities/patient.entity';
import { ProviderEntity } from '../../providers/entities/provider.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { TreatmentTypeEntity } from './treatment-type.entity';

@Entity({ name: 'appointments' })
@Index('appointments_calendar', ['provider', 'startsAt'])
@Index('appointments_patient', { synchronize: false })
@Check('appointments_check', 'ends_at > starts_at')
@Check('appointments_check1', 'blocked_until >= ends_at')
@Exclusion(
  'appointments_no_overlap',
  "USING gist (provider_id WITH =, tstzrange(starts_at, blocked_until) WITH &&) WHERE (status NOT IN ('cancelled', 'no_show'))",
)
export class AppointmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => PatientEntity, { nullable: false })
  @JoinColumn({ name: 'patient_id' })
  patient!: PatientEntity;

  @ManyToOne(() => ProviderEntity, { nullable: false })
  @JoinColumn({ name: 'provider_id' })
  provider!: ProviderEntity;

  @ManyToOne(() => TreatmentTypeEntity, { nullable: false })
  @JoinColumn({ name: 'treatment_type_id' })
  treatmentType!: TreatmentTypeEntity;

  @Column('timestamptz', { name: 'starts_at' })
  startsAt!: Date;

  @Column('timestamptz', { name: 'ends_at' })
  endsAt!: Date;

  @Column('timestamptz', { name: 'blocked_until' })
  blockedUntil!: Date;

  @Column('enum', {
    enum: AppointmentStatus,
    enumName: 'appointment_status',
    default: AppointmentStatus.Scheduled,
  })
  status!: AppointmentStatus;

  @Column('enum', { enum: AppointmentSource, enumName: 'appointment_source' })
  source!: AppointmentSource;

  @OneToOne(() => BookingRequestEntity, { nullable: true })
  @JoinColumn({ name: 'booking_request_id' })
  bookingRequest!: BookingRequestEntity | null;

  @Column('text', { name: 'duration_override_reason', nullable: true })
  durationOverrideReason!: string | null;

  @Column('text', { name: 'cancel_reason', nullable: true })
  cancelReason!: string | null;

  @Column('text', { nullable: true })
  notes!: string | null;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'created_by' })
  createdBy!: UserEntity;

  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
}