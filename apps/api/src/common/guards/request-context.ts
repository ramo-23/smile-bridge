import { Request } from 'express';
import { UserRole } from '../../database/enums';
import { SessionEntity } from '../../modules/auth/entities/session.entity';

export type AuthenticatedUser = {
  id: string;
  name: string;
  role: UserRole;
};

export type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
  authSession?: SessionEntity;
};
