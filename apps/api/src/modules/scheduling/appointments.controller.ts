import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedRequest } from '../../common/guards/request-context';
import { UserRole } from '../../database/enums';
import {
  AppointmentCalendarQueryDto,
  ChangeAppointmentStatusDto,
  CreateAppointmentDto,
  UpdateAppointmentDto,
  WalkInAppointmentDto,
} from './dto/appointment.dto';
import { AppointmentSchedulerService } from './appointment-scheduler.service';

@Controller('appointments')
@Roles(UserRole.DentistOwner, UserRole.Receptionist)
export class AppointmentsController {
  constructor(private readonly scheduler: AppointmentSchedulerService) {}

  @Get()
  list(@Query() filters: AppointmentCalendarQueryDto) {
    return this.scheduler.listCalendar(filters);
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.scheduler.getAppointment(id);
  }

  @Post()
  create(@Body() body: CreateAppointmentDto, @Req() request: AuthenticatedRequest) {
    return this.scheduler.create(body, this.actor(request));
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateAppointmentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scheduler.reschedule(id, body, this.actor(request));
  }

  @Post(':id/status')
  changeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChangeAppointmentStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scheduler.changeStatus(id, body, this.actor(request));
  }

  @Post('walk-in')
  walkIn(@Body() body: WalkInAppointmentDto, @Req() request: AuthenticatedRequest) {
    return this.scheduler.walkIn(body, this.actor(request));
  }

  private actor(request: AuthenticatedRequest) {
    return {
      userId: request.user!.id,
      role: request.user!.role,
      ip: request.ip ?? null,
    };
  }
}