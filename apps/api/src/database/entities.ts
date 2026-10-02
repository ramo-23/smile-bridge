import { AuditLogEntity } from '../modules/audit/entities/audit-log.entity';
import { ClaimEntity } from '../modules/claims/entities/claim.entity';
import { ClaimLineEntity } from '../modules/claims/entities/claim-line.entity';
import { ClaimStatusHistoryEntity } from '../modules/claims/entities/claim-status-history.entity';
import { ClinicalNoteEntity } from '../modules/clinical/entities/clinical-note.entity';
import { ClinicalNoteVersionEntity } from '../modules/clinical/entities/clinical-note-version.entity';
import { ToothRecordEntity } from '../modules/clinical/entities/tooth-record.entity';
import { TreatmentPlanEntity } from '../modules/clinical/entities/treatment-plan.entity';
import { TreatmentPlanItemEntity } from '../modules/clinical/entities/treatment-plan-item.entity';
import { AttachmentEntity } from '../modules/files/entities/attachment.entity';
import { CreditNoteEntity } from '../modules/billing/entities/credit-note.entity';
import { DocumentCounterEntity } from '../modules/billing/entities/document-counter.entity';
import { InvoiceEntity } from '../modules/billing/entities/invoice.entity';
import { InvoiceLineEntity } from '../modules/billing/entities/invoice-line.entity';
import { PaymentEntity } from '../modules/billing/entities/payment.entity';
import { PerformedTreatmentEntity } from '../modules/billing/entities/performed-treatment.entity';
import { BookingRequestEntity } from '../modules/booking-requests/entities/booking-request.entity';
import { AllergyEntity } from '../modules/patients/entities/allergy.entity';
import { InsurancePolicyEntity } from '../modules/patients/entities/insurance-policy.entity';
import { MedicalHistoryEntity } from '../modules/patients/entities/medical-history.entity';
import { NextOfKinEntity } from '../modules/patients/entities/next-of-kin.entity';
import { PatientEntity } from '../modules/patients/entities/patient.entity';
import { ProviderEntity } from '../modules/providers/entities/provider.entity';
import { AppointmentEntity } from '../modules/scheduling/entities/appointment.entity';
import { BlockedPeriodEntity } from '../modules/scheduling/entities/blocked-period.entity';
import { TreatmentTypeEntity } from '../modules/scheduling/entities/treatment-type.entity';
import { WorkingHourEntity } from '../modules/scheduling/entities/working-hour.entity';
import { ClinicSettingEntity } from '../modules/settings/entities/clinic-setting.entity';
import { MessageEntity } from '../modules/messaging/entities/message.entity';
import { MessageTemplateEntity } from '../modules/messaging/entities/message-template.entity';
import { SessionEntity } from '../modules/auth/entities/session.entity';
import { UserEntity } from '../modules/users/entities/user.entity';

export const databaseEntities = [
  UserEntity,
  ProviderEntity,
  WorkingHourEntity,
  BlockedPeriodEntity,
  PatientEntity,
  NextOfKinEntity,
  MedicalHistoryEntity,
  AllergyEntity,
  InsurancePolicyEntity,
  TreatmentTypeEntity,
  BookingRequestEntity,
  AppointmentEntity,
  MessageTemplateEntity,
  MessageEntity,
  SessionEntity,
  ToothRecordEntity,
  ClinicalNoteEntity,
  ClinicalNoteVersionEntity,
  TreatmentPlanEntity,
  TreatmentPlanItemEntity,
  AttachmentEntity,
  PerformedTreatmentEntity,
  DocumentCounterEntity,
  InvoiceEntity,
  InvoiceLineEntity,
  PaymentEntity,
  CreditNoteEntity,
  ClaimEntity,
  ClaimLineEntity,
  ClaimStatusHistoryEntity,
  ClinicSettingEntity,
  AuditLogEntity,
];
