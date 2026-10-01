import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLogEntity } from './entities/audit-log.entity';

export type AuditRecord = {
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  patientId: string | null;
  ip: string | null;
  metadata: Record<string, unknown>;
};

export type AuditFilters = {
  userId?: string;
  patientId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
};

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLogEntity) private readonly audits: Repository<AuditLogEntity>,
  ) {}

  async record(record: AuditRecord, manager?: EntityManager): Promise<void> {
    const repository = manager?.getRepository(AuditLogEntity) ?? this.audits;
    await repository.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, patient_id, ip_address, metadata)
			 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        record.userId,
        record.action,
        record.entityType,
        record.entityId,
        record.patientId,
        record.ip,
        JSON.stringify(this.sanitizeMetadata(record.metadata)),
      ],
    );
  }

  async list(filters: AuditFilters): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const query = this.audits.createQueryBuilder('audit');
    if (filters.userId) query.andWhere('audit.user_id = :userId', { userId: filters.userId });
    if (filters.patientId)
      query.andWhere('audit.patient_id = :patientId', { patientId: filters.patientId });
    if (filters.action) query.andWhere('audit.action = :action', { action: filters.action });
    if (filters.from) query.andWhere('audit.occurred_at >= :from', { from: filters.from });
    if (filters.to) query.andWhere('audit.occurred_at <= :to', { to: filters.to });

    const total = await query.getCount();
    const rows = await query
      .select('audit.id', 'id')
      .addSelect('audit.occurred_at', 'occurredAt')
      .addSelect('audit.user_id', 'userId')
      .addSelect('audit.action', 'action')
      .addSelect('audit.entity_type', 'entityType')
      .addSelect('audit.entity_id', 'entityId')
      .addSelect('audit.patient_id', 'patientId')
      .addSelect('audit.ip_address', 'ip')
      .addSelect('audit.metadata', 'metadata')
      .orderBy('audit.occurred_at', 'DESC')
      .addOrderBy('audit.id', 'DESC')
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getRawMany<Record<string, unknown>>();

    return { items: rows, total };
  }

  private sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const sanitize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sanitize);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => !/(password|token|body)/i.test(key))
          .map(([key, nested]) => [key, sanitize(nested)]),
      );
    };
    return sanitize(metadata) as Record<string, unknown>;
  }
}
