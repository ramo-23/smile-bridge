import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/enums';
import { AppointmentSchedulerService } from './appointment-scheduler.service';
import { AvailableSlotsQueryDto, NextAvailableQueryDto } from './dto/appointment.dto';

@Controller('scheduling')
@Roles(UserRole.DentistOwner, UserRole.Receptionist)
export class AvailabilityController {
  constructor(private readonly scheduler: AppointmentSchedulerService) {}

  @Get('next-available')
  nextAvailable(@Query() query: NextAvailableQueryDto) {
    return this.scheduler.nextAvailable(query);
  }

  @Get('available-slots')
  availableSlots(@Query() query: AvailableSlotsQueryDto) {
    return this.scheduler.availableSlots(query);
  }
}