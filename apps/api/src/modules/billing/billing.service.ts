import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { AppointmentStatus, UserRole } from '../../database/enums';
import { AuditService } from '../audit/audit.service';
import { AddInvoiceLineDto, CashUpQueryDto, CreateCreditNoteDto, CreateInvoiceDto, CreatePaymentDto, CreatePerformedTreatmentDto, InvoiceListQueryDto } from './dto/billing.dto';
import {
  INVOICE_FINANCIALS_SQL,
  loadInvoiceFinancials,
  toFinancials,
} from './invoice-financials';

export type Actor = { userId: string; role: UserRole; ip: string | null };

export type RecordPerformedTreatmentInput = {
  appointmentId: string;
  expectedPatientId: string | null;
  treatmentTypeId: string;
  toothNumber: number | null;
  priceCents: number | null;
  planItemId: string | null;
  requireActiveType: boolean;
};

const BILLABLE_APPOINTMENT_STATUSES: string[] = [AppointmentStatus.InProgress, AppointmentStatus.Completed];
const INVOICE_NUMBER_PREFIX = 'INV-';

type Row = Record<string, any>;

@Injectable()
export class BillingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async createPerformedTreatment(appointmentId: string, dto: CreatePerformedTreatmentDto, actor: Actor) {
    return this.dataSource.transaction(async (manager) =>
      this.recordPerformedTreatment(manager, actor, {
        appointmentId,
        expectedPatientId: null,
        treatmentTypeId: dto.treatmentTypeId,
        toothNumber: dto.toothNumber ?? null,
        priceCents: dto.priceCents ?? null,
        planItemId: null,
        requireActiveType: true,
      }),
    );
  }

  // Runs inside the caller's transaction so the treatment-plan flow can create it atomically.
  async recordPerformedTreatment(manager: EntityManager, actor: Actor, input: RecordPerformedTreatmentInput) {
    const [appointment] = await manager.query(
      'SELECT id, patient_id, status FROM appointments WHERE id = $1 FOR SHARE',
      [input.appointmentId],
    );
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (input.expectedPatientId && appointment.patient_id !== input.expectedPatientId)
      throw new BadRequestException('Appointment must belong to the same patient');
    if (!BILLABLE_APPOINTMENT_STATUSES.includes(appointment.status))
      throw new ConflictException('Treatments can only be recorded on in-progress or completed appointments');

    const [type] = await manager.query(
      'SELECT id, is_active, default_price_cents FROM treatment_types WHERE id = $1',
      [input.treatmentTypeId],
    );
    if (!type) throw new NotFoundException('Treatment type not found');
    if (input.requireActiveType && !type.is_active)
      throw new BadRequestException('Treatment type is not active');

    const priceCents = input.priceCents ?? Number(type.default_price_cents);
    let created: Row;
    try {
      [created] = await manager.query(
        `INSERT INTO performed_treatments
           (appointment_id, patient_id, treatment_type_id, plan_item_id, tooth_number, price_cents, performed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, appointment_id, patient_id, treatment_type_id, plan_item_id, tooth_number, price_cents, performed_at`,
        [
          appointment.id,
          appointment.patient_id,
          type.id,
          input.planItemId,
          input.toothNumber,
          priceCents,
          actor.userId,
        ],
      );
    } catch (error) {
      if (this.isUniqueViolation(error))
        throw new ConflictException('This treatment plan item already has a performed treatment');
      throw error;
    }

    await this.recordAudit(manager, actor, 'billing.performed_treatment.create', appointment.patient_id, created.id, {
      performedTreatmentId: created.id,
      appointmentId: created.appointment_id,
      treatmentTypeId: created.treatment_type_id,
      ...(created.plan_item_id ? { planItemId: created.plan_item_id } : {}),
    });
    const currencyCode = await this.currencyCode(manager);
    return this.performedTreatmentView(created, currencyCode);
  }

  async deletePerformedTreatment(id: string, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      const [treatment] = await manager.query(
        'SELECT id, patient_id FROM performed_treatments WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!treatment) throw new NotFoundException('Performed treatment not found');
      const [line] = await manager.query('SELECT id FROM invoice_lines WHERE performed_treatment_id = $1', [id]);
      if (line) throw new ConflictException('Performed treatment is already on an invoice');
      await manager.query('DELETE FROM performed_treatments WHERE id = $1', [id]);
      await this.recordAudit(manager, actor, 'billing.performed_treatment.delete', treatment.patient_id, id, {
        performedTreatmentId: id,
      });
      return { id };
    });
  }

  async getBillable(patientId: string) {
    return this.dataSource.transaction(async (manager) => {
      await this.requirePatient(manager, patientId);
      const rows: Row[] = await manager.query(
        `SELECT pt.id, pt.appointment_id, pt.patient_id, pt.treatment_type_id, pt.plan_item_id, pt.tooth_number,
                pt.price_cents, pt.performed_at, tt.name AS treatment_name, tt.procedure_code
           FROM performed_treatments pt
           JOIN treatment_types tt ON tt.id = pt.treatment_type_id
          WHERE pt.patient_id = $1
            AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.performed_treatment_id = pt.id)
          ORDER BY pt.performed_at, pt.id`,
        [patientId],
      );
      const [balance] = await manager.query(
        `SELECT COALESCE(SUM(GREATEST(f.balance_cents, 0)), 0)::bigint AS outstanding
           FROM invoices i JOIN (${INVOICE_FINANCIALS_SQL}) f ON f.invoice_id = i.id
          WHERE i.patient_id = $1 AND i.status = 'issued'`,
        [patientId],
      );
      const currencyCode = await this.currencyCode(manager);
      return {
        patientId,
        currencyCode,
        outstandingBalanceCents: Number(balance.outstanding),
        items: rows.map((row) => ({
          ...this.performedTreatmentView(row, currencyCode),
          treatmentName: row.treatment_name,
          procedureCode: row.procedure_code,
        })),
      };
    });
  }

  async createInvoice(patientId: string, dto: CreateInvoiceDto, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      const patient = await this.requirePatient(manager, patientId);
      if (patient.archived_at) throw new ConflictException('Archived patients cannot be invoiced');

      let treatments: Row[];
      if (dto.performedTreatmentIds) {
        treatments = await manager.query(
          `SELECT pt.id, pt.patient_id, pt.tooth_number, pt.price_cents, tt.name, tt.procedure_code
             FROM performed_treatments pt JOIN treatment_types tt ON tt.id = pt.treatment_type_id
            WHERE pt.id = ANY($1::uuid[])
            ORDER BY pt.performed_at, pt.id
            FOR UPDATE OF pt`,
          [dto.performedTreatmentIds],
        );
        if (treatments.length !== dto.performedTreatmentIds.length)
          throw new NotFoundException('Performed treatment not found');
        if (treatments.some((row) => row.patient_id !== patientId))
          throw new BadRequestException('Performed treatments must belong to the patient');
        const [billed] = await manager.query(
          'SELECT id FROM invoice_lines WHERE performed_treatment_id = ANY($1::uuid[]) LIMIT 1',
          [dto.performedTreatmentIds],
        );
        if (billed) throw new ConflictException('A performed treatment is already on an invoice');
      } else {
        treatments = await manager.query(
          `SELECT pt.id, pt.patient_id, pt.tooth_number, pt.price_cents, tt.name, tt.procedure_code
             FROM performed_treatments pt JOIN treatment_types tt ON tt.id = pt.treatment_type_id
            WHERE pt.patient_id = $1
              AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.performed_treatment_id = pt.id)
            ORDER BY pt.performed_at, pt.id
            FOR UPDATE OF pt`,
          [patientId],
        );
        if (!treatments.length) throw new ConflictException('The patient has no unbilled performed treatments');
      }

      const [invoice] = await manager.query(
        `INSERT INTO invoices (patient_id, created_by) VALUES ($1, $2) RETURNING id`,
        [patientId, actor.userId],
      );
      try {
        for (const treatment of treatments) await this.insertTreatmentLine(manager, invoice.id, treatment);
      } catch (error) {
        if (this.isUniqueViolation(error))
          throw new ConflictException('A performed treatment is already on an invoice');
        throw error;
      }
      await this.recordAudit(manager, actor, 'billing.invoice.create', patientId, invoice.id, {
        invoiceId: invoice.id,
        performedTreatmentIds: treatments.map((row) => row.id),
      });
      return this.loadInvoiceView(manager, invoice.id);
    });
  }

  async addLine(invoiceId: string, dto: AddInvoiceLineDto, actor: Actor) {
    const isTreatment = dto.performedTreatmentId !== undefined;
    if (isTreatment) {
      if (dto.description !== undefined || dto.unitPriceCents !== undefined || dto.quantity !== undefined)
        throw new BadRequestException('A performed treatment line cannot also set description, unit price or quantity');
    } else if (!dto.description?.trim() || dto.unitPriceCents === undefined) {
      throw new BadRequestException('A manual line requires a description and unitPriceCents');
    }

    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.lockDraftInvoice(manager, invoiceId);
      let lineId: string;
      try {
        if (isTreatment) {
          const [treatment] = await manager.query(
            `SELECT pt.id, pt.patient_id, pt.tooth_number, pt.price_cents, tt.name, tt.procedure_code
               FROM performed_treatments pt JOIN treatment_types tt ON tt.id = pt.treatment_type_id
              WHERE pt.id = $1 FOR UPDATE OF pt`,
            [dto.performedTreatmentId],
          );
          if (!treatment) throw new NotFoundException('Performed treatment not found');
          if (treatment.patient_id !== invoice.patient_id)
            throw new BadRequestException('Performed treatment must belong to the invoice patient');
          const [billed] = await manager.query('SELECT id FROM invoice_lines WHERE performed_treatment_id = $1', [
            treatment.id,
          ]);
          if (billed) throw new ConflictException('Performed treatment is already on an invoice');
          lineId = await this.insertTreatmentLine(manager, invoiceId, treatment);
        } else {
          const quantity = dto.quantity ?? 1;
          const [line] = await manager.query(
            `INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price_cents, line_total_cents)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [invoiceId, dto.description!.trim(), quantity, dto.unitPriceCents, quantity * dto.unitPriceCents!],
          );
          lineId = line.id;
        }
      } catch (error) {
        if (this.isUniqueViolation(error))
          throw new ConflictException('Performed treatment is already on an invoice');
        throw error;
      }
      await this.recordAudit(manager, actor, 'billing.invoice.line_add', invoice.patient_id, invoiceId, {
        invoiceId,
        lineId,
        ...(isTreatment ? { performedTreatmentId: dto.performedTreatmentId } : {}),
        fieldNames: isTreatment ? ['performedTreatmentId'] : ['description', 'unitPriceCents', 'quantity'],
      });
      return this.loadInvoiceView(manager, invoiceId);
    });
  }

  async removeLine(invoiceId: string, lineId: string, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.lockDraftInvoice(manager, invoiceId);
      const [line] = await manager.query(
        'SELECT id, performed_treatment_id FROM invoice_lines WHERE id = $1 AND invoice_id = $2 FOR UPDATE',
        [lineId, invoiceId],
      );
      if (!line) throw new NotFoundException('Invoice line not found');
      await manager.query('DELETE FROM invoice_lines WHERE id = $1', [lineId]);
      await this.recordAudit(manager, actor, 'billing.invoice.line_remove', invoice.patient_id, invoiceId, {
        invoiceId,
        lineId,
        ...(line.performed_treatment_id ? { performedTreatmentId: line.performed_treatment_id } : {}),
      });
      return this.loadInvoiceView(manager, invoiceId);
    });
  }

  async deleteInvoice(invoiceId: string, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.lockDraftInvoice(manager, invoiceId);
      await manager.query('DELETE FROM invoice_lines WHERE invoice_id = $1', [invoiceId]);
      await manager.query('DELETE FROM invoices WHERE id = $1', [invoiceId]);
      await this.recordAudit(manager, actor, 'billing.invoice.delete', invoice.patient_id, invoiceId, {
        invoiceId,
      });
      return { id: invoiceId };
    });
  }

  async issueInvoice(invoiceId: string, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.lockDraftInvoice(manager, invoiceId);
      const [sums] = await manager.query(
        `SELECT COUNT(*)::int AS line_count, COALESCE(SUM(line_total_cents), 0)::bigint AS total
           FROM invoice_lines WHERE invoice_id = $1`,
        [invoiceId],
      );
      const totalCents = Number(sums.total);
      if (sums.line_count === 0) throw new ConflictException('An invoice needs at least one line to be issued');
      if (totalCents <= 0) throw new ConflictException('An invoice total must be greater than zero to be issued');

      // Invoice row is locked first, then the counter: the same order everywhere, so no deadlocks.
      // The counter increment commits or rolls back with this transaction, so numbers stay gapless.
      const [counter] = await manager.query(
        `SELECT last_value FROM document_counters WHERE name = 'invoice' FOR UPDATE`,
      );
      if (!counter) throw new InternalServerErrorException('Invoice counter is not initialised');
      const next = Number(counter.last_value) + 1;
      await manager.query(`UPDATE document_counters SET last_value = $1 WHERE name = 'invoice'`, [next]);

      await manager.query(
        `UPDATE invoices
            SET invoice_number = $2, issued_at = clock_timestamp(), total_cents = $3, status = 'issued'
          WHERE id = $1`,
        [invoiceId, `${INVOICE_NUMBER_PREFIX}${String(next).padStart(6, '0')}`, totalCents],
      );
      await this.recordAudit(manager, actor, 'billing.invoice.issue', invoice.patient_id, invoiceId, {
        invoiceId,
      });
      return this.loadInvoiceView(manager, invoiceId);
    });
  }

  async getInvoice(invoiceId: string, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      const view = await this.loadInvoiceView(manager, invoiceId);
      await this.recordAudit(manager, actor, 'billing.invoice.view', view.patientId, invoiceId, { invoiceId });
      return view;
    });
  }

  async listInvoices(query: InvoiceListQueryDto, patientId?: string) {
    return this.dataSource.transaction(async (manager) => {
      if (patientId) await this.requirePatient(manager, patientId);
      const params: unknown[] = [];
      const where: string[] = [];
      const add = (sql: string, value: unknown) => {
        params.push(value);
        where.push(sql.replace('?', `$${params.length}`));
      };
      const effectivePatientId = patientId ?? query.patientId;
      if (effectivePatientId) add('i.patient_id = ?', effectivePatientId);
      if (query.status) add('i.status = ?::invoice_status', query.status);
      if (query.paymentStatus) add('f.payment_status = ?', query.paymentStatus);

      if (query.from || query.to) {
        const [settings] = await manager.query('SELECT timezone FROM clinic_settings WHERE id');
        const zone = settings?.timezone ?? 'UTC';
        const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
        if (query.from) {
          const from = dateOnly.test(query.from)
            ? DateTime.fromISO(query.from, { zone }).startOf('day')
            : DateTime.fromISO(query.from, { setZone: true });
          if (!from.isValid) throw new BadRequestException('from is not a valid date');
          add('COALESCE(i.issued_at, i.created_at) >= ?::timestamptz', from.toUTC().toISO());
        }
        if (query.to) {
          const dateOnlyTo = dateOnly.test(query.to);
          const to = dateOnlyTo
            ? DateTime.fromISO(query.to, { zone }).plus({ days: 1 }).startOf('day')
            : DateTime.fromISO(query.to, { setZone: true });
          if (!to.isValid) throw new BadRequestException('to is not a valid date');
          add(
            `COALESCE(i.issued_at, i.created_at) ${dateOnlyTo ? '<' : '<='} ?::timestamptz`,
            to.toUTC().toISO(),
          );
        }
      }

      params.push(query.pageSize, (query.page - 1) * query.pageSize);
      const rows: Row[] = await manager.query(
        `SELECT i.id, i.invoice_number, i.patient_id, i.status, i.issued_at, i.created_at,
                CASE WHEN i.status = 'draft'
                     THEN (SELECT COALESCE(SUM(l.line_total_cents), 0) FROM invoice_lines l WHERE l.invoice_id = i.id)
                     ELSE i.total_cents END AS total_cents,
                f.credited_cents, f.paid_cents, f.balance_cents, f.payment_status,
                count(*) OVER()::int AS match_count
           FROM invoices i JOIN (${INVOICE_FINANCIALS_SQL}) f ON f.invoice_id = i.id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY i.created_at DESC, i.id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const currencyCode = await this.currencyCode(manager);
      return {
        items: rows.map((row) => this.invoiceSummaryView(row, currencyCode)),
        total: rows[0]?.match_count ?? 0,
        page: query.page,
        pageSize: query.pageSize,
        currencyCode,
      };
    });
  }

  private async insertTreatmentLine(manager: EntityManager, invoiceId: string, treatment: Row): Promise<string> {
    const [line] = await manager.query(
      `INSERT INTO invoice_lines
         (invoice_id, performed_treatment_id, description, procedure_code, tooth_number, quantity,
          unit_price_cents, line_total_cents)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $6) RETURNING id`,
      [invoiceId, treatment.id, treatment.name, treatment.procedure_code, treatment.tooth_number, treatment.price_cents],
    );
    return line.id;
  }

  private async lockIssuedInvoice(manager: EntityManager, invoiceId: string): Promise<Row> {
    const [invoice] = await manager.query(
      'SELECT id, patient_id, status, total_cents FROM invoices WHERE id = $1 FOR UPDATE',
      [invoiceId],
    );
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'issued') throw new ConflictException('Only issued invoices accept payments and credit notes');
    return invoice;
  }

  async createPayment(invoiceId: string, dto: CreatePaymentDto, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.lockIssuedInvoice(manager, invoiceId);
      const before = await loadInvoiceFinancials(manager, invoiceId);
      const balance = before.balanceCents ?? 0;
      if (dto.amountCents > balance) {
        throw new ConflictException(`Payment exceeds the current balance of ${Math.max(balance, 0)} cents`);
      }
      const [payment] = await manager.query(
        `INSERT INTO payments (invoice_id, method, amount_cents, received_by, reference)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, method, amount_cents, paid_at, reference`,
        [invoiceId, dto.method, dto.amountCents, actor.userId, dto.reference?.trim() || null],
      );
      await this.recordAudit(manager, actor, 'billing.payment.create', invoice.patient_id, payment.id, {
        invoiceId,
        paymentId: payment.id,
      });
      return {
        id: payment.id as string,
        invoiceId,
        method: payment.method as string,
        amountCents: Number(payment.amount_cents),
        paidAt: payment.paid_at as Date,
        reference: payment.reference as string | null,
        currencyCode: await this.currencyCode(manager),
        invoice: await this.financialSummary(manager, invoiceId),
      };
    });
  }

  async createCreditNote(invoiceId: string, dto: CreateCreditNoteDto, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.lockIssuedInvoice(manager, invoiceId);
      const financials = await loadInvoiceFinancials(manager, invoiceId);
      const creditable = Number(invoice.total_cents) - financials.creditedCents;
      if (dto.amountCents > creditable) {
        throw new ConflictException(`Credit exceeds the creditable remainder of ${creditable} cents`);
      }
      // Same lock order as invoice issue: invoice row first, then the counter row.
      const [counter] = await manager.query(
        `SELECT last_value FROM document_counters WHERE name = 'credit_note' FOR UPDATE`,
      );
      if (!counter) throw new InternalServerErrorException('Credit note counter is not initialised');
      const next = Number(counter.last_value) + 1;
      await manager.query(`UPDATE document_counters SET last_value = $1 WHERE name = 'credit_note'`, [next]);
      const [note] = await manager.query(
        `INSERT INTO credit_notes (credit_note_number, invoice_id, amount_cents, reason, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, credit_note_number, amount_cents, reason, created_at`,
        [`CN-${String(next).padStart(6, '0')}`, invoiceId, dto.amountCents, dto.reason, actor.userId],
      );
      await this.recordAudit(manager, actor, 'billing.credit_note.create', invoice.patient_id, note.id, {
        invoiceId,
        creditNoteId: note.id,
      });
      return {
        id: note.id as string,
        creditNoteNumber: note.credit_note_number as string,
        invoiceId,
        amountCents: Number(note.amount_cents),
        reason: note.reason as string,
        createdAt: note.created_at as Date,
        currencyCode: await this.currencyCode(manager),
        invoice: await this.financialSummary(manager, invoiceId),
      };
    });
  }

  async cashUp(date: string, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      const [settings] = await manager.query('SELECT timezone, currency_code FROM clinic_settings WHERE id');
      const zone: string = settings?.timezone ?? 'UTC';
      const start = DateTime.fromISO(date, { zone });
      if (!start.isValid) throw new BadRequestException('date is not a valid date');
      const end = start.plus({ days: 1 }).startOf('day');
      const range = [start.startOf('day').toUTC().toISO(), end.toUTC().toISO()];
      const byMethod: Row[] = await manager.query(
        `SELECT method, COALESCE(SUM(amount_cents), 0)::bigint AS total, COUNT(*)::int AS count
           FROM payments WHERE paid_at >= $1 AND paid_at < $2 GROUP BY method ORDER BY method`,
        range,
      );
      const byUser: Row[] = await manager.query(
        `SELECT p.received_by AS user_id, u.full_name, SUM(p.amount_cents)::bigint AS total, COUNT(*)::int AS count
           FROM payments p JOIN users u ON u.id = p.received_by
          WHERE p.paid_at >= $1 AND p.paid_at < $2
          GROUP BY p.received_by, u.full_name ORDER BY u.full_name, p.received_by`,
        range,
      );
      await this.audit.record(
        {
          userId: actor.userId,
          action: 'billing.cash_up.view',
          entityType: 'billing',
          entityId: null,
          patientId: null,
          ip: actor.ip,
          metadata: { fieldNames: ['date'] },
        },
        manager,
      );
      return {
        date,
        timezone: zone,
        currencyCode: (settings?.currency_code as string | undefined) ?? null,
        byMethod: byMethod.map((r) => ({ method: r.method, totalCents: Number(r.total), count: r.count })),
        byUser: byUser.map((r) => ({
          userId: r.user_id,
          fullName: r.full_name,
          totalCents: Number(r.total),
          count: r.count,
        })),
        grandTotalCents: byMethod.reduce((sum, r) => sum + Number(r.total), 0),
        paymentCount: byMethod.reduce((sum, r) => sum + r.count, 0),
      };
    });
  }

  private async financialSummary(manager: EntityManager, invoiceId: string) {
    const f = await loadInvoiceFinancials(manager, invoiceId);
    return { id: invoiceId, ...f };
  }

  private async lockDraftInvoice(manager: EntityManager, invoiceId: string): Promise<Row> {
    const [invoice] = await manager.query(
      'SELECT id, patient_id, status FROM invoices WHERE id = $1 FOR UPDATE',
      [invoiceId],
    );
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'draft') throw new ConflictException('Issued invoices cannot be changed');
    return invoice;
  }

  private async requirePatient(manager: EntityManager, patientId: string): Promise<Row> {
    const [patient] = await manager.query('SELECT id, archived_at FROM patients WHERE id = $1', [patientId]);
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  private async currencyCode(manager: EntityManager): Promise<string | null> {
    const [settings] = await manager.query('SELECT currency_code FROM clinic_settings WHERE id');
    return settings?.currency_code ?? null;
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505';
  }

  private async recordAudit(
    manager: EntityManager,
    actor: Actor,
    action: string,
    patientId: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.audit.record(
      { userId: actor.userId, action, entityType: 'billing', entityId, patientId, ip: actor.ip, metadata },
      manager,
    );
  }

  private performedTreatmentView(row: Row, currencyCode: string | null) {
    return {
      id: row.id,
      appointmentId: row.appointment_id,
      patientId: row.patient_id,
      treatmentTypeId: row.treatment_type_id,
      planItemId: row.plan_item_id,
      toothNumber: row.tooth_number,
      priceCents: Number(row.price_cents),
      currencyCode,
      performedAt: row.performed_at,
    };
  }

  private invoiceSummaryView(row: Row, currencyCode: string | null) {
    return {
      id: row.id,
      invoiceNumber: row.invoice_number,
      patientId: row.patient_id,
      status: row.status,
      issuedAt: row.issued_at,
      createdAt: row.created_at,
      currencyCode,
      totalCents: Number(row.total_cents),
      ...toFinancials(row as Parameters<typeof toFinancials>[0]),
    };
  }

  private async loadInvoiceView(manager: EntityManager, invoiceId: string) {
    const [invoice] = await manager.query(
      `SELECT id, invoice_number, patient_id, status, issued_at, created_at, total_cents FROM invoices WHERE id = $1`,
      [invoiceId],
    );
    if (!invoice) throw new NotFoundException('Invoice not found');
    const lines: Row[] = await manager.query(
      `SELECT id, performed_treatment_id, description, procedure_code, tooth_number, quantity,
              unit_price_cents, line_total_cents
         FROM invoice_lines WHERE invoice_id = $1 ORDER BY description, id`,
      [invoiceId],
    );
    const payments: Row[] = await manager.query(
      `SELECT id, method, amount_cents, paid_at, reference FROM payments WHERE invoice_id = $1 ORDER BY paid_at, id`,
      [invoiceId],
    );
    const creditNotes: Row[] = await manager.query(
      `SELECT id, credit_note_number, amount_cents, reason, created_at
         FROM credit_notes WHERE invoice_id = $1 ORDER BY created_at, id`,
      [invoiceId],
    );
    const financials = await loadInvoiceFinancials(manager, invoiceId);
    const totalCents =
      invoice.status === 'draft'
        ? lines.reduce((sum, line) => sum + Number(line.line_total_cents), 0)
        : Number(invoice.total_cents);
    return {
      id: invoice.id as string,
      invoiceNumber: invoice.invoice_number as string | null,
      patientId: invoice.patient_id as string,
      status: invoice.status as string,
      issuedAt: invoice.issued_at as Date | null,
      createdAt: invoice.created_at as Date,
      currencyCode: await this.currencyCode(manager),
      totalCents,
      ...financials,
      lines: lines.map((line) => ({
        id: line.id,
        performedTreatmentId: line.performed_treatment_id,
        description: line.description,
        procedureCode: line.procedure_code,
        toothNumber: line.tooth_number,
        quantity: line.quantity,
        unitPriceCents: Number(line.unit_price_cents),
        lineTotalCents: Number(line.line_total_cents),
      })),
      payments: payments.map((payment) => ({
        id: payment.id,
        method: payment.method,
        amountCents: Number(payment.amount_cents),
        paidAt: payment.paid_at,
        reference: payment.reference,
      })),
      creditNotes: creditNotes.map((note) => ({
        id: note.id,
        creditNoteNumber: note.credit_note_number,
        amountCents: Number(note.amount_cents),
        reason: note.reason,
        createdAt: note.created_at,
      })),
    };
  }
}
