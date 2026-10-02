import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { EncryptionService } from '../../common/encryption.service';
import { AuditService } from '../audit/audit.service';
import { PatientEntity } from '../patients/entities/patient.entity';
import { AppointmentEntity } from '../scheduling/entities/appointment.entity';
import { TreatmentTypeEntity } from '../scheduling/entities/treatment-type.entity';
import { UserEntity } from '../users/entities/user.entity';
import { PlanStatus, ToothRecordType, ToothSurface, UserRole } from '../../database/enums';
import {
	SURFACE_CONDITION_CODES,
	ToothConditionCode,
	TOOTH_CONDITION_CODES,
	WHOLE_TOOTH_ONLY_CODES,
} from './clinical.enums';
import { CreateClinicalNoteDto, CreateToothRecordDto, CreateTreatmentPlanDto, UpdateClinicalNoteDto, UpdateTreatmentPlanItemDto } from './dto/clinical.dto';
import { ClinicalNoteEntity } from './entities/clinical-note.entity';
import { ClinicalNoteVersionEntity } from './entities/clinical-note-version.entity';
import { ToothRecordEntity } from './entities/tooth-record.entity';
import { TreatmentPlanItemEntity } from './entities/treatment-plan-item.entity';
import { TreatmentPlanEntity } from './entities/treatment-plan.entity';

type Actor = { userId: string; role: UserRole; ip: string | null };
type PlanItemInput = CreateTreatmentPlanDto['items'][number];

const SURFACES = Object.values(ToothSurface);
const STATUS_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
	[PlanStatus.Proposed]: [PlanStatus.Accepted, PlanStatus.Declined],
	[PlanStatus.Accepted]: [PlanStatus.Done, PlanStatus.Declined],
	[PlanStatus.Declined]: [PlanStatus.Proposed],
	[PlanStatus.Done]: [],
};

@Injectable()
export class ClinicalService {
	constructor(
		private readonly dataSource: DataSource,
		@InjectRepository(PatientEntity) private readonly patients: Repository<PatientEntity>,
		@InjectRepository(AppointmentEntity)
		private readonly appointments: Repository<AppointmentEntity>,
		@InjectRepository(ToothRecordEntity)
		private readonly toothRecords: Repository<ToothRecordEntity>,
		@InjectRepository(ClinicalNoteEntity)
		private readonly notes: Repository<ClinicalNoteEntity>,
		@InjectRepository(ClinicalNoteVersionEntity)
		private readonly noteVersions: Repository<ClinicalNoteVersionEntity>,
		@InjectRepository(TreatmentPlanEntity)
		private readonly plans: Repository<TreatmentPlanEntity>,
		@InjectRepository(TreatmentPlanItemEntity)
		private readonly planItems: Repository<TreatmentPlanItemEntity>,
		@InjectRepository(TreatmentTypeEntity)
		private readonly treatmentTypes: Repository<TreatmentTypeEntity>,
		private readonly encryption: EncryptionService,
		private readonly audit: AuditService,
	) {}

	async addToothRecord(patientId: string, dto: CreateToothRecordDto, actor: Actor) {
		if (!TOOTH_CONDITION_CODES.includes(dto.conditionCode))
			throw new BadRequestException('Unknown tooth condition code');
		if (
			dto.surface != null &&
			WHOLE_TOOTH_ONLY_CODES.includes(dto.conditionCode as (typeof WHOLE_TOOTH_ONLY_CODES)[number])
		) {
			throw new BadRequestException('This condition applies to the whole tooth and cannot have a surface');
		}
		return this.dataSource.transaction(async (manager) => {
			await this.requirePatient(manager, patientId);
			if (dto.appointmentId) await this.requirePatientAppointment(manager, patientId, dto.appointmentId);
			if (dto.surface != null) {
				const wholeTooth = await this.getLatestWholeToothRecord(manager, patientId, dto.toothNumber);
				if (this.isSurfacesInactive(wholeTooth?.conditionCode)) {
					const state = wholeTooth!.conditionCode === ToothConditionCode.Extracted ? 'extracted' : 'missing';
					throw new ConflictException(
						`Tooth ${dto.toothNumber} is ${state}. Void that record before charting surfaces.`,
					);
				}
			}
			const repository = manager.getRepository(ToothRecordEntity);
			const record = await repository.save({
				patient: { id: patientId } as PatientEntity,
				toothNumber: dto.toothNumber,
				surface: dto.surface ?? null,
				recordType: dto.recordType,
				conditionCode: dto.conditionCode,
				note: dto.note == null ? null : this.encryption.encrypt(dto.note),
				appointment: dto.appointmentId ? ({ id: dto.appointmentId } as AppointmentEntity) : null,
				recordedBy: { id: actor.userId } as UserEntity,
			});
			await this.recordAudit(manager, actor, 'clinical.tooth_record.create', patientId, record.id, {
				fieldNames: ['toothNumber', 'surface', 'recordType', 'conditionCode', 'note', 'appointmentId'],
				toothRecordId: record.id,
				...(dto.appointmentId ? { appointmentId: dto.appointmentId } : {}),
			});
			return this.toothRecordView(record, true);
		});
	}

