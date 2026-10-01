import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PaymentMethod } from '../../../database/enums';
import { UserEntity } from '../../users/entities/user.entity';
import { InvoiceEntity } from './invoice.entity';

@Entity({ name: 'payments' })
@Check('payments_amount_cents_check', 'amount_cents > 0')
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => InvoiceEntity, { nullable: false })
  @JoinColumn({ name: 'invoice_id' })
  invoice!: InvoiceEntity;

  @Column('enum', { enum: PaymentMethod, enumName: 'payment_method' })
  method!: PaymentMethod;

  @Column('bigint', { name: 'amount_cents' })
  amountCents!: string;

  @Column('timestamptz', { name: 'paid_at', default: () => 'now()' })
  paidAt!: Date;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'received_by' })
  receivedBy!: UserEntity;

  @Column('text', { nullable: true })
  reference!: string | null;
}