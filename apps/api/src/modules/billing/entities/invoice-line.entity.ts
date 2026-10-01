import { Check, Column, Entity, JoinColumn, ManyToOne, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { InvoiceEntity } from './invoice.entity';
import { PerformedTreatmentEntity } from './performed-treatment.entity';

@Entity({ name: 'invoice_lines' })
@Check('invoice_lines_tooth_number_check', 'tooth_number BETWEEN 1 AND 32')
@Check('invoice_lines_quantity_check', 'quantity > 0')
@Check('invoice_lines_unit_price_cents_check', 'unit_price_cents >= 0')
@Check('invoice_lines_check', 'line_total_cents = quantity * unit_price_cents')
export class InvoiceLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => InvoiceEntity, { nullable: false })
  @JoinColumn({ name: 'invoice_id' })
  invoice!: InvoiceEntity;

  @OneToOne(() => PerformedTreatmentEntity, { nullable: true })
  @JoinColumn({ name: 'performed_treatment_id' })
  performedTreatment!: PerformedTreatmentEntity | null;

  @Column('text')
  description!: string;

  @Column('text', { name: 'procedure_code', nullable: true })
  procedureCode!: string | null;

  @Column('smallint', { name: 'tooth_number', nullable: true })
  toothNumber!: number | null;

  @Column('integer', { default: 1 })
  quantity!: number;

  @Column('bigint', { name: 'unit_price_cents' })
  unitPriceCents!: string;

  @Column('bigint', { name: 'line_total_cents' })
  lineTotalCents!: string;
}