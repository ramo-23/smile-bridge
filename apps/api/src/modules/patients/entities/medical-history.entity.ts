import { Column, Entity, JoinColumn, ManyToOne, OneToOne, PrimaryColumn } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { PatientEntity } from './patient.entity';

@Entity({ name: 'medical_histories' })
export class MedicalHistoryEntity {
  @PrimaryColumn('uuid', { name: 'patient_id' })
  patientId!: string;

  @OneToOne(() => PatientEntity, { nullable: false })
  @JoinColumn({ name: 'patient_id' })
  patient!: PatientEntity;

  @Column('bytea', { nullable: true })
  conditions!: Buffer | null;

  @Column('bytea', { nullable: true })
  medications!: Buffer | null;

  @Column('bytea', { nullable: true })
  notes!: Buffer | null;

  @Column('timestamptz', { name: 'confirmed_at', nullable: true })
  confirmedAt!: Date | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'confirmed_by' })
  confirmedBy!: UserEntity | null;

  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
}