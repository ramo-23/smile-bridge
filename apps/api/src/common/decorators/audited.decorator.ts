import { SetMetadata } from '@nestjs/common';

export const AUDITED_KEY = 'audited';
export const Audited = (action: string) => SetMetadata(AUDITED_KEY, action);
