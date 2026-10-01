import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { MessageChannel } from '../../../database/enums';
import { UserEntity } from '../../users/entities/user.entity';

@Entity({ name: 'message_templates' })
export class MessageTemplateEntity {
  @PrimaryColumn('text')
  key!: string;

  @Column('enum', { enum: MessageChannel, enumName: 'message_channel' })
  channel!: MessageChannel;

  @Column('text')
  body!: string;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'updated_by' })
  updatedBy!: UserEntity | null;

  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
}