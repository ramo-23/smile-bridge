import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { UserRole } from '../../database/enums';
import { UserEntity } from '../users/entities/user.entity';
import { BlockedPeriodFiltersDto } from './dto/blocked-period-filters.dto';
import { CreateBlockedPeriodDto } from './dto/create-blocked-period.dto';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { WorkingHourDto } from './dto/working-hour.dto';
import { BlockedPeriodEntity } from '../scheduling/entities/blocked-period.entity';
import { WorkingHourEntity } from '../scheduling/entities/working-hour.entity';
import { ProviderEntity } from './entities/provider.entity';

type Actor = { userId: string; ip: string | null };
type WorkingRange = WorkingHourDto & { startMinutes: number; endMinutes: number };

@Injectable()
export class ProvidersService {
	constructor(
		private readonly dataSource: DataSource,
		@InjectRepository(ProviderEntity)
		private readonly providers: Repository<ProviderEntity>,
		@InjectRepository(WorkingHourEntity)
		private readonly workingHours: Repository<WorkingHourEntity>,
		@InjectRepository(BlockedPeriodEntity)
		private readonly blockedPeriods: Repository<BlockedPeriodEntity>,
		@InjectRepository(UserEntity)
		private readonly users: Repository<UserEntity>,
		private readonly audit: AuditService,
	) {}

	async create(dto: CreateProviderDto, actor: Actor) {
		try {
			return await this.dataSource.transaction(async (manager) => {
				const user = await manager.getRepository(UserEntity).findOne({ where: { id: dto.userId } });
				if (!user || !user.isActive || user.role !== UserRole.DentistOwner) {
					throw new BadRequestException('Provider user must be an active dentist owner');
				}
				const existing = await manager
					.getRepository(ProviderEntity)
					.findOne({ where: { user: { id: user.id } } });
				if (existing) throw new ConflictException('User already has a provider profile');
				const provider = await manager.getRepository(ProviderEntity).save({
					user: { id: user.id } as UserEntity,
					displayName: dto.displayName.trim(),
					isActive: true,
				});
				await this.record(manager, actor, 'provider.create', provider.id, ['userId', 'displayName']);
				return this.providerView(provider, user.id);
			});
		} catch (error) {
			if (
				error instanceof QueryFailedError &&
				(error.driverError as { code?: string }).code === '23505'
			) {
				throw new ConflictException('User already has a provider profile');
			}
			throw error;
		}
	}

	async list() {
		const providers = await this.providers.find({
			relations: { user: true },
			order: { displayName: 'ASC' },
		});
		return providers.map((provider) => this.providerView(provider, provider.user.id));
	}

