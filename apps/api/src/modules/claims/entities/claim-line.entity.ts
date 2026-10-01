import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { InvoiceLineEntity } from '../../billing/entities/invoice-line.entity';
import { ClaimEntity } from './claim.entity';

@Entity({ name: 'claim_lines' })
@Check('claim_lines_amount_cents_check', 'amount_cents >= 0')
export class ClaimLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => ClaimEntity, { nullable: false })
  @JoinColumn({ name: 'claim_id' })
  claim!: ClaimEntity;

  @ManyToOne(() => InvoiceLineEntity, { nullable: false })
  @JoinColumn({ name: 'invoice_line_id' })
  invoiceLine!: InvoiceLineEntity;

  @Column('text', { name: 'procedure_code' })
  procedureCode!: string;

  @Column('bigint', { name: 'amount_cents' })
  amountCents!: string;
}