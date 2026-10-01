import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PatientEntity } from './patient.entity';

@Entity({ name: 'insurance_policies' })
export class InsurancePolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => PatientEntity, { nullable: false })
  @JoinColumn({ name: 'patient_id' })
  patient!: PatientEntity;

  @Column('text', { name: 'insurer_name' })
  insurerName!: string;

  @Column('text', { name: 'policy_number' })
  policyNumber!: string;

  @Column('text', { name: 'principal_member_name' })
  principalMemberName!: string;

  @Column('text', { name: 'plan_name', nullable: true })
  planName!: string | null;

  @Column('boolean', { name: 'is_active', default: true })
  isActive!: boolean;
}