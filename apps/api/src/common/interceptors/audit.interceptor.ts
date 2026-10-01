import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mergeMap, Observable } from 'rxjs';
import { AUDITED_KEY } from '../decorators/audited.decorator';
import { AuthenticatedRequest } from '../guards/request-context';
import { AuditService } from '../../modules/audit/audit.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.getAllAndOverride<string>(AUDITED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) return next.handle();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const params = request.params as Record<string, string | undefined>;
    const routeId = params.id ?? params.userId ?? params.patientId ?? null;
    const entityId = routeId && UUID_PATTERN.test(routeId) ? routeId : null;
    const patientId =
      params.patientId && UUID_PATTERN.test(params.patientId) ? params.patientId : null;
    return next.handle().pipe(
      mergeMap(async (result) => {
        await this.audit.record({
          userId: request.user?.id ?? null,
          action,
          entityType: request.route?.path ?? 'route',
          entityId,
          patientId,
          ip: request.ip ?? null,
          metadata: { method: request.method },
        });
        return result;
      }),
    );
  }
}
