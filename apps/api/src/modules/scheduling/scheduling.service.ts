import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { CreateTreatmentTypeDto } from './dto/create-treatment-type.dto';
import { TreatmentTypeFiltersDto } from './dto/treatment-type-filters.dto';
import { UpdateTreatmentTypeDto } from './dto/update-treatment-type.dto';
import { TreatmentTypeEntity } from './entities/treatment-type.entity';

type Actor = { userId: string; ip: string | null };

@Injectable()
export class SchedulingService {
	constructor(
		private readonly dataSource: DataSource,
		@InjectRepository(TreatmentTypeEntity)
		private readonly treatmentTypes: Repository<TreatmentTypeEntity>,
		private readonly audit: AuditService,
	) {}

	async createTreatmentType(dto: CreateTreatmentTypeDto, actor: Actor) {
		const values = this.createValues(dto);
		try {
			return await this.dataSource.transaction(async (manager) => {
				await this.lockTreatmentTypeNames(manager);
				await this.assertTreatmentTypeNameAvailable(manager, values.name);
				const changedFields = Object.keys(values);
				const treatmentType = await manager.getRepository(TreatmentTypeEntity).save(values);
				await this.recordTreatmentType(
					manager,
					actor,
					'treatment_type.create',
					treatmentType.id,
					changedFields,
				);
				return this.treatmentTypeView(treatmentType);
			});
		} catch (error) {
			this.throwUniqueConflict(error);
		}
	}

	async listTreatmentTypes(filters: TreatmentTypeFiltersDto) {
		const query = this.treatmentTypes.createQueryBuilder('treatmentType');
		if (filters.activeOnly) query.andWhere('treatmentType.isActive = true');
		if (filters.patientBookable !== undefined)
			query.andWhere('treatmentType.patientBookable = :patientBookable', {
				patientBookable: filters.patientBookable,
			});
		const treatmentTypes = await query.orderBy('lower(treatmentType.name)').getMany();
		return treatmentTypes.map((treatmentType) => this.treatmentTypeView(treatmentType));
	}

	async getTreatmentType(id: string) {
		const treatmentType = await this.treatmentTypes.findOne({ where: { id } });
		if (!treatmentType) throw new NotFoundException('Treatment type not found');
		return this.treatmentTypeView(treatmentType);
	}

	async updateTreatmentType(id: string, dto: UpdateTreatmentTypeDto, actor: Actor) {
		const changedFields = Object.keys(dto).filter(
			(field) => dto[field as keyof UpdateTreatmentTypeDto] !== undefined,
		);
		if (!changedFields.length) throw new BadRequestException('At least one field is required');
		try {
			return await this.dataSource.transaction(async (manager) => {
				const repository = manager.getRepository(TreatmentTypeEntity);
				const treatmentType = await repository.findOne({ where: { id } });
				if (!treatmentType) throw new NotFoundException('Treatment type not found');
				await this.lockTreatmentTypeNames(manager);
				if (dto.name !== undefined) {
					treatmentType.name = dto.name.trim();
					await this.assertTreatmentTypeNameAvailable(manager, treatmentType.name, id);
				}
				if (dto.procedureCode !== undefined) treatmentType.procedureCode = dto.procedureCode;
				if (dto.defaultDurationMinutes !== undefined)
					treatmentType.defaultDurationMinutes = dto.defaultDurationMinutes;
				if (dto.defaultPriceCents !== undefined)
					treatmentType.defaultPriceCents = String(dto.defaultPriceCents);
				if (dto.patientBookable !== undefined) treatmentType.patientBookable = dto.patientBookable;
				if (dto.isActive !== undefined) treatmentType.isActive = dto.isActive;
				const saved = await repository.save(treatmentType);
				await this.recordTreatmentType(
					manager,
					actor,
					'treatment_type.update',
					saved.id,
					changedFields,
				);
				return this.treatmentTypeView(saved);
			});
		} catch (error) {
			this.throwUniqueConflict(error);
		}
	}

	private createValues(dto: CreateTreatmentTypeDto) {
		return {
			name: dto.name.trim(),
			procedureCode: dto.procedureCode ?? null,
			defaultDurationMinutes: dto.defaultDurationMinutes,
			defaultPriceCents: String(dto.defaultPriceCents),
			patientBookable: dto.patientBookable ?? false,
			isActive: dto.isActive ?? true,
		};
	}

	private async lockTreatmentTypeNames(manager: import('typeorm').EntityManager) {
		await manager.query("SELECT pg_advisory_xact_lock(hashtext('treatment_types_name'))");
	}

	private async assertTreatmentTypeNameAvailable(
		manager: import('typeorm').EntityManager,
		name: string,
		exceptId?: string,
	) {
		const [duplicate] = await manager.query(
			`SELECT id FROM treatment_types
			 WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2)
			 LIMIT 1`,
			[name, exceptId ?? null],
		);
		if (duplicate) throw new ConflictException('Treatment type name already exists');
	}

	private async recordTreatmentType(
		manager: import('typeorm').EntityManager,
		actor: Actor,
		action: string,
		id: string,
		changedFields: string[],
	) {
		await this.audit.record(
			{
				userId: actor.userId,
				action,
				entityType: 'treatment_type',
				entityId: id,
				patientId: null,
				ip: actor.ip,
				metadata: { changedFields },
			},
			manager,
		);
	}

	private treatmentTypeView(treatmentType: TreatmentTypeEntity) {
		return { ...treatmentType, defaultPriceCents: Number(treatmentType.defaultPriceCents) };
	}

	private throwUniqueConflict(error: unknown): never {
		if (
			error instanceof QueryFailedError &&
			(error.driverError as { code?: string }).code === '23505'
		) {
			throw new ConflictException('Treatment type name already exists');
		}
		throw error;
	}
}