	async voidToothRecord(recordId: string, reason: string, actor: Actor) {
		if (!reason.trim()) throw new BadRequestException('Void reason is required');
		return this.dataSource.transaction(async (manager) => {
			const [record] = await manager.query(
				'SELECT id, patient_id AS "patientId", voided_at AS "voidedAt" FROM tooth_records WHERE id = $1 FOR UPDATE',
				[recordId],
			);
			if (!record) throw new NotFoundException('Tooth record not found');
			if (record.voidedAt) throw new ConflictException('Tooth record has already been voided');
			const [rows] = await manager.query(
				`UPDATE tooth_records SET voided_at = now(), void_reason = $2
				 WHERE id = $1 AND voided_at IS NULL
				 RETURNING id, voided_at AS "voidedAt", void_reason AS "voidReason"`,
				[recordId, reason.trim()],
			);
			const updated = rows[0];
			await this.recordAudit(
				manager,
				actor,
				'clinical.tooth_record.void',
				record.patientId,
				recordId,
				{ fieldNames: ['voidedAt', 'voidReason'], toothRecordId: recordId },
			);
			return updated;
		});
	}

	async getOdontogram(patientId: string, actor: Actor) {
		return this.dataSource.transaction(async (manager) => {
			await this.requirePatient(manager, patientId);
			const records = await manager.query(
				`SELECT tooth_number AS "toothNumber", surface, record_type AS "recordType",
								condition_code AS "conditionCode", recorded_at AS "recordedAt"
				 FROM tooth_records
				 WHERE patient_id = $1 AND voided_at IS NULL
				 ORDER BY recorded_at DESC, id DESC`,
				[patientId],
			);
			const teeth = Array.from({ length: 32 }, (_, index) => index + 1).map((toothNumber) => {
				const toothRecords = records.filter(
					(record: { toothNumber: number }) => Number(record.toothNumber) === toothNumber,
				);
				const wholeTooth = toothRecords.find((record: { surface: ToothSurface | null }) => !record.surface) ?? null;
				const surfaces = Object.fromEntries(
					SURFACES.map((surface) => {
						const record = toothRecords.find((entry: { surface: ToothSurface | null }) => entry.surface === surface);
						const inactive = this.isSurfacesInactive(wholeTooth?.conditionCode);
						return [
							surface,
							record
								? {
										recordType: record.recordType,
										conditionCode: record.conditionCode,
										recordedAt: this.iso(record.recordedAt),
										inactive,
									}
								: null,
						];
					}),
				);
				return {
					toothNumber,
					wholeTooth: wholeTooth
						? {
								recordType: wholeTooth.recordType,
								conditionCode: wholeTooth.conditionCode,
								recordedAt: this.iso(wholeTooth.recordedAt),
							}
						: null,
					surfaces,
					surfacesInactive: this.isSurfacesInactive(wholeTooth?.conditionCode),
				};
			});
			await this.recordAudit(manager, actor, 'clinical.odontogram.view', patientId, null, {
				patientId,
			});
			return { patientId, teeth };
		});
	}

	async getToothHistory(patientId: string, toothNumber: number, actor: Actor) {
		if (!Number.isInteger(toothNumber) || toothNumber < 1 || toothNumber > 32)
			throw new BadRequestException('toothNumber must be between 1 and 32');
		return this.dataSource.transaction(async (manager) => {
			await this.requirePatient(manager, patientId);
			const records = await manager
				.getRepository(ToothRecordEntity)
				.createQueryBuilder('record')
				.leftJoinAndSelect('record.patient', 'patient')
				.leftJoinAndSelect('record.recordedBy', 'recordedBy')
				.where('record.patient.id = :patientId AND record.toothNumber = :toothNumber', {
					patientId,
					toothNumber,
				})
				.orderBy('record.recordedAt', 'DESC')
				.addOrderBy('record.id', 'DESC')
				.getMany();
			await this.recordAudit(manager, actor, 'clinical.tooth_history.view', patientId, null, {
				patientId,
				toothNumber,
			});
			return records.map((record) => this.toothRecordView(record, true));
		});
	}

	async createClinicalNote(patientId: string, dto: CreateClinicalNoteDto, actor: Actor) {
		this.assertText(dto.body, 'Clinical note body', 20000);
		return this.dataSource.transaction(async (manager) => {
			await this.requirePatient(manager, patientId);
			if (dto.appointmentId) await this.requirePatientAppointment(manager, patientId, dto.appointmentId);
			const note = await manager.getRepository(ClinicalNoteEntity).save({
				patient: { id: patientId } as PatientEntity,
				appointment: dto.appointmentId ? ({ id: dto.appointmentId } as AppointmentEntity) : null,
				createdBy: { id: actor.userId } as UserEntity,
			});
			const version = await manager.getRepository(ClinicalNoteVersionEntity).save({
				note: { id: note.id } as ClinicalNoteEntity,
				versionNo: 1,
				body: this.encryption.encrypt(dto.body),
				author: { id: actor.userId } as UserEntity,
			});
			await this.recordAudit(manager, actor, 'clinical.note.create', patientId, note.id, {
				fieldNames: ['body', 'appointmentId'],
				noteId: note.id,
				versionId: version.id,
				...(dto.appointmentId ? { appointmentId: dto.appointmentId } : {}),
			});
			return {
				id: note.id,
				patientId,
				appointmentId: dto.appointmentId ?? null,
				versionNo: 1,
				body: dto.body,
				authorId: actor.userId,
				createdAt: version.createdAt,
			};
		});
	}

	async updateClinicalNote(noteId: string, dto: UpdateClinicalNoteDto, actor: Actor) {
		this.assertText(dto.body, 'Clinical note body', 20000);
		return this.dataSource.transaction(async (manager) => {
			const [note] = await manager.query(
				'SELECT id, patient_id AS "patientId" FROM clinical_notes WHERE id = $1 FOR UPDATE',
				[noteId],
			);
			if (!note) throw new NotFoundException('Clinical note not found');
			const [latest] = await manager.query(
				'SELECT COALESCE(MAX(version_no), 0)::int AS version FROM clinical_note_versions WHERE note_id = $1',
				[noteId],
			);
			const version = await manager.getRepository(ClinicalNoteVersionEntity).save({
				note: { id: noteId } as ClinicalNoteEntity,
				versionNo: Number(latest.version) + 1,
				body: this.encryption.encrypt(dto.body),
				author: { id: actor.userId } as UserEntity,
			});
			await this.recordAudit(manager, actor, 'clinical.note.update', note.patientId, noteId, {
				fieldNames: ['body'],
				noteId,
				versionId: version.id,
			});
			return {
				id: noteId,
				patientId: note.patientId,
				versionNo: version.versionNo,
				body: dto.body,
				authorId: actor.userId,
				createdAt: version.createdAt,
			};
		});
	}

	async listClinicalNotes(patientId: string, actor: Actor) {
		return this.dataSource.transaction(async (manager) => {
			await this.requirePatient(manager, patientId);
			const rows = await manager.query(
				`SELECT note.id AS "noteId", note.appointment_id AS "appointmentId",
								note.created_at AS "createdAt",
								(SELECT COUNT(*)::int FROM clinical_note_versions AS versions
								 WHERE versions.note_id = note.id) AS "versionCount",
								latest.body AS "encryptedBody", latest.author_id AS "authorId",
								author.full_name AS "authorName", latest.created_at AS "versionCreatedAt"
				 FROM clinical_notes AS note
				 JOIN LATERAL (
					 SELECT version_no, body, author_id, created_at
					 FROM clinical_note_versions WHERE note_id = note.id
					 ORDER BY version_no DESC LIMIT 1
				 ) AS latest ON true
				 JOIN users AS author ON author.id = latest.author_id
				 WHERE note.patient_id = $1
				 ORDER BY note.created_at DESC, note.id DESC`,
				[patientId],
			);
			const items = rows.map((row: Record<string, unknown>) => ({
				id: row.noteId,
				appointmentId: row.appointmentId,
				createdAt: row.createdAt,
				body: this.encryption.decrypt(row.encryptedBody as Buffer),
				versionCount: Number(row.versionCount),
				author: { id: row.authorId, name: row.authorName },
			}));
			await this.recordAudit(manager, actor, 'clinical.notes.view', patientId, null, { patientId });
			return items;
		});
	}

	async listClinicalNoteVersions(noteId: string, actor: Actor) {
		return this.dataSource.transaction(async (manager) => {
			const [note] = await manager.query(
				'SELECT patient_id AS "patientId" FROM clinical_notes WHERE id = $1',
				[noteId],
			);
			if (!note) throw new NotFoundException('Clinical note not found');
			const rows = await manager.query(
				`SELECT version.id, version.version_no AS "versionNo", version.body,
								version.author_id AS "authorId", author.full_name AS "authorName",
								version.created_at AS "createdAt"
				 FROM clinical_note_versions AS version
				 JOIN users AS author ON author.id = version.author_id
				 WHERE version.note_id = $1 ORDER BY version.version_no ASC`,
				[noteId],
			);
			await this.recordAudit(manager, actor, 'clinical.note_versions.view', note.patientId, noteId, {
				noteId,
			});
			return rows.map((row: Record<string, unknown>) => ({
				id: row.id,
				versionNo: Number(row.versionNo),
				body: this.encryption.decrypt(row.body as Buffer),
				author: { id: row.authorId, name: row.authorName },
				createdAt: row.createdAt,
			}));
		});
	}

	async createTreatmentPlan(patientId: string, dto: CreateTreatmentPlanDto, actor: Actor) {
		return this.dataSource.transaction(async (manager) => {
			await this.requirePatient(manager, patientId);
			const plan = await manager.getRepository(TreatmentPlanEntity).save({
				patient: { id: patientId } as PatientEntity,
				createdBy: { id: actor.userId } as UserEntity,
			});
			const items = await this.savePlanItems(manager, plan.id, dto.items);
			await this.recordAudit(manager, actor, 'clinical.plan.create', patientId, plan.id, {
				fieldNames: ['items'],
				planId: plan.id,
				itemIds: items.map((item) => item.id),
			});
			return { id: plan.id, patientId, createdAt: plan.createdAt, items: items.map((item) => this.planItemView(item)) };
		});
	}

	async addTreatmentPlanItems(planId: string, dto: CreateTreatmentPlanDto, actor: Actor) {
		return this.dataSource.transaction(async (manager) => {
			const plan = await manager.getRepository(TreatmentPlanEntity).findOne({
				where: { id: planId },
				relations: { patient: true },
			});
			if (!plan) throw new NotFoundException('Treatment plan not found');
			const items = await this.savePlanItems(manager, planId, dto.items);
			await this.recordAudit(manager, actor, 'clinical.plan_item.add', plan.patient.id, planId, {
				fieldNames: ['items'],
				planId,
				itemIds: items.map((item) => item.id),
			});
			return items.map((item) => this.planItemView(item));
		});
	}

	async updateTreatmentPlanItem(
		planId: string,
		itemId: string,
		dto: UpdateTreatmentPlanItemDto,
		actor: Actor,
	) {
		const fieldNames = Object.keys(dto).filter(
			(field) => dto[field as keyof UpdateTreatmentPlanItemDto] !== undefined,
		);
		if (!fieldNames.length) throw new BadRequestException('At least one item field is required');
		return this.dataSource.transaction(async (manager) => {
			const item = await manager.getRepository(TreatmentPlanItemEntity).findOne({
				where: { id: itemId, plan: { id: planId } },
				relations: { plan: { patient: true }, treatmentType: true },
			});
			if (!item) throw new NotFoundException('Treatment plan item not found');
			if (item.status !== PlanStatus.Proposed)
				throw new ConflictException('Only proposed treatment plan items can be edited');
			if (dto.priority !== undefined) item.priority = dto.priority;
			if (dto.description !== undefined)
				item.description = dto.description === null ? null : this.encryption.encrypt(dto.description);
			if (dto.priceCents !== undefined) item.priceCents = String(dto.priceCents);
			const saved = await manager.getRepository(TreatmentPlanItemEntity).save(item);
			await this.recordAudit(
				manager,
				actor,
				'clinical.plan_item.update',
				item.plan.patient.id,
				item.id,
				{ fieldNames, planId, itemId },
			);
			return this.planItemView(saved);
		});
	}

