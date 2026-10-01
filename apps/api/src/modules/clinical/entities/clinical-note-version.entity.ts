import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { ClinicalNoteEntity } from './clinical-note.entity';

@Entity({ name: 'clinical_note_versions' })
@Unique('clinical_note_versions_note_id_version_no_key', ['note', 'versionNo'])
@Check('clinical_note_versions_version_no_check', 'version_no >= 1')
export class ClinicalNoteVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => ClinicalNoteEntity, { nullable: false })
  @JoinColumn({ name: 'note_id' })
  note!: ClinicalNoteEntity;

  @Column('integer', { name: 'version_no' })
  versionNo!: number;

  @Column('bytea')
  body!: Buffer;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'author_id' })
  author!: UserEntity;

  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}