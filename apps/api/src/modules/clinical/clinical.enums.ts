export const TOOTH_CONDITION_CODES = [
  'extracted',
  'missing',
  'crown',
  'root_canal',
  'implant',
  'bridge',
  'caries',
  'filling',
  'sealant',
  'fracture',
] as const;

export enum ToothConditionCode {
  Extracted = 'extracted',
  Missing = 'missing',
  Crown = 'crown',
  RootCanal = 'root_canal',
  Implant = 'implant',
  Bridge = 'bridge',
  Caries = 'caries',
  Filling = 'filling',
  Sealant = 'sealant',
  Fracture = 'fracture',
}

export const WHOLE_TOOTH_ONLY_CODES = [
  ToothConditionCode.Extracted,
  ToothConditionCode.Missing,
  ToothConditionCode.Crown,
  ToothConditionCode.RootCanal,
  ToothConditionCode.Implant,
  ToothConditionCode.Bridge,
] as const;

export const SURFACE_CONDITION_CODES = [
  ToothConditionCode.Caries,
  ToothConditionCode.Filling,
  ToothConditionCode.Sealant,
  ToothConditionCode.Fracture,
] as const;