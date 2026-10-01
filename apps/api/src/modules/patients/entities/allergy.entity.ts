import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SeverityLevel } from '../../../database/enums';
import { PatientEntity } from './patient.entity';

@Entity({ name: 'allergies' })
export class AllergyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => PatientEntity, { nullable: false })
  @JoinColumn({ name: 'patient_id' })
  patient!: PatientEntity;

  @Column('text')
  substance!: string;

  @Column('text', { nullable: true })
  reaction!: string | null;

  @Column('enum', { enum: SeverityLevel, enumName: 'severity_level' })
  severity!: SeverityLevel;

  @Column('timestamptz', { name: 'resolved_at', nullable: true })
  resolvedAt!: Date | null;
}