	async updateTreatmentPlanItemStatus(
		planId: string,
		itemId: string,
		status: PlanStatus,
		actor: Actor,
	) {
		return this.dataSource.transaction(async (manager) => {
			const [locked] = await manager.query(
				'SELECT id FROM treatment_plan_items WHERE id = $1 AND plan_id = $2 FOR UPDATE',
				[itemId, planId],
			);
			if (!locked) throw new NotFoundException('Treatment plan item not found');
			const item = await manager.getRepository(TreatmentPlanItemEntity).findOne({
				where: { id: itemId, plan: { id: planId } },
				relations: { plan: { patient: true }, treatmentType: true },
			});
			if (!item) throw new NotFoundException('Treatment plan item not found');
			if (!STATUS_TRANSITIONS[item.status].includes(status))
				throw new ConflictException(`Invalid treatment plan status transition from ${item.status} to ${status}`);
			const fromStatus = item.status;
			item.status = status;
			const saved = await manager.getRepository(TreatmentPlanItemEntity).save(item);
			await this.recordAudit(
				manager,
				actor,
				'clinical.plan_item.status_change',
				item.plan.patient.id,
				item.id,
				{ fieldNames: ['status'], planId, itemId },
			);
			return { ...this.planItemView(saved), fromStatus };
		});
	}

	async listTreatmentPlans(patientId: string, actor: Actor) {
		return this.dataSource.transaction(async (manager) => {
			await this.requirePatient(manager, patientId);
			const plans = await manager.query(
				`SELECT id, patient_id AS "patientId", created_at AS "createdAt", created_by AS "createdById"
				 FROM treatment_plans WHERE patient_id = $1 ORDER BY created_at DESC, id DESC`,
				[patientId],
			);
			const items = await manager.query(
				`SELECT item.id, item.plan_id AS "planId", item.treatment_type_id AS "treatmentTypeId",
								treatment.name AS "treatmentName", item.tooth_number AS "toothNumber",
								item.description, item.price_cents AS "priceCents", item.priority, item.status
				 FROM treatment_plan_items AS item
				 JOIN treatment_types AS treatment ON treatment.id = item.treatment_type_id
				 JOIN treatment_plans AS plan ON plan.id = item.plan_id
				 WHERE plan.patient_id = $1 ORDER BY item.priority, item.id`,
				[patientId],
			);
			const itemsByPlan = new Map<string, Record<string, unknown>[]>();
			for (const row of items as Array<Record<string, unknown>>) {
				const planItems = itemsByPlan.get(row.planId as string) ?? [];
				planItems.push(this.planItemRawView(row));
				itemsByPlan.set(row.planId as string, planItems);
			}
			const result = (plans as Array<Record<string, unknown>>).map((plan) => {
				const planItems = itemsByPlan.get(plan.id as string) ?? [];
				const statusCounts = Object.fromEntries(Object.values(PlanStatus).map((status) => [status, 0])) as Record<PlanStatus, number>;
				for (const item of planItems) statusCounts[item.status as PlanStatus] += 1;
				const totalCents = planItems.reduce(
					(total, item) => total + (item.status === PlanStatus.Declined ? 0 : Number(item.priceCents)),
					0,
				);
				return { ...plan, items: planItems, totalCents, statusCounts };
			});
			await this.recordAudit(manager, actor, 'clinical.plans.view', patientId, null, { patientId });
			return result;
		});
	}

	private async savePlanItems(manager: EntityManager, planId: string, inputs: PlanItemInput[]) {
		const saved: TreatmentPlanItemEntity[] = [];
		for (const input of inputs) {
			const treatment = await manager.getRepository(TreatmentTypeEntity).findOne({
				where: { id: input.treatmentTypeId },
			});
			if (!treatment?.isActive)
				throw new BadRequestException('Treatment plan items require an active treatment type');
			const priceCents = input.priceCents ?? Number(treatment.defaultPriceCents);
			if (!Number.isSafeInteger(priceCents) || priceCents < 0)
				throw new BadRequestException('priceCents must be a non-negative safe integer');
			saved.push(
				await manager.getRepository(TreatmentPlanItemEntity).save({
					plan: { id: planId } as TreatmentPlanEntity,
					treatmentType: treatment,
					toothNumber: input.toothNumber ?? null,
					description:
						input.description == null ? null : this.encryption.encrypt(input.description),
					priceCents: String(priceCents),
					priority: input.priority ?? 2,
					status: PlanStatus.Proposed,
				}),
			);
		}
		return saved;
	}

	private async requirePatient(manager: EntityManager, patientId: string) {
		const patient = await manager.getRepository(PatientEntity).findOne({ where: { id: patientId } });
		if (!patient) throw new NotFoundException('Patient not found');
		return patient;
	}

	private async requirePatientAppointment(
		manager: EntityManager,
		patientId: string,
		appointmentId: string,
	) {
		const appointment = await manager.getRepository(AppointmentEntity).findOne({
			where: { id: appointmentId, patient: { id: patientId } },
		});
		if (!appointment) throw new BadRequestException('Appointment must belong to the same patient');
		return appointment;
	}

	// Shared by the write path and the odontogram read model so the rule cannot drift between them.
	private isSurfacesInactive(conditionCode: string | null | undefined): boolean {
		return conditionCode === ToothConditionCode.Extracted || conditionCode === ToothConditionCode.Missing;
	}

	private async getLatestWholeToothRecord(manager: EntityManager, patientId: string, toothNumber: number) {
		const [record] = await manager.query(
			`SELECT condition_code AS "conditionCode"
			 FROM tooth_records
			 WHERE patient_id = $1 AND tooth_number = $2 AND surface IS NULL AND voided_at IS NULL
			 ORDER BY recorded_at DESC, id DESC
			 LIMIT 1`,
			[patientId, toothNumber],
		);
		return (record as { conditionCode: string } | undefined) ?? null;
	}

	private assertText(value: string, label: string, maxLength: number) {
		if (!value.trim() || value.length > maxLength)
			throw new BadRequestException(`${label} must be non-empty and at most ${maxLength} characters`);
	}

	private async recordAudit(
		manager: EntityManager,
		actor: Actor,
		action: string,
		patientId: string,
		entityId: string | null,
		metadata: Record<string, unknown>,
	) {
		await this.audit.record(
			{
				userId: actor.userId,
				action,
				entityType: 'clinical',
				entityId,
				patientId,
				ip: actor.ip,
				metadata,
			},
			manager,
		);
	}

	private toothRecordView(record: ToothRecordEntity, includeNote: boolean) {
		return {
			id: record.id,
			patientId: record.patient.id,
			toothNumber: record.toothNumber,
			surface: record.surface,
			recordType: record.recordType,
			conditionCode: record.conditionCode,
			...(includeNote ? { note: record.note ? this.encryption.decrypt(record.note) : null } : {}),
			appointmentId: record.appointment?.id ?? null,
			recordedBy: record.recordedBy?.id,
			recordedAt: record.recordedAt,
			voidedAt: record.voidedAt,
			voidReason: record.voidReason,
		};
	}

	private planItemView(item: TreatmentPlanItemEntity) {
		return {
			id: item.id,
			planId: item.plan.id,
			treatmentTypeId: item.treatmentType.id,
			treatmentName: item.treatmentType.name,
			toothNumber: item.toothNumber,
			description: item.description ? this.encryption.decrypt(item.description) : null,
			priceCents: Number(item.priceCents),
			priority: item.priority,
			status: item.status,
		};
	}

	private planItemRawView(item: Record<string, unknown>) {
		return {
			id: item.id,
			treatmentTypeId: item.treatmentTypeId,
			treatmentName: item.treatmentName,
			toothNumber: item.toothNumber,
			description: item.description ? this.encryption.decrypt(item.description as Buffer) : null,
			priceCents: Number(item.priceCents),
			priority: Number(item.priority),
			status: item.status,
		};
	}

	private iso(value: unknown): string {
		return value instanceof Date ? value.toISOString() : String(value);
	}
}