	async update(id: string, dto: UpdateProviderDto, actor: Actor) {
		const changedFields = Object.keys(dto).filter(
			(field) => dto[field as keyof UpdateProviderDto] !== undefined,
		);
		if (!changedFields.length) throw new BadRequestException('At least one provider field is required');
		return this.dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(ProviderEntity);
			const provider = await repository.findOne({ where: { id }, relations: { user: true } });
			if (!provider) throw new NotFoundException('Provider not found');
			if (dto.displayName !== undefined) provider.displayName = dto.displayName.trim();
			if (dto.isActive !== undefined) provider.isActive = dto.isActive;
			const saved = await repository.save(provider);
			await this.record(manager, actor, 'provider.update', saved.id, changedFields);
			return this.providerView(saved, provider.user.id);
		});
	}

	async replaceWorkingHours(id: string, hours: WorkingHourDto[], actor: Actor) {
		const normalized = this.validateWorkingHours(hours);
		return this.dataSource.transaction(async (manager) => {
			await this.requireProvider(manager, id);
			await manager.query('DELETE FROM working_hours WHERE provider_id = $1', [id]);
			for (const hour of normalized) {
				await manager.query(
					`INSERT INTO working_hours (provider_id, weekday, start_time, end_time)
					 VALUES ($1, $2, $3::time, $4::time)`,
					[id, hour.weekday, hour.startTime, hour.endTime],
				);
			}
			await this.record(manager, actor, 'provider.working_hours.replace', id, [
				'weekday',
				'startTime',
				'endTime',
			]);
			return this.getWorkingHoursWithManager(manager, id);
		});
	}

	async getWorkingHours(id: string) {
		await this.requireProvider(this.dataSource.manager, id);
		return this.getWorkingHoursWithManager(this.dataSource.manager, id);
	}

	async createBlockedPeriod(id: string, dto: CreateBlockedPeriodDto, actor: Actor) {
		const startsAt = new Date(dto.startsAt);
		const endsAt = new Date(dto.endsAt);
		const duration = endsAt.getTime() - startsAt.getTime();
		if (duration <= 0) throw new BadRequestException('Blocked period end must be after start');
		if (duration > 90 * 24 * 60 * 60 * 1000)
			throw new BadRequestException('Blocked periods cannot exceed 90 days');
		return this.dataSource.transaction(async (manager) => {
			await this.requireProvider(manager, id);
			const [row] = await manager.query(
				`INSERT INTO blocked_periods (provider_id, during, reason, created_by)
				 VALUES ($1, tstzrange($2::timestamptz, $3::timestamptz, '[)'), $4, $5)
				 RETURNING id, lower(during) AS "startsAt", upper(during) AS "endsAt", reason`,
				[id, startsAt.toISOString(), endsAt.toISOString(), dto.reason ?? null, actor.userId],
			);
			await this.record(manager, actor, 'blocked_period.create', row.id, [
				'startsAt',
				'endsAt',
				'reason',
			]);
			return this.blockedPeriodView(row);
		});
	}

	async listBlockedPeriods(id: string, filters: BlockedPeriodFiltersDto) {
		if (filters.from && filters.to && filters.from > filters.to)
			throw new BadRequestException('from must be on or before to');
		await this.requireProvider(this.dataSource.manager, id);
		const parameters: unknown[] = [id];
		const where = ['provider_id = $1'];
		if (filters.from) {
			parameters.push(filters.from);
			where.push(
				`upper(during) > ($${parameters.length}::date::timestamp AT TIME ZONE 'UTC')`,
			);
		}
		if (filters.to) {
			parameters.push(filters.to);
			where.push(
				`lower(during) < (($${parameters.length}::date + 1)::timestamp AT TIME ZONE 'UTC')`,
			);
		}
		const rows = await this.dataSource.query(
			`SELECT id, lower(during) AS "startsAt", upper(during) AS "endsAt", reason
			 FROM blocked_periods WHERE ${where.join(' AND ')} ORDER BY lower(during), id`,
			parameters,
		);
		return rows.map((row: Record<string, unknown>) => this.blockedPeriodView(row));
	}

	async deleteBlockedPeriod(id: string, blockId: string, actor: Actor) {
		return this.dataSource.transaction(async (manager) => {
			await this.requireProvider(manager, id);
			const [deleted] = await manager.query(
				'DELETE FROM blocked_periods WHERE id = $1 AND provider_id = $2 RETURNING id',
				[blockId, id],
			);
			if (!deleted) throw new NotFoundException('Blocked period not found');
			await this.record(manager, actor, 'blocked_period.delete', blockId, ['blockedPeriodId']);
			return { id: blockId, deleted: true };
		});
	}

	private validateWorkingHours(hours: WorkingHourDto[]): WorkingRange[] {
		const normalized = hours.map((hour) => {
			const [startHour, startMinute] = hour.startTime.split(':').map(Number);
			const [endHour, endMinute] = hour.endTime.split(':').map(Number);
			const startMinutes = startHour! * 60 + startMinute!;
			const endMinutes = endHour! * 60 + endMinute!;
			if (startMinute! % 5 !== 0 || endMinute! % 5 !== 0)
				throw new BadRequestException('Working-hour times must be on the 5-minute grid');
			if (endMinutes <= startMinutes)
				throw new BadRequestException('Working-hour end must be after start');
			return { ...hour, startMinutes, endMinutes };
		});
		const byWeekday = new Map<number, WorkingRange[]>();
		for (const range of normalized) {
			const dayRanges = byWeekday.get(range.weekday) ?? [];
			dayRanges.push(range);
			byWeekday.set(range.weekday, dayRanges);
		}
		for (const dayRanges of byWeekday.values()) {
			dayRanges.sort((left, right) => left.startMinutes - right.startMinutes);
			for (let index = 1; index < dayRanges.length; index += 1) {
				if (dayRanges[index]!.startMinutes <= dayRanges[index - 1]!.endMinutes)
					throw new BadRequestException('Working-hour ranges cannot overlap or touch');
			}
		}
		return normalized;
	}

	private async getWorkingHoursWithManager(manager: EntityManager, id: string) {
		return manager.query(
			`SELECT weekday, to_char(start_time, 'HH24:MI') AS "startTime",
							to_char(end_time, 'HH24:MI') AS "endTime"
			 FROM working_hours WHERE provider_id = $1 ORDER BY weekday, start_time`,
			[id],
		);
	}

	private async requireProvider(manager: EntityManager, id: string) {
		const provider = await manager.getRepository(ProviderEntity).findOne({ where: { id } });
		if (!provider) throw new NotFoundException('Provider not found');
		return provider;
	}

	private providerView(provider: ProviderEntity, userId: string) {
		return { id: provider.id, userId, displayName: provider.displayName, isActive: provider.isActive };
	}

	private blockedPeriodView(row: Record<string, unknown>) {
		return {
			id: String(row.id),
			startsAt: new Date(row.startsAt as string | Date).toISOString(),
			endsAt: new Date(row.endsAt as string | Date).toISOString(),
			reason: row.reason,
		};
	}

	private record(
		manager: EntityManager,
		actor: Actor,
		action: string,
		entityId: string,
		changedFields: string[],
	) {
		return this.audit.record(
			{
				userId: actor.userId,
				action,
				entityType: action.startsWith('blocked_period') ? 'blocked_period' : 'provider',
				entityId,
				patientId: null,
				ip: actor.ip,
				metadata: { changedFields },
			},
			manager,
		);
	}
}
