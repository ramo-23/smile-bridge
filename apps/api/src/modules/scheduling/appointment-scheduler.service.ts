import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DateTime } from 'luxon';
import { DataSource, EntityManager, IsNull, QueryFailedError, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { PatientEntity } from '../patients/entities/patient.entity';
import { ProviderEntity } from '../providers/entities/provider.entity';
import { ClinicSettingEntity } from '../settings/entities/clinic-setting.entity';
import { AppointmentSource, AppointmentStatus, UserRole } from '../../database/enums';
import { AppointmentEntity } from './entities/appointment.entity';
import { BlockedPeriodEntity } from './entities/blocked-period.entity';
import { TreatmentTypeEntity } from './entities/treatment-type.entity';
import { WorkingHourEntity } from './entities/working-hour.entity';
import {
  AppointmentCalendarQueryDto,
  ChangeAppointmentStatusDto,
  CreateAppointmentDto,
  NextAvailableQueryDto,
  UpdateAppointmentDto,
  WalkInAppointmentDto,
} from './dto/appointment.dto';

type Actor = { userId: string; role: UserRole; ip: string | null };
type SlotRequest = {
  patientId: string | null;
  providerId: string;
  treatmentTypeId: string;
  startsAt: DateTime;
  durationMinutes?: number;
  durationOverrideReason?: string | null;
  excludeAppointmentId?: string;
  notes?: string | null;
};
type TimedRange = { startsAt: DateTime; endsAt: DateTime };
type AppointmentRange = TimedRange & { id: string; blockedUntil: DateTime };
type SlotContext = {
  patient: PatientEntity | null;
  provider: ProviderEntity | null;
  treatment: TreatmentTypeEntity | null;
  settings: ClinicSettingEntity | null;
  workingHours: Array<{ weekday: number; startTime: string; endTime: string }>;
  blockedPeriods: TimedRange[];
  appointments: AppointmentRange[];
};
type ValidatedSlot = {
  startsAt: DateTime;
  endsAt: DateTime;
  blockedUntil: DateTime;
  durationMinutes: number;
  durationOverrideReason: string | null;
};

const LIVE_STATUSES = [
  AppointmentStatus.Scheduled,
  AppointmentStatus.Confirmed,
  AppointmentStatus.Arrived,
  AppointmentStatus.InProgress,
];
const TERMINAL_STATUSES = [
  AppointmentStatus.Completed,
  AppointmentStatus.Cancelled,
  AppointmentStatus.NoShow,
];

@Injectable()
export class AppointmentSchedulerService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AppointmentEntity)
    private readonly appointments: Repository<AppointmentEntity>,
    @InjectRepository(PatientEntity)
    private readonly patients: Repository<PatientEntity>,
    @InjectRepository(ProviderEntity)
    private readonly providers: Repository<ProviderEntity>,
    @InjectRepository(TreatmentTypeEntity)
    private readonly treatmentTypes: Repository<TreatmentTypeEntity>,
    @InjectRepository(WorkingHourEntity)
    private readonly workingHours: Repository<WorkingHourEntity>,
    @InjectRepository(BlockedPeriodEntity)
    private readonly blockedPeriods: Repository<BlockedPeriodEntity>,
    @InjectRepository(ClinicSettingEntity)
    private readonly clinicSettings: Repository<ClinicSettingEntity>,
    private readonly audit: AuditService,
  ) {}

  async listCalendar(filters: AppointmentCalendarQueryDto) {
    const from = this.parseOffsetTimestamp(filters.from);
    const to = this.parseOffsetTimestamp(filters.to);
    if (to <= from) throw new BadRequestException('Calendar to must be after from');
    if (to.diff(from, 'days').days > 31)
      throw new BadRequestException('Calendar range cannot exceed 31 days');

    const query = this.appointments
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.patient', 'patient')
      .leftJoinAndSelect('appointment.treatmentType', 'treatmentType')
      .leftJoinAndSelect('appointment.provider', 'provider')
      .where('appointment.startsAt >= :from AND appointment.startsAt < :to', {
        from: from.toUTC().toJSDate(),
        to: to.toUTC().toJSDate(),
      });
    if (filters.providerId) query.andWhere('provider.id = :providerId', { providerId: filters.providerId });
    if (filters.status) query.andWhere('appointment.status = :status', { status: filters.status });
    const rows = await query.orderBy('appointment.startsAt', 'ASC').addOrderBy('appointment.id', 'ASC').getMany();
    const timezone = await this.getTimezone();
    return rows.map((appointment) => this.calendarView(appointment, timezone));
  }

  async getAppointment(id: string) {
    const appointment = await this.findAppointment(this.dataSource.manager, id);
    const timezone = await this.getTimezone();
    return this.detailView(appointment, timezone);
  }

  async create(dto: CreateAppointmentDto, actor: Actor) {
    const request = this.slotRequest(dto);
    const suppliedFields = this.suppliedFields(dto as unknown as Record<string, unknown>);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.lockProvider(manager, request.providerId);
        const context = await this.loadSlotContext(manager, request, request.startsAt);
        const validation = this.validateSlot(context, request);
        if (!validation.slot) throw this.slotConflict(validation.reason!, context, request);
        const appointment = await this.persistAppointment(
          manager,
          request,
          validation.slot,
          actor,
          AppointmentSource.Staff,
          AppointmentStatus.Scheduled,
        );
        await this.record(
          manager,
          actor,
          'appointment.create',
          appointment.id,
          appointment.patient.id,
          suppliedFields,
        );
        return this.detailView(appointment, context.settings!.timezone);
      });
    } catch (error) {
      if (this.isExclusionViolation(error)) {
        throw await this.exclusionConflict(request);
      }
      throw error;
    }
  }

  async reschedule(id: string, dto: UpdateAppointmentDto, actor: Actor) {
    const original = await this.findAppointment(this.dataSource.manager, id);
    if (![AppointmentStatus.Scheduled, AppointmentStatus.Confirmed].includes(original.status))
      throw new ConflictException('Only scheduled or confirmed appointments can be rescheduled');

    const targetProviderId = dto.providerId ?? original.provider.id;
    const startsAt = dto.startsAt
      ? this.parseOffsetTimestamp(dto.startsAt)
      : DateTime.fromJSDate(original.startsAt, { zone: 'utc' });
    const durationMinutes =
      dto.durationMinutes ??
      Math.round((original.endsAt.getTime() - original.startsAt.getTime()) / 60_000);
    const durationOverrideReason =
      dto.durationOverrideReason === undefined
        ? original.durationOverrideReason
        : dto.durationOverrideReason;
    const request: SlotRequest = {
      patientId: original.patient.id,
      providerId: targetProviderId,
      treatmentTypeId: original.treatmentType.id,
      startsAt,
      durationMinutes,
      durationOverrideReason,
      excludeAppointmentId: id,
    };
    const requestedFields = Object.keys(dto).filter(
      (field) => dto[field as keyof UpdateAppointmentDto] !== undefined,
    );
    if (!requestedFields.length) throw new BadRequestException('At least one appointment field is required');

    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.lockProvider(manager, targetProviderId);
        const appointment = await this.findAppointment(manager, id, true);
        if (![AppointmentStatus.Scheduled, AppointmentStatus.Confirmed].includes(appointment.status))
          throw new ConflictException('Only scheduled or confirmed appointments can be rescheduled');
        if (!dto.providerId && appointment.provider.id !== targetProviderId)
          throw new ConflictException('Appointment provider changed; retry the reschedule');

        const context = await this.loadSlotContext(manager, request, startsAt);
        const validation = this.validateSlot(context, request);
        if (!validation.slot) throw this.slotConflict(validation.reason!, context, request);

        if (appointment.provider.id !== targetProviderId)
          appointment.provider = { id: targetProviderId } as ProviderEntity;
        if (dto.notes !== undefined) appointment.notes = dto.notes ?? null;
        appointment.startsAt = validation.slot.startsAt.toUTC().toJSDate();
        appointment.endsAt = validation.slot.endsAt.toUTC().toJSDate();
        appointment.blockedUntil = validation.slot.blockedUntil.toUTC().toJSDate();
        appointment.durationOverrideReason = validation.slot.durationOverrideReason;
        const saved = await manager.getRepository(AppointmentEntity).save(appointment);
        await this.record(
          manager,
          actor,
          'appointment.update',
          saved.id,
          saved.patient.id,
          requestedFields,
        );
        return this.detailView(saved, context.settings!.timezone);
      });
    } catch (error) {
      if (this.isExclusionViolation(error)) throw await this.exclusionConflict(request);
      throw error;
    }
  }

  async changeStatus(id: string, dto: ChangeAppointmentStatusDto, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      const appointment = await this.findAppointment(manager, id, true);
      await this.assertTransition(manager, appointment, dto.status, actor.role);
      const fromStatus = appointment.status;
      appointment.status = dto.status;
      if (dto.status === AppointmentStatus.Cancelled && dto.reason !== undefined)
        appointment.cancelReason = dto.reason;
      const saved = await manager.getRepository(AppointmentEntity).save(appointment);
      await this.audit.record(
        {
          userId: actor.userId,
          action: 'appointment.status_change',
          entityType: 'appointment',
          entityId: saved.id,
          patientId: saved.patient.id,
          ip: actor.ip,
          metadata: { fromStatus, toStatus: dto.status },
        },
        manager,
      );
      const timezone = await this.getTimezone(manager);
      return this.detailView(saved, timezone);
    });
  }

  async walkIn(dto: WalkInAppointmentDto, actor: Actor) {
    let providerId = dto.providerId;
    if (!providerId) {
      const activeProviders = await this.providers.find({ where: { isActive: true } });
      if (activeProviders.length > 1)
        throw new BadRequestException('providerId is required when multiple providers are active');
      if (activeProviders.length === 0)
        throw this.slotConflict('No active provider is available', this.emptyContext(), {
          patientId: dto.patientId,
          providerId: '',
          treatmentTypeId: dto.treatmentTypeId,
          startsAt: DateTime.utc(),
        });
      providerId = activeProviders[0]!.id;
    }

    const isImmediate = dto.startsAt === undefined;
    const startsAt = isImmediate
      ? this.roundUpToFiveMinutes(DateTime.utc())
      : this.parseOffsetTimestamp(dto.startsAt!);
    const request: SlotRequest = {
      patientId: dto.patientId,
      providerId,
      treatmentTypeId: dto.treatmentTypeId,
      startsAt,
      ...(dto.durationMinutes === undefined ? {} : { durationMinutes: dto.durationMinutes }),
      ...(dto.durationOverrideReason === undefined
        ? {}
        : { durationOverrideReason: dto.durationOverrideReason }),
    };
    const suppliedFields = this.suppliedFields(dto as unknown as Record<string, unknown>);

    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.lockProvider(manager, providerId!);
        const context = await this.loadSlotContext(manager, request, startsAt);
        const validation = this.validateSlot(context, request);
        if (!validation.slot) throw this.slotConflict(validation.reason!, context, request);
        const appointment = await this.persistAppointment(
          manager,
          request,
          validation.slot,
          actor,
          AppointmentSource.WalkIn,
          isImmediate ? AppointmentStatus.Arrived : AppointmentStatus.Scheduled,
        );
        await this.record(
          manager,
          actor,
          'appointment.walk_in',
          appointment.id,
          appointment.patient.id,
          suppliedFields,
        );
        return this.detailView(appointment, context.settings!.timezone);
      });
    } catch (error) {
      if (this.isExclusionViolation(error)) throw await this.exclusionConflict(request);
      throw error;
    }
  }

  async nextAvailable(query: NextAvailableQueryDto) {
    const from = this.parseOffsetTimestamp(query.from);
    const contextRequest: SlotRequest = {
      patientId: null,
      providerId: query.providerId,
      treatmentTypeId: query.treatmentTypeId,
      startsAt: from,
        durationOverrideReason: 'slot search',
    };
    const context = await this.loadSlotContext(this.dataSource.manager, contextRequest, from);
    this.assertSearchableContext(context);
    const slots = this.findAvailableSlots(context, contextRequest, from, from.plus({ days: 60 }), query.count);
    return { items: slots };
  }

  async availableSlots(query: {
    providerId: string;
    treatmentTypeId: string;
    date: string;
    durationMinutes?: number;
  }) {
    const settings = await this.clinicSettings.findOne({ where: { id: true } });
    if (!settings) throw new ConflictException({ message: 'Clinic settings are not configured', alternatives: [] });
    const date = DateTime.fromISO(query.date, { zone: settings.timezone });
    if (!date.isValid || date.toISODate() !== query.date)
      throw new BadRequestException('date must be a valid local calendar date');
    const from = date.startOf('day');
    const to = from.plus({ days: 1 });
    const contextRequest: SlotRequest = {
      patientId: null,
      providerId: query.providerId,
      treatmentTypeId: query.treatmentTypeId,
      startsAt: from,
        ...(query.durationMinutes === undefined ? {} : { durationMinutes: query.durationMinutes }),
      durationOverrideReason: 'slot search',
    };
    const context = await this.loadSlotContext(this.dataSource.manager, contextRequest, from, to);
    this.assertSearchableContext(context);
    return { date: query.date, items: this.findAvailableSlots(context, contextRequest, from, to) };
  }

  private async persistAppointment(
    manager: EntityManager,
    request: SlotRequest,
    slot: ValidatedSlot,
    actor: Actor,
    source: AppointmentSource,
    status: AppointmentStatus,
  ) {
    const context = await this.loadReferences(manager, request);
    return manager.getRepository(AppointmentEntity).save({
      patient: context.patient!,
      provider: context.provider!,
      treatmentType: context.treatment!,
      startsAt: slot.startsAt.toUTC().toJSDate(),
      endsAt: slot.endsAt.toUTC().toJSDate(),
      blockedUntil: slot.blockedUntil.toUTC().toJSDate(),
      status,
      source,
      bookingRequest: null,
      durationOverrideReason: slot.durationOverrideReason,
      cancelReason: null,
      notes: request.notes ?? null,
      createdBy: { id: actor.userId },
    });
  }

  private async loadSlotContext(
    manager: EntityManager,
    request: SlotRequest,
    windowStart: DateTime,
    windowEnd = windowStart.plus({ days: 60, hours: 12 }),
  ): Promise<SlotContext> {
    const patient = request.patientId
      ? await manager.getRepository(PatientEntity).findOne({
          where: { id: request.patientId, archivedAt: IsNull() },
        })
      : null;
    const provider = await manager.getRepository(ProviderEntity).findOne({
      where: { id: request.providerId },
    });
    const treatment = await manager.getRepository(TreatmentTypeEntity).findOne({
      where: { id: request.treatmentTypeId },
    });
    const settings = await manager.getRepository(ClinicSettingEntity).findOne({ where: { id: true } });
    const workingHours = await manager.query(
      `SELECT weekday, to_char(start_time, 'HH24:MI') AS "startTime",
              to_char(end_time, 'HH24:MI') AS "endTime"
       FROM working_hours WHERE provider_id = $1 ORDER BY weekday, start_time`,
      [request.providerId],
    );
    const blockedRows = await manager.query(
      `SELECT lower(during) AS "startsAt", upper(during) AS "endsAt"
       FROM blocked_periods
       WHERE provider_id = $1
         AND during && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
      [request.providerId, windowStart.toUTC().toISO(), windowEnd.toUTC().toISO()],
    );
    const appointmentRows = await manager.query(
      `SELECT id, starts_at AS "startsAt", blocked_until AS "blockedUntil"
       FROM appointments
       WHERE provider_id = $1
         AND status NOT IN ($2, $3)
         AND blocked_until > $4::timestamptz
         AND starts_at < $5::timestamptz
         AND ($6::uuid IS NULL OR id <> $6)`,
      [
        request.providerId,
        AppointmentStatus.Cancelled,
        AppointmentStatus.NoShow,
        windowStart.toUTC().toISO(),
        windowEnd.toUTC().toISO(),
        request.excludeAppointmentId ?? null,
      ],
    );
    return {
      patient,
      provider,
      treatment,
      settings,
      workingHours,
      blockedPeriods: blockedRows.map((row: { startsAt: Date; endsAt: Date }) => ({
        startsAt: DateTime.fromJSDate(row.startsAt, { zone: 'utc' }),
        endsAt: DateTime.fromJSDate(row.endsAt, { zone: 'utc' }),
      })),
      appointments: appointmentRows.map(
        (row: { id: string; startsAt: Date; blockedUntil: Date }) => ({
          id: row.id,
          startsAt: DateTime.fromJSDate(row.startsAt, { zone: 'utc' }),
          endsAt: DateTime.fromJSDate(row.blockedUntil, { zone: 'utc' }),
          blockedUntil: DateTime.fromJSDate(row.blockedUntil, { zone: 'utc' }),
        }),
      ),
    };
  }

  private validateSlot(
    context: SlotContext,
    request: SlotRequest,
  ): { slot?: ValidatedSlot; reason?: string } {
    if (request.patientId && !context.patient) return { reason: 'Patient is missing or archived' };
    if (!context.treatment?.isActive) return { reason: 'Treatment type is inactive or missing' };
    if (!context.provider?.isActive) return { reason: 'Provider is inactive or missing' };
    if (!context.settings) return { reason: 'Clinic settings are not configured' };
    if (!context.workingHours.length) return { reason: 'Provider has no working hours configured' };

    const durationMinutes = request.durationMinutes ?? context.treatment.defaultDurationMinutes;
    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 5 ||
      durationMinutes > 480 ||
      durationMinutes % 5 !== 0
    ) {
      return { reason: 'Duration must be an integer from 5 to 480 minutes on a 5-minute grid' };
    }
    const hasOverride = durationMinutes !== context.treatment.defaultDurationMinutes;
    const overrideReason = request.durationOverrideReason?.trim() || null;
    if (hasOverride && !overrideReason)
      return { reason: 'A duration override reason is required when changing the default duration' };
    if (request.startsAt < DateTime.utc().minus({ minutes: 5 }))
      return { reason: 'Start time cannot be more than 5 minutes in the past' };

    const timezone = context.settings.timezone;
    const startsAt = request.startsAt.setZone(timezone);
    const endsAt = startsAt.plus({ minutes: durationMinutes });
    const blockedUntil = endsAt.plus({ minutes: context.settings.bufferMinutes });
    const weekday = startsAt.weekday % 7;
    const ranges = context.workingHours.filter((range) => range.weekday === weekday);
    let insideRange = false;
    for (const range of ranges) {
      const rangeStart = this.resolveLocalDateTime(startsAt, range.startTime, timezone);
      const rangeEnd = this.resolveLocalDateTime(startsAt, range.endTime, timezone);
      if (
        rangeStart &&
        rangeEnd &&
        startsAt.toMillis() >= rangeStart.toMillis() &&
        blockedUntil.toMillis() <= rangeEnd.toMillis()
      ) {
        insideRange = true;
        break;
      }
    }
    if (!insideRange) return { reason: 'Slot must fit within one working-hours range, including its buffer' };
    if (
      context.blockedPeriods.some(
        (period) => startsAt.toMillis() < period.endsAt.toMillis() && blockedUntil.toMillis() > period.startsAt.toMillis(),
      )
    ) {
      return { reason: 'Slot overlaps a blocked period' };
    }
    if (
      context.appointments.some(
        (appointment) =>
          startsAt.toMillis() < appointment.blockedUntil.toMillis() &&
          blockedUntil.toMillis() > appointment.startsAt.toMillis(),
      )
    ) {
      return { reason: 'Slot overlaps another live appointment or its buffer' };
    }
    return {
      slot: {
        startsAt,
        endsAt,
        blockedUntil,
        durationMinutes,
        durationOverrideReason: hasOverride ? overrideReason : null,
      },
    };
  }

  private slotConflict(reason: string, context: SlotContext, request: SlotRequest) {
    return new ConflictException({
      message: reason,
      alternatives: this.findAvailableSlots(
        context,
        { ...request, durationOverrideReason: request.durationOverrideReason || 'slot alternative' },
        request.startsAt,
        request.startsAt.plus({ days: 14 }),
        3,
        true,
        60,
      ),
    });
  }

  private findAvailableSlots(
    context: SlotContext,
    request: SlotRequest,
    from: DateTime,
    until: DateTime,
    count = 3,
    strictlyAfter = false,
    minGapMinutes = 0,
  ) {
    if (!context.settings || !context.provider?.isActive || !context.treatment?.isActive)
      return [];
    const timezone = context.settings.timezone;
    const firstDate = from.setZone(timezone).startOf('day');
    const lastDate = until.setZone(timezone).startOf('day');
    const slots: Array<{ startsAt: string; endsAt: string }> = [];
    let lastStart: DateTime | null = null;
    const dateCount = Math.min(61, Math.ceil(lastDate.diff(firstDate, 'days').days) + 1);
    for (let dayIndex = 0; dayIndex < dateCount && slots.length < count; dayIndex += 1) {
      const date = firstDate.plus({ days: dayIndex });
      const weekday = date.weekday % 7;
      const ranges = context.workingHours.filter((range) => range.weekday === weekday);
      for (const range of ranges) {
        const [openHour, openMinute] = range.startTime.split(':').map(Number);
        const [closeHour, closeMinute] = range.endTime.split(':').map(Number);
        const openMinutes = openHour! * 60 + openMinute!;
        const closeMinutes = closeHour! * 60 + closeMinute!;
        let minuteOfDay = Math.ceil(openMinutes / 15) * 15;
        for (; minuteOfDay < closeMinutes && slots.length < count; minuteOfDay += 15) {
          const candidate = this.resolveLocalDateTime(
            date,
            `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`,
            timezone,
          );
          if (!candidate || candidate < from || (strictlyAfter && candidate <= from) || candidate >= until)
            continue;
          if (lastStart && candidate.diff(lastStart, 'minutes').minutes < minGapMinutes) continue;
          const validation = this.validateSlot(context, { ...request, startsAt: candidate });
          if (validation.slot) {
            slots.push({
              startsAt: validation.slot.startsAt.toISO({ suppressMilliseconds: true })!,
              endsAt: validation.slot.endsAt.toISO({ suppressMilliseconds: true })!,
            });
            lastStart = validation.slot.startsAt;
          }
        }
      }
    }
    return slots;
  }

  private resolveLocalDateTime(date: DateTime, time: string, timezone: string): DateTime | null {
    const [hour, minute] = time.split(':').map(Number);
    const resolved = DateTime.fromObject(
      { year: date.year, month: date.month, day: date.day, hour, minute, second: 0, millisecond: 0 },
      { zone: timezone },
    );
    if (
      !resolved.isValid ||
      resolved.year !== date.year ||
      resolved.month !== date.month ||
      resolved.day !== date.day ||
      resolved.hour !== hour ||
      resolved.minute !== minute ||
      resolved.getPossibleOffsets().length !== 1
    ) {
      return null;
    }
    return resolved;
  }

  private async lockProvider(manager: EntityManager, providerId: string) {
    await manager.query('SELECT id FROM providers WHERE id = $1 FOR UPDATE', [providerId]);
  }

  private async findAppointment(manager: EntityManager, id: string, lock = false) {
    const query = manager
      .getRepository(AppointmentEntity)
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.patient', 'patient')
      .leftJoinAndSelect('appointment.provider', 'provider')
      .leftJoinAndSelect('appointment.treatmentType', 'treatmentType')
      .where('appointment.id = :id', { id });
    if (lock) query.setLock('pessimistic_write', undefined, ['appointment']);
    const appointment = await query.getOne();
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  private async loadReferences(manager: EntityManager, request: SlotRequest) {
    const patient = await manager
      .getRepository(PatientEntity)
      .findOne({ where: { id: request.patientId!, archivedAt: IsNull() } });
    const provider = await manager
      .getRepository(ProviderEntity)
      .findOne({ where: { id: request.providerId } });
    const treatment = await manager
      .getRepository(TreatmentTypeEntity)
      .findOne({ where: { id: request.treatmentTypeId } });
    if (!patient || !provider || !treatment) throw new ConflictException('Appointment references changed during booking');
    return { patient, provider, treatment };
  }

  private async assertTransition(
    manager: EntityManager,
    appointment: AppointmentEntity,
    next: AppointmentStatus,
    role: UserRole,
  ) {
    const allowed: Record<AppointmentStatus, AppointmentStatus[]> = {
      [AppointmentStatus.Scheduled]: [
        AppointmentStatus.Confirmed,
        AppointmentStatus.Arrived,
        AppointmentStatus.Cancelled,
        AppointmentStatus.NoShow,
      ],
      [AppointmentStatus.Confirmed]: [
        AppointmentStatus.Arrived,
        AppointmentStatus.Cancelled,
        AppointmentStatus.NoShow,
      ],
      [AppointmentStatus.Arrived]: [AppointmentStatus.InProgress],
      [AppointmentStatus.InProgress]: [AppointmentStatus.Completed],
      [AppointmentStatus.Completed]: [],
      [AppointmentStatus.Cancelled]: [],
      [AppointmentStatus.NoShow]: [],
    };
    if (!allowed[appointment.status].includes(next))
      throw new ConflictException(`Invalid appointment transition from ${appointment.status} to ${next}`);
    if (next === AppointmentStatus.Arrived) {
      const settings = await manager
        .getRepository(ClinicSettingEntity)
        .findOne({ where: { id: true } });
      if (!settings) throw new ConflictException('Clinic settings are not configured');
      const today = DateTime.utc().setZone(settings.timezone).toISODate();
      const appointmentDate = DateTime.fromJSDate(appointment.startsAt, { zone: 'utc' })
        .setZone(settings.timezone)
        .toISODate();
      if (today !== appointmentDate) {
        throw new ConflictException('A patient can only be marked as arrived on the day of the appointment');
      }
    }
    if (next === AppointmentStatus.NoShow && DateTime.fromJSDate(appointment.startsAt) >= DateTime.utc())
      throw new ConflictException('An appointment can only be marked no_show after its start time');
    if (
      [AppointmentStatus.InProgress, AppointmentStatus.Completed].includes(next) &&
      role !== UserRole.DentistOwner
    ) {
      throw new ForbiddenException('Only a dentist owner can start or complete an appointment');
    }
  }

  private async exclusionConflict(request: SlotRequest) {
    const context = await this.loadSlotContext(this.dataSource.manager, request, request.startsAt);
    return this.slotConflict('Slot overlaps another live appointment or its buffer', context, request);
  }

  private async record(
    manager: EntityManager,
    actor: Actor,
    action: string,
    id: string,
    patientId: string,
    changedFields: string[],
  ) {
    await this.audit.record(
      {
        userId: actor.userId,
        action,
        entityType: 'appointment',
        entityId: id,
        patientId,
        ip: actor.ip,
        metadata: { changedFields },
      },
      manager,
    );
  }

  private async requireSearchableContext(context: SlotContext) {
    const reason = !context.settings
      ? 'Clinic settings are not configured'
      : !context.provider?.isActive
        ? 'Provider is inactive or missing'
        : !context.treatment?.isActive
          ? 'Treatment type is inactive or missing'
          : !context.workingHours.length
            ? 'Provider has no working hours configured'
            : null;
    if (reason) throw new ConflictException({ message: reason, alternatives: [] });
  }

  private async assertSearchableContext(context: SlotContext) {
    await this.requireSearchableContext(context);
  }

  private emptyContext(): SlotContext {
    return {
      patient: null,
      provider: null,
      treatment: null,
      settings: null,
      workingHours: [],
      blockedPeriods: [],
      appointments: [],
    };
  }

  private slotRequest(dto: CreateAppointmentDto): SlotRequest {
    return {
      patientId: dto.patientId,
      providerId: dto.providerId,
      treatmentTypeId: dto.treatmentTypeId,
      startsAt: this.parseOffsetTimestamp(dto.startsAt),
      durationMinutes: dto.durationMinutes,
      durationOverrideReason: dto.durationOverrideReason,
      notes: dto.notes,
    } as SlotRequest;
  }

  private parseOffsetTimestamp(value: string): DateTime {
    const parsed = DateTime.fromISO(value, { setZone: true });
    if (!parsed.isValid) throw new BadRequestException('Timestamp must be valid ISO 8601 with an offset');
    return parsed.toUTC();
  }

  private roundUpToFiveMinutes(value: DateTime): DateTime {
    return DateTime.fromMillis(Math.ceil(value.toMillis() / 300_000) * 300_000, { zone: 'utc' });
  }

  private isExclusionViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string }).code === '23P01'
    );
  }

  private calendarView(appointment: AppointmentEntity, timezone: string) {
    return {
      id: appointment.id,
      patientId: appointment.patient.id,
      patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
      treatmentName: appointment.treatmentType.name,
      providerId: appointment.provider.id,
      startsAt: this.formatInZone(appointment.startsAt, timezone),
      endsAt: this.formatInZone(appointment.endsAt, timezone),
      blockedUntil: this.formatInZone(appointment.blockedUntil, timezone),
      status: appointment.status,
      source: appointment.source,
    };
  }

  private detailView(appointment: AppointmentEntity, timezone: string) {
    return {
      ...this.calendarView(appointment, timezone),
      treatmentTypeId: appointment.treatmentType.id,
      durationOverrideReason: appointment.durationOverrideReason,
      notes: appointment.notes,
    };
  }

  private formatInZone(date: Date, timezone: string): string {
    return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(timezone).toISO({ suppressMilliseconds: true })!;
  }

  private async getTimezone(manager: EntityManager = this.dataSource.manager): Promise<string> {
    const settings = await manager.getRepository(ClinicSettingEntity).findOne({ where: { id: true } });
    return settings?.timezone ?? 'UTC';
  }

  private suppliedFields(dto: Record<string, unknown>): string[] {
    return Object.keys(dto).filter((field) => dto[field] !== undefined);
  }
}