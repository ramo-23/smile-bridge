import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { RequestStatus } from '../../../database/enums';
import { PatientEntity } from '../../patients/entities/patient.entity';
import { TreatmentTypeEntity } from '../../scheduling/entities/treatment-type.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity({ name: 'booking_requests' })
@Index('booking_requests_queue', ['status', 'createdAt'])
@Check('booking_requests_check', "status <> 'declined' OR decline_reason IS NOT NULL")
export class BookingRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('text', { name: 'full_name' })
  fullName!: string;

  @Column('text', { name: 'phone_e164' })
  phoneE164!: string;

  @Column('date', { name: 'date_of_birth' })
  dateOfBirth!: string;

  @Column('date', { name: 'preferred_date' })
  preferredDate!: string;

  @Column('time', { name: 'preferred_time' })
  preferredTime!: string;

  @ManyToOne(() => TreatmentTypeEntity, { nullable: false })
  @JoinColumn({ name: 'treatment_type_id' })
  treatmentType!: TreatmentTypeEntity;

  @Column('text', { nullable: true })
  note!: string | null;

  @Column('enum', {
    enum: RequestStatus,
    enumName: 'request_status',
    default: RequestStatus.Pending,
  })
  status!: RequestStatus;

  @ManyToOne(() => PatientEntity, { nullable: true })
  @JoinColumn({ name: 'matched_patient_id' })
  matchedPatient!: PatientEntity | null;

  @Column('text', { name: 'decline_reason', nullable: true })
  declineReason!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'handled_by' })
  handledBy!: UserEntity | null;

  @Column('timestamptz', { name: 'handled_at', nullable: true })
  handledAt!: Date | null;

  @Column('text', { name: 'submitter_ip_hash', nullable: true })
  submitterIpHash!: string | null;

  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}