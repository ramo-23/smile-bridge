import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PatientEntity } from '../../patients/entities/patient.entity';
import { AppointmentEntity } from '../../scheduling/entities/appointment.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity({ name: 'clinical_notes' })
export class ClinicalNoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => PatientEntity, { nullable: false })
  @JoinColumn({ name: 'patient_id' })
  patient!: PatientEntity;

  @ManyToOne(() => AppointmentEntity, { nullable: true })
  @JoinColumn({ name: 'appointment_id' })
  appointment!: AppointmentEntity | null;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'created_by' })
  createdBy!: UserEntity;

  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}