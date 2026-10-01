import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '../../database/enums';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditQueryDto } from './dto/audit-query.dto';
import { AuditService } from './audit.service';

@Controller('audit')
@Roles(UserRole.DentistOwner)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(@Query() query: AuditQueryDto) {
    const result = await this.audit.list({
      ...(query.userId && { userId: query.userId }),
      ...(query.patientId && { patientId: query.patientId }),
      ...(query.action && { action: query.action }),
      ...(query.from && { from: new Date(query.from) }),
      ...(query.to && { to: new Date(query.to) }),
      page: query.page,
      limit: query.limit,
    });
    return { ...result, page: query.page, limit: query.limit };
  }
}
