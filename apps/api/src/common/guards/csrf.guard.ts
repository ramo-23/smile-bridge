import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedRequest } from './request-context';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (
      STATE_CHANGING_METHODS.has(request.method) &&
      request.headers['x-requested-with'] !== 'smile-bridge'
    ) {
      throw new ForbiddenException();
    }
    return true;
  }
}
