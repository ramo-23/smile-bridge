import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { InvoiceEntity } from './invoice.entity';

@Entity({ name: 'credit_notes' })
@Check('credit_notes_amount_cents_check', 'amount_cents > 0')
export class CreditNoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('text', { name: 'credit_note_number', unique: true })
  creditNoteNumber!: string;

  @ManyToOne(() => InvoiceEntity, { nullable: false })
  @JoinColumn({ name: 'invoice_id' })
  invoice!: InvoiceEntity;

  @Column('bigint', { name: 'amount_cents' })
  amountCents!: string;

  @Column('text')
  reason!: string;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'created_by' })
  createdBy!: UserEntity;

  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}