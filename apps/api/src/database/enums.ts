export enum UserRole {
  DentistOwner = 'dentist_owner',
  Receptionist = 'receptionist',
}

export enum AppointmentStatus {
  Scheduled = 'scheduled',
  Confirmed = 'confirmed',
  Arrived = 'arrived',
  InProgress = 'in_progress',
  Completed = 'completed',
  Cancelled = 'cancelled',
  NoShow = 'no_show',
}

export enum AppointmentSource {
  Staff = 'staff',
  PatientRequest = 'patient_request',
  WalkIn = 'walk_in',
}

export enum RequestStatus {
  Pending = 'pending',
  Scheduled = 'scheduled',
  Declined = 'declined',
}

export enum MessageKind {
  Confirmation = 'confirmation',
  Reminder = 'reminder',
  RequestOutcome = 'request_outcome',
}

export enum MessageChannel {
  Whatsapp = 'whatsapp',
  Sms = 'sms',
}

export enum MessageStatus {
  Queued = 'queued',
  Sent = 'sent',
  Delivered = 'delivered',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export enum ToothSurface {
  Occlusal = 'occlusal',
  Mesial = 'mesial',
  Distal = 'distal',
  Buccal = 'buccal',
  Lingual = 'lingual',
}

export enum ToothRecordType {
  Finding = 'finding',
  Treatment = 'treatment',
}

export enum PlanStatus {
  Proposed = 'proposed',
  Accepted = 'accepted',
  Done = 'done',
  Declined = 'declined',
}

export enum AttachmentKind {
  Xray = 'xray',
  Photo = 'photo',
  Other = 'other',
}

export enum InvoiceStatus {
  Draft = 'draft',
  Issued = 'issued',
}

export enum PaymentMethod {
  Cash = 'cash',
  Card = 'card',
  Insurance = 'insurance',
}

export enum ClaimStatus {
  Draft = 'draft',
  Submitted = 'submitted',
  Paid = 'paid',
  Rejected = 'rejected',
}

export enum SeverityLevel {
  Mild = 'mild',
  Moderate = 'moderate',
  Severe = 'severe',
}