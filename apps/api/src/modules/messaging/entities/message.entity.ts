import {
  Column,
  Check,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MessageChannel, MessageKind, MessageStatus } from '../../../database/enums';
import { PatientEntity } from '../../patients/entities/patient.entity';
import { AppointmentEntity } from '../../scheduling/entities/appointment.entity';
import { BookingRequestEntity } from '../../booking-requests/entities/booking-request.entity';

@Entity({ name: 'messages' })
@Index('messages_due', ['scheduledFor'], { where: 'status = \'queued\'' })
@Index('messages_one_reminder', ['appointment'], {
  unique: true,
  where: 'kind = \'reminder\' AND status <> \'cancelled\'',
})
@Check('messages_attempts_check', 'attempts <= 3')
export class MessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => PatientEntity, { nullable: true })
  @JoinColumn({ name: 'patient_id' })
  patient!: PatientEntity | null;

  @ManyToOne(() => AppointmentEntity, { nullable: true })
  @JoinColumn({ name: 'appointment_id' })
  appointment!: AppointmentEntity | null;

  @ManyToOne(() => BookingRequestEntity, { nullable: true })
  @JoinColumn({ name: 'booking_request_id' })
  bookingRequest!: BookingRequestEntity | null;

  @Column('enum', { enum: MessageKind, enumName: 'message_kind' })
  kind!: MessageKind;

  @Column('enum', { enum: MessageChannel, enumName: 'message_channel' })
  channel!: MessageChannel;

  @Column('text', { name: 'to_phone_e164' })
  toPhoneE164!: string;

  @Column('text')
  body!: string;

  @Column('enum', {
    enum: MessageStatus,
    enumName: 'message_status',
    default: MessageStatus.Queued,
  })
  status!: MessageStatus;

  @Column('integer', { default: 0 })
  attempts!: number;

  @Column('timestamptz', { name: 'scheduled_for' })
  scheduledFor!: Date;

  @Column('timestamptz', { name: 'sent_at', nullable: true })
  sentAt!: Date | null;

  @Column('text', { name: 'provider_message_id', nullable: true })
  providerMessageId!: string | null;

  @Column('text', { nullable: true })
  error!: string | null;

  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}