import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../../common/encryption.service';
import { PhoneNumberService } from '../../common/phone-number.service';
import { UserEntity } from '../users/entities/user.entity';
import { AllergyEntity } from './entities/allergy.entity';
import { InsurancePolicyEntity } from './entities/insurance-policy.entity';
import { MedicalHistoryEntity } from './entities/medical-history.entity';
import { NextOfKinEntity } from './entities/next-of-kin.entity';
import { PatientEntity } from './entities/patient.entity';
import { CreateAllergyDto, UpdateAllergyDto } from './dto/allergy.dto';
import { CreateInsuranceDto, UpdateInsuranceDto } from './dto/insurance.dto';
import { UpdateMedicalHistoryDto } from './dto/medical-history.dto';
import { CreateNextOfKinDto, UpdateNextOfKinDto } from './dto/next-of-kin.dto';
import { PatientSearchDto } from './dto/patient-search.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';

type Actor = { id: string; ip: string | null };
type DuplicateMatch = { id: string; name: string; dateOfBirth: string; phone: string };

@Injectable()
export class PatientsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    private readonly phones: PhoneNumberService,
    @InjectRepository(PatientEntity) private readonly patients: Repository<PatientEntity>,
  ) {}

  async create(dto: CreatePatientDto, actor: Actor) {
    const phone = this.phones.normalize(dto.phone);
    const guardianPhone = dto.guardianPhone ? this.phones.normalize(dto.guardianPhone) : null;
    this.requireGuardian(dto.dateOfBirth, dto.guardianName, guardianPhone);
    return this.dataSource.transaction(async (manager) => {
      const matches = await this.findDuplicates(manager, {
        id: null,
        phone,
        firstName: dto.firstName,
        lastName: dto.lastName,
        dateOfBirth: dto.dateOfBirth,
      });
      if (matches.length && !dto.confirmNotDuplicate) this.throwDuplicate(matches);
      const patient = await manager.getRepository(PatientEntity).save({
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        dateOfBirth: dto.dateOfBirth,
        phoneE164: phone,
        sex: dto.sex ?? null,
        email: dto.email ?? null,
        address: dto.address ?? null,
        guardianName: dto.guardianName ?? null,
        guardianPhone,
        doNotMessage: dto.doNotMessage ?? false,
        createdBy: { id: actor.id } as UserEntity,
      });
      await this.record(manager, actor, 'patient.create', patient.id, patient.id, {
        changedFields: this.providedFields(dto).filter((field) => field !== 'confirmNotDuplicate'),
      });
      return this.patientSummary(patient);
    });
  }

  async search(query: PatientSearchDto) {
    const q = query.q?.trim() || null;
    const nameExpression = `lower(first_name || ' ' || last_name)`;
    const activeFilter = query.includeArchived ? 'true' : 'archived_at IS NULL';
    const pagination = [query.pageSize, (query.page - 1) * query.pageSize];
    let items: Array<Record<string, unknown>>;
    if (!q) {
      items = await this.dataSource.query(
        `SELECT id, patient_number AS "patientNumber",
							first_name || ' ' || last_name AS name,
							date_of_birth AS "dateOfBirth", phone_e164 AS phone,
							count(*) OVER()::int AS total
				 FROM patients WHERE ${activeFilter}
				 ORDER BY lower(last_name), lower(first_name), id
				 LIMIT $1 OFFSET $2`,
        pagination,
      );
    } else {
      const numericQuery = /^[+\d\s().-]+$/.test(q) && /\d/.test(q);
      const phonePrefix = numericQuery ? this.phones.searchPrefix(q) : null;
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const patientNameExpression = `lower(patient.first_name || ' ' || patient.last_name)`;
      const searchParameters: unknown[] = [];
      const wordQueries = words.map((word) => {
        const wordParameter = searchParameters.push(word);
        const substringParameter = searchParameters.push(`%${word}%`);
        return `SELECT id FROM patients
                WHERE ${activeFilter}
                  AND (${nameExpression} LIKE $${substringParameter}
                       OR $${wordParameter} <% ${nameExpression})`;
      });
      const exactNameParameter = searchParameters.push(q);
      const wordsParameter = searchParameters.push(words);
      const prefixOnly = `NOT EXISTS (
        SELECT 1 FROM unnest($${wordsParameter}::text[]) AS input_words(word)
        WHERE NOT EXISTS (
          SELECT 1
          FROM unnest(string_to_array(${patientNameExpression}, ' ')) AS name_words(name_word)
          WHERE name_words.name_word LIKE input_words.word || '%'
        )
      )`;
      const matchingBranches = [
        `SELECT id, relevance, word_similarity FROM name_matches`,
      ];
      if (phonePrefix) {
        const phoneStart = searchParameters.push(phonePrefix);
        const phoneEnd = searchParameters.push(`${phonePrefix}z`);
        const patientNumberPattern = searchParameters.push(`${q}%`);
        matchingBranches.push(
          `SELECT id, 2 AS relevance, NULL::real AS word_similarity FROM patients
           WHERE ${activeFilter} AND phone_e164 >= $${phoneStart} AND phone_e164 < $${phoneEnd}`,
          `SELECT id, 3 AS relevance, NULL::real AS word_similarity FROM patients
           WHERE ${activeFilter} AND patient_number::text LIKE $${patientNumberPattern}`,
        );
      }
      items = await this.dataSource.transaction(async (manager) => {
        await manager.query("SET LOCAL pg_trgm.word_similarity_threshold = 0.5");
        return manager.query(
          `WITH name_match_ids AS (
             ${wordQueries.join('\n INTERSECT \n')}
           ), name_matches AS (
             SELECT patient.id,
                    CASE WHEN ${patientNameExpression} = lower($${exactNameParameter}) THEN 0
                         WHEN ${prefixOnly} THEN 1
                         ELSE 2 END AS relevance,
                    (SELECT min(word_similarity(input_words.word, ${patientNameExpression}))
                     FROM unnest($${wordsParameter}::text[]) AS input_words(word)) AS word_similarity
             FROM name_match_ids AS matches
             JOIN patients AS patient ON patient.id = matches.id
           ), candidate_matches AS (
             ${matchingBranches.join('\n UNION ALL \n')}
           ), ranked_matches AS (
             SELECT id, min(relevance) AS relevance, max(word_similarity) AS word_similarity
             FROM candidate_matches GROUP BY id
           )
           SELECT patient.id, patient.patient_number AS "patientNumber",
                  patient.first_name || ' ' || patient.last_name AS name,
                  patient.date_of_birth AS "dateOfBirth", patient.phone_e164 AS phone,
                  count(*) OVER()::int AS total
           FROM ranked_matches AS matches
           JOIN patients AS patient ON patient.id = matches.id
           ORDER BY matches.relevance, matches.word_similarity DESC NULLS LAST,
                    lower(patient.last_name), lower(patient.first_name), patient.id
           LIMIT $${searchParameters.length + 1} OFFSET $${searchParameters.length + 2}`,
          [...searchParameters, ...pagination],
        );
      });
    }
    return {
      items: items.map((item) =>
        Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'total')),
      ),
      total: Number(items[0]?.total ?? 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getProfile(id: string, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      const patient = await this.findPatient(manager, id, true);
      const nextOfKin = await manager
        .getRepository(NextOfKinEntity)
        .find({ where: { patient: { id } } });
      const allergies = await manager
        .getRepository(AllergyEntity)
        .find({ where: { patient: { id } } });
      const insurancePolicies = await manager
        .getRepository(InsurancePolicyEntity)
        .find({ where: { patient: { id } } });
      const history = await manager
        .getRepository(MedicalHistoryEntity)
        .findOne({ where: { patientId: id } });
      await this.record(manager, actor, 'patient.view', id, id);
      const missing: string[] = [];
      if (!patient.address?.trim()) missing.push('address');
      if (nextOfKin.length === 0) missing.push('nextOfKin');
      if (!history?.confirmedAt) missing.push('medicalHistory');
      return {
        id: patient.id,
        patientNumber: patient.patientNumber,
        firstName: patient.firstName,
        lastName: patient.lastName,
        name: `${patient.firstName} ${patient.lastName}`,
        dateOfBirth: patient.dateOfBirth,
        phone: patient.phoneE164,
        sex: patient.sex,
        email: patient.email,
        address: patient.address,
        guardianName: patient.guardianName,
        guardianPhone: patient.guardianPhone,
        doNotMessage: patient.doNotMessage,
        archivedAt: patient.archivedAt,
        createdAt: patient.createdAt,
        updatedAt: patient.updatedAt,
        nextOfKin: nextOfKin.map((kin) => this.nextOfKinView(kin)),
        allergies: allergies.map((allergy) => this.allergyView(allergy)),
        insurancePolicies: insurancePolicies.map((policy) => this.insuranceView(policy)),
        profileStatus: { complete: missing.length === 0, missing },
      };
    });
  }

  async update(id: string, dto: UpdatePatientDto, actor: Actor) {
    const fields = this.providedFields(dto);
    if (!fields.length) throw new BadRequestException('At least one patient field is required');
    return this.dataSource.transaction(async (manager) => {
      const patient = await this.findPatient(manager, id);
      const values = { ...dto };
      if (dto.phone !== undefined) values.phone = this.phones.normalize(dto.phone);
      if (dto.guardianPhone) values.guardianPhone = this.phones.normalize(dto.guardianPhone);
      const firstName = values.firstName ?? patient.firstName;
      const lastName = values.lastName ?? patient.lastName;
      const dateOfBirth = values.dateOfBirth ?? patient.dateOfBirth;
      const guardianName =
        values.guardianName === undefined ? patient.guardianName : values.guardianName;
      const guardianPhone =
        values.guardianPhone === undefined ? patient.guardianPhone : values.guardianPhone;
      this.requireGuardian(dateOfBirth, guardianName, guardianPhone);
      const duplicateKeysChanged =
        (values.firstName !== undefined && values.firstName.trim() !== patient.firstName) ||
        (values.lastName !== undefined && values.lastName.trim() !== patient.lastName) ||
        (values.dateOfBirth !== undefined && values.dateOfBirth !== patient.dateOfBirth) ||
        (values.phone !== undefined && values.phone !== patient.phoneE164);
      if (duplicateKeysChanged) {
        const matches = await this.findDuplicates(manager, {
          id,
          phone: values.phone ?? patient.phoneE164,
          firstName,
          lastName,
          dateOfBirth,
        });
        if (matches.length) this.throwDuplicate(matches);
      }
      if (values.firstName !== undefined) patient.firstName = values.firstName.trim();
      if (values.lastName !== undefined) patient.lastName = values.lastName.trim();
      if (values.dateOfBirth !== undefined) patient.dateOfBirth = values.dateOfBirth;
      if (values.phone !== undefined) patient.phoneE164 = values.phone;
      if (values.sex !== undefined) patient.sex = values.sex;
      if (values.email !== undefined) patient.email = values.email;
      if (values.address !== undefined) patient.address = values.address;
      if (values.guardianName !== undefined) patient.guardianName = values.guardianName;
      if (values.guardianPhone !== undefined) patient.guardianPhone = values.guardianPhone;
      if (values.doNotMessage !== undefined) patient.doNotMessage = values.doNotMessage;
      await manager.getRepository(PatientEntity).save(patient);
      await this.record(manager, actor, 'patient.update', id, id, { changedFields: fields });
      return this.patientSummary(patient);
    });
  }

  async archive(id: string, actor: Actor, restore = false) {
    return this.dataSource.transaction(async (manager) => {
      const patient = await this.findPatient(manager, id, true);
      patient.archivedAt = restore ? null : new Date();
      await manager.getRepository(PatientEntity).save(patient);
      await this.record(manager, actor, restore ? 'patient.restore' : 'patient.archive', id, id);
      return { id: patient.id, archivedAt: patient.archivedAt };
    });
  }

  async createNextOfKin(id: string, dto: CreateNextOfKinDto, actor: Actor) {
    const phone = this.phones.normalize(dto.phone);
    return this.dataSource.transaction(async (manager) => {
      await this.findPatient(manager, id);
      const kin = await manager.getRepository(NextOfKinEntity).save({
        patient: { id } as PatientEntity,
        fullName: dto.fullName,
        relationship: dto.relationship,
        phoneE164: phone,
        isEmergencyContact: dto.isEmergencyContact ?? true,
      });
      await this.record(manager, actor, 'patient.create_next_of_kin', id, kin.id, {
        changedFields: this.providedFields(dto),
      });
      return this.nextOfKinView(kin);
    });
  }

  async updateNextOfKin(id: string, kinId: string, dto: UpdateNextOfKinDto, actor: Actor) {
    const fields = this.providedFields(dto).filter((field) => field !== 'id');
    if (!fields.length) throw new BadRequestException('At least one next-of-kin field is required');
    return this.dataSource.transaction(async (manager) => {
      await this.findPatient(manager, id);
      const repository = manager.getRepository(NextOfKinEntity);
      const kin = await repository.findOne({ where: { id: kinId, patient: { id } } });
      if (!kin) throw new NotFoundException('Next of kin not found');
      if (dto.fullName !== undefined) kin.fullName = dto.fullName;
      if (dto.relationship !== undefined) kin.relationship = dto.relationship;
      if (dto.phone !== undefined) kin.phoneE164 = this.phones.normalize(dto.phone);
      if (dto.isEmergencyContact !== undefined) kin.isEmergencyContact = dto.isEmergencyContact;
      await repository.save(kin);
      await this.record(manager, actor, 'patient.update_next_of_kin', id, kin.id, {
        changedFields: fields,
      });
      return this.nextOfKinView(kin);
    });
  }

  async deleteNextOfKin(id: string, kinId: string, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      await this.findPatient(manager, id);
      const repository = manager.getRepository(NextOfKinEntity);
      const kin = await repository.findOne({ where: { id: kinId, patient: { id } } });
      if (!kin) throw new NotFoundException('Next of kin not found');
      await repository.remove(kin);
      await this.record(manager, actor, 'patient.delete_next_of_kin', id, kin.id);
      return { success: true };
    });
  }

  async createAllergy(id: string, dto: CreateAllergyDto, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      await this.findPatient(manager, id);
      const allergy = await manager.getRepository(AllergyEntity).save({
        patient: { id } as PatientEntity,
        substance: dto.substance,
        reaction: dto.reaction ?? null,
        severity: dto.severity,
      });
      await this.record(manager, actor, 'patient.create_allergy', id, allergy.id, {
        changedFields: this.providedFields(dto),
      });
      return this.allergyView(allergy);
    });
  }

  async updateAllergy(id: string, allergyId: string, dto: UpdateAllergyDto, actor: Actor) {
    const fields = this.providedFields(dto).filter((field) => field !== 'id');
    if (!fields.length) throw new BadRequestException('At least one allergy field is required');
    return this.dataSource.transaction(async (manager) => {
      await this.findPatient(manager, id);
      const repository = manager.getRepository(AllergyEntity);
      const allergy = await repository.findOne({ where: { id: allergyId, patient: { id } } });
      if (!allergy) throw new NotFoundException('Allergy not found');
      if (dto.substance !== undefined) allergy.substance = dto.substance;
      if (dto.reaction !== undefined) allergy.reaction = dto.reaction;
      if (dto.severity !== undefined) allergy.severity = dto.severity;
      if (dto.resolved !== undefined) allergy.resolvedAt = dto.resolved ? new Date() : null;
      await repository.save(allergy);
      await this.record(manager, actor, 'patient.update_allergy', id, allergy.id, {
        changedFields: fields,
      });
      return this.allergyView(allergy);
    });
  }

  async createInsurance(id: string, dto: CreateInsuranceDto, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      await this.findPatient(manager, id);
      const policy = await manager.getRepository(InsurancePolicyEntity).save({
        patient: { id } as PatientEntity,
        insurerName: dto.insurerName,
        policyNumber: dto.policyNumber,
        principalMemberName: dto.principalMemberName,
        planName: dto.planName ?? null,
        isActive: true,
      });
      await this.record(manager, actor, 'patient.create_insurance', id, policy.id, {
        changedFields: this.providedFields(dto),
      });
      return this.insuranceView(policy);
    });
  }

  async updateInsurance(id: string, policyId: string, dto: UpdateInsuranceDto, actor: Actor) {
    const fields = this.providedFields(dto).filter((field) => field !== 'id');
    if (!fields.length) throw new BadRequestException('At least one insurance field is required');
    return this.dataSource.transaction(async (manager) => {
      await this.findPatient(manager, id);
      const repository = manager.getRepository(InsurancePolicyEntity);
      const policy = await repository.findOne({ where: { id: policyId, patient: { id } } });
      if (!policy) throw new NotFoundException('Insurance policy not found');
      if (dto.insurerName !== undefined) policy.insurerName = dto.insurerName;
      if (dto.policyNumber !== undefined) policy.policyNumber = dto.policyNumber;
      if (dto.principalMemberName !== undefined)
        policy.principalMemberName = dto.principalMemberName;
      if (dto.planName !== undefined) policy.planName = dto.planName;
      if (dto.isActive !== undefined) policy.isActive = dto.isActive;
      await repository.save(policy);
      await this.record(manager, actor, 'patient.update_insurance', id, policy.id, {
        changedFields: fields,
      });
      return this.insuranceView(policy);
    });
  }

  async getMedicalHistory(id: string, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      await this.findPatient(manager, id, true);
      const history = await manager.getRepository(MedicalHistoryEntity).findOne({
        where: { patientId: id },
        relations: { confirmedBy: true },
      });
      await this.record(manager, actor, 'patient.view_medical_history', id, id);
      return {
        conditions: history?.conditions ? this.encryption.decrypt(history.conditions) : null,
        medications: history?.medications ? this.encryption.decrypt(history.medications) : null,
        notes: history?.notes ? this.encryption.decrypt(history.notes) : null,
        confirmedAt: history?.confirmedAt ?? null,
        confirmedBy: history?.confirmedBy
          ? { id: (history.confirmedBy as unknown as UserEntity).id }
          : null,
        updatedAt: history?.updatedAt ?? null,
      };
    });
  }

  async updateMedicalHistory(id: string, dto: UpdateMedicalHistoryDto, actor: Actor) {
    const fields = this.providedFields(dto);
    if (!fields.length)
      throw new BadRequestException('At least one medical-history field is required');
    return this.dataSource.transaction(async (manager) => {
      await this.findPatient(manager, id);
      const repository = manager.getRepository(MedicalHistoryEntity);
      const history =
        (await repository.findOne({ where: { patientId: id } })) ??
        repository.create({ patientId: id });
      if (dto.conditions !== undefined)
        history.conditions =
          dto.conditions === null ? null : this.encryption.encrypt(dto.conditions);
      if (dto.medications !== undefined)
        history.medications =
          dto.medications === null ? null : this.encryption.encrypt(dto.medications);
      if (dto.notes !== undefined)
        history.notes = dto.notes === null ? null : this.encryption.encrypt(dto.notes);
      history.confirmedAt = null;
      history.confirmedBy = null;
      await repository.save(history);
      await this.record(manager, actor, 'patient.update_medical_history', id, id, {
        changedFields: fields,
      });
      return {
        conditions: dto.conditions === undefined ? undefined : dto.conditions,
        medications: dto.medications === undefined ? undefined : dto.medications,
        notes: dto.notes === undefined ? undefined : dto.notes,
        confirmedAt: null,
      };
    });
  }

  async confirmMedicalHistory(id: string, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      await this.findPatient(manager, id);
      const repository = manager.getRepository(MedicalHistoryEntity);
      const history = await repository.findOne({ where: { patientId: id } });
      if (!history)
        throw new BadRequestException('Medical history must be entered before confirmation');
      history.confirmedAt = new Date();
      history.confirmedBy = { id: actor.id } as UserEntity;
      await repository.save(history);
      await this.record(manager, actor, 'patient.confirm_medical_history', id, id);
      return { patientId: id, confirmedAt: history.confirmedAt };
    });
  }

  private async findPatient(manager: EntityManager, id: string, allowArchived = false) {
    const patient = await manager.getRepository(PatientEntity).findOne({ where: { id } });
    if (!patient) throw new NotFoundException('Patient not found');
    if (!allowArchived && patient.archivedAt)
      throw new ConflictException('Archived patients cannot be edited');
    return patient;
  }

  private async findDuplicates(
    manager: EntityManager,
    patient: {
      id: string | null;
      phone: string;
      firstName: string;
      lastName: string;
      dateOfBirth: string;
    },
  ): Promise<DuplicateMatch[]> {
    const rows = await manager.query(
      `SELECT id, first_name, last_name, date_of_birth, phone_e164
			 FROM patients
			 WHERE archived_at IS NULL AND ($1::uuid IS NULL OR id <> $1)
				 AND (phone_e164 = $2 OR
							(lower(first_name) = lower($3) AND lower(last_name) = lower($4)
							 AND date_of_birth = $5::date))
			 ORDER BY lower(last_name), lower(first_name), id`,
      [
        patient.id,
        patient.phone,
        patient.firstName.trim(),
        patient.lastName.trim(),
        patient.dateOfBirth,
      ],
    );
    return rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      name: `${row.first_name} ${row.last_name}`,
      dateOfBirth: String(row.date_of_birth),
      phone: String(row.phone_e164),
    }));
  }

  private throwDuplicate(matches: DuplicateMatch[]): never {
    throw new ConflictException({ message: 'Possible duplicate patient found', matches });
  }

  private providedFields(value: object): string[] {
    return Object.entries(value)
      .filter(([, fieldValue]) => fieldValue !== undefined)
      .map(([field]) => field);
  }

  private requireGuardian(
    dateOfBirth: string,
    guardianName: string | null | undefined,
    guardianPhone: string | null | undefined,
  ): void {
    const now = new Date();
    const [birthYear, birthMonth, birthDay] = dateOfBirth.split('-').map(Number);
    let age = now.getUTCFullYear() - birthYear!;
    if (
      now.getUTCMonth() + 1 < birthMonth! ||
      (now.getUTCMonth() + 1 === birthMonth! && now.getUTCDate() < birthDay!)
    )
      age -= 1;
    if (age < 18 && (!guardianName?.trim() || !guardianPhone)) {
      throw new BadRequestException('Guardian name and phone are required for patients under 18');
    }
  }

  private record(
    manager: EntityManager,
    actor: Actor,
    action: string,
    patientId: string,
    entityId: string | null,
    metadata: Record<string, unknown> = {},
    entityType = 'patient',
  ): Promise<void> {
    return this.audit.record(
      {
        userId: actor.id,
        action,
        entityType,
        entityId,
        patientId,
        ip: actor.ip,
        metadata,
      },
      manager,
    );
  }

  private patientSummary(patient: PatientEntity) {
    return {
      id: patient.id,
      patientNumber: patient.patientNumber,
      name: `${patient.firstName} ${patient.lastName}`,
      dateOfBirth: patient.dateOfBirth,
      phone: patient.phoneE164,
    };
  }

  private nextOfKinView(kin: NextOfKinEntity) {
    return {
      id: kin.id,
      fullName: kin.fullName,
      relationship: kin.relationship,
      phone: kin.phoneE164,
      isEmergencyContact: kin.isEmergencyContact,
    };
  }

  private allergyView(allergy: AllergyEntity) {
    return {
      id: allergy.id,
      substance: allergy.substance,
      reaction: allergy.reaction,
      severity: allergy.severity,
      resolvedAt: allergy.resolvedAt,
    };
  }

  private insuranceView(policy: InsurancePolicyEntity) {
    return {
      id: policy.id,
      insurerName: policy.insurerName,
      policyNumber: policy.policyNumber,
      principalMemberName: policy.principalMemberName,
      planName: policy.planName,
      isActive: policy.isActive,
    };
  }
}
