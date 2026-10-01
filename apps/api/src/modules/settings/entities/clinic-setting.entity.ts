import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'clinic_settings' })
@Check('clinic_settings_id_check', 'id')
@Check('clinic_settings_buffer_minutes_check', 'buffer_minutes >= 0')
export class ClinicSettingEntity {
  @PrimaryColumn('boolean', { default: true })
  id!: boolean;

  @Column('text', { name: 'clinic_name' })
  clinicName!: string;

  @Column('text', { nullable: true })
  address!: string | null;

  @Column('text', { name: 'phone_e164', nullable: true })
  phoneE164!: string | null;

  @Column('text')
  timezone!: string;

  @Column('char', { name: 'currency_code', length: 3 })
  currencyCode!: string;

  @Column('integer', { name: 'buffer_minutes', default: 10 })
  bufferMinutes!: number;

  @Column('integer', { name: 'reminder_hours_before', default: 24 })
  reminderHoursBefore!: number;

  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
}