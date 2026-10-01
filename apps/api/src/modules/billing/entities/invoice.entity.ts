import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { InvoiceStatus } from '../../../database/enums';
import { PatientEntity } from '../../patients/entities/patient.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity({ name: 'invoices' })
@Check('invoices_total_cents_check', 'total_cents >= 0')
@Check(
  'invoices_check',
  "status = 'draft' OR (invoice_number IS NOT NULL AND issued_at IS NOT NULL)",
)
export class InvoiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('text', { name: 'invoice_number', nullable: true, unique: true })
  invoiceNumber!: string | null;

  @ManyToOne(() => PatientEntity, { nullable: false })
  @JoinColumn({ name: 'patient_id' })
  patient!: PatientEntity;

  @Column('enum', {
    enum: InvoiceStatus,
    enumName: 'invoice_status',
    default: InvoiceStatus.Draft,
  })
  status!: InvoiceStatus;

  @Column('timestamptz', { name: 'issued_at', nullable: true })
  issuedAt!: Date | null;

  @Column('bigint', { name: 'total_cents', default: 0 })
  totalCents!: string;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'created_by' })
  createdBy!: UserEntity;

  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}