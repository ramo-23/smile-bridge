import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AttachmentKind } from '../../../database/enums';
import { PatientEntity } from '../../patients/entities/patient.entity';
import { AppointmentEntity } from '../../scheduling/entities/appointment.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity({ name: 'attachments' })
@Check('attachments_mime_type_check', "mime_type IN ('image/jpeg','image/png','application/pdf')")
@Check('attachments_size_bytes_check', 'size_bytes BETWEEN 1 AND 20971520')
export class AttachmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => PatientEntity, { nullable: false })
  @JoinColumn({ name: 'patient_id' })
  patient!: PatientEntity;

  @ManyToOne(() => AppointmentEntity, { nullable: true })
  @JoinColumn({ name: 'appointment_id' })
  appointment!: AppointmentEntity | null;

  @Column('enum', { enum: AttachmentKind, enumName: 'attachment_kind' })
  kind!: AttachmentKind;

  @Column('text', { name: 'original_filename' })
  originalFilename!: string;

  @Column('text', { name: 'storage_key', unique: true })
  storageKey!: string;

  @Column('text', { name: 'mime_type' })
  mimeType!: string;

  @Column('bigint', { name: 'size_bytes' })
  sizeBytes!: string;

  @Column('text')
  sha256!: string;

  @Column('text', { nullable: true })
  note!: string | null;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'uploaded_by' })
  uploadedBy!: UserEntity;

  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}