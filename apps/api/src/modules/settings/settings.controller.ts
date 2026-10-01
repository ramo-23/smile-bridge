import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedRequest } from '../../common/guards/request-context';
import { UserRole } from '../../database/enums';
import { UpdateClinicSettingsDto } from './dto/update-clinic-settings.dto';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Put()
  @Roles(UserRole.DentistOwner)
  update(@Body() body: UpdateClinicSettingsDto, @Req() request: AuthenticatedRequest) {
    return this.settings.update(body, {
      userId: request.user!.id,
      ip: request.ip ?? null,
    });
  }
}
