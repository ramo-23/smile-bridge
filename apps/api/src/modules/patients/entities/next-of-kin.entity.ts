import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PatientEntity } from './patient.entity';

@Entity({ name: 'next_of_kin' })
export class NextOfKinEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => PatientEntity, { nullable: false })
  @JoinColumn({ name: 'patient_id' })
  patient!: PatientEntity;

  @Column('text', { name: 'full_name' })
  fullName!: string;

  @Column('text')
  relationship!: string;

  @Column('text', { name: 'phone_e164' })
  phoneE164!: string;

  @Column('boolean', { name: 'is_emergency_contact', default: true })
  isEmergencyContact!: boolean;
}