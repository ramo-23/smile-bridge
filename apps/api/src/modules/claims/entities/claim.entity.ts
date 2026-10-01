import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ClaimStatus } from '../../../database/enums';
import { PatientEntity } from '../../patients/entities/patient.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { InvoiceEntity } from '../../billing/entities/invoice.entity';
import { InsurancePolicyEntity } from '../../patients/entities/insurance-policy.entity';

@Entity({ name: 'claims' })
@Index('claims_by_status', ['status', 'submittedAt'])
@Check('claims_amount_claimed_cents_check', 'amount_claimed_cents >= 0')
@Check('claims_amount_paid_cents_check', 'amount_paid_cents >= 0')
@Check('claims_check', "status <> 'rejected' OR rejection_reason IS NOT NULL")
@Check('claims_check1', "status <> 'paid' OR amount_paid_cents IS NOT NULL")
export class ClaimEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => InvoiceEntity, { nullable: false })
  @JoinColumn({ name: 'invoice_id' })
  invoice!: InvoiceEntity;

  @ManyToOne(() => InsurancePolicyEntity, { nullable: false })
  @JoinColumn({ name: 'insurance_policy_id' })
  insurancePolicy!: InsurancePolicyEntity;

  @Column('enum', {
    enum: ClaimStatus,
    enumName: 'claim_status',
    default: ClaimStatus.Draft,
  })
  status!: ClaimStatus;

  @Column('bigint', { name: 'amount_claimed_cents' })
  amountClaimedCents!: string;

  @Column('bigint', { name: 'amount_paid_cents', nullable: true })
  amountPaidCents!: string | null;

  @Column('text', { name: 'rejection_reason', nullable: true })
  rejectionReason!: string | null;

  @Column('timestamptz', { name: 'submitted_at', nullable: true })
  submittedAt!: Date | null;

  @Column('timestamptz', { name: 'resolved_at', nullable: true })
  resolvedAt!: Date | null;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'created_by' })
  createdBy!: UserEntity;

  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}