import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';

@Entity({ name: 'patients' })
@Check('patients_date_of_birth_check', 'date_of_birth <= CURRENT_DATE')
@Index('patients_name_trgm', { synchronize: false })
@Index('patients_phone', ['phoneE164'])
@Index('patients_dup_check', { synchronize: false })
export class PatientEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'bigint',
    name: 'patient_number',
    unique: true,
    generated: 'identity',
    generatedIdentity: 'ALWAYS',
  })
  patientNumber!: string;

  @Column('text', { name: 'first_name' })
  firstName!: string;

  @Column('text', { name: 'last_name' })
  lastName!: string;

  @Column('date', { name: 'date_of_birth' })
  dateOfBirth!: string;

  @Column('text', { nullable: true })
  sex!: string | null;

  @Column('text', { name: 'phone_e164' })
  phoneE164!: string;

  @Column('citext', { nullable: true })
  email!: string | null;

  @Column('text', { nullable: true })
  address!: string | null;

  @Column('text', { name: 'guardian_name', nullable: true })
  guardianName!: string | null;

  @Column('text', { name: 'guardian_phone', nullable: true })
  guardianPhone!: string | null;

  @Column('boolean', { name: 'do_not_message', default: false })
  doNotMessage!: boolean;

  @Column('timestamptz', { name: 'archived_at', nullable: true })
  archivedAt!: Date | null;

  @ManyToOne(() => PatientEntity, { nullable: true })
  @JoinColumn({ name: 'merged_into_id' })
  mergedInto!: PatientEntity | null;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'created_by' })
  createdBy!: UserEntity;

  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
}