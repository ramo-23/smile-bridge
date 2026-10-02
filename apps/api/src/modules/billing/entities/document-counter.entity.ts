import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'document_counters' })
@Check('document_counters_last_value_check', 'last_value >= 0')
export class DocumentCounterEntity {
  @PrimaryColumn('text')
  name!: string;

  @Column('bigint', { name: 'last_value', default: 0 })
  lastValue!: string;
}
