import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedRequest } from '../../common/guards/request-context';
import { UserRole } from '../../database/enums';
import { CreateTreatmentTypeDto } from './dto/create-treatment-type.dto';
import { TreatmentTypeFiltersDto } from './dto/treatment-type-filters.dto';
import { UpdateTreatmentTypeDto } from './dto/update-treatment-type.dto';
import { SchedulingService } from './scheduling.service';

@Controller('treatment-types')
export class SchedulingController {
	constructor(private readonly scheduling: SchedulingService) {}

	@Post()
	@Roles(UserRole.DentistOwner)
	create(@Body() body: CreateTreatmentTypeDto, @Req() request: AuthenticatedRequest) {
		return this.scheduling.createTreatmentType(body, this.actor(request));
	}

	@Get()
	list(@Query() filters: TreatmentTypeFiltersDto) {
		return this.scheduling.listTreatmentTypes(filters);
	}

	@Get(':id')
	get(@Param('id', new ParseUUIDPipe()) id: string) {
		return this.scheduling.getTreatmentType(id);
	}

	@Patch(':id')
	@Roles(UserRole.DentistOwner)
	update(
		@Param('id', new ParseUUIDPipe()) id: string,
		@Body() body: UpdateTreatmentTypeDto,
		@Req() request: AuthenticatedRequest,
	) {
		return this.scheduling.updateTreatmentType(id, body, this.actor(request));
	}

	private actor(request: AuthenticatedRequest) {
		return { userId: request.user!.id, ip: request.ip ?? null };
	}
}
