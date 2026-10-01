import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	ParseArrayPipe,
	ParseUUIDPipe,
	Patch,
	Post,
	Put,
	Query,
	Req,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedRequest } from '../../common/guards/request-context';
import { UserRole } from '../../database/enums';
import { CreateBlockedPeriodDto } from './dto/create-blocked-period.dto';
import { BlockedPeriodFiltersDto } from './dto/blocked-period-filters.dto';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { WorkingHourDto } from './dto/working-hour.dto';
import { ProvidersService } from './providers.service';

@Controller('providers')
export class ProvidersController {
	constructor(private readonly providers: ProvidersService) {}

	@Post()
	@Roles(UserRole.DentistOwner)
	create(@Body() body: CreateProviderDto, @Req() request: AuthenticatedRequest) {
		return this.providers.create(body, this.actor(request));
	}

	@Get()
	list() {
		return this.providers.list();
	}

	@Patch(':id')
	@Roles(UserRole.DentistOwner)
	update(
		@Param('id', new ParseUUIDPipe()) id: string,
		@Body() body: UpdateProviderDto,
		@Req() request: AuthenticatedRequest,
	) {
		return this.providers.update(id, body, this.actor(request));
	}

	@Put(':id/working-hours')
	@Roles(UserRole.DentistOwner)
	replaceWorkingHours(
		@Param('id', new ParseUUIDPipe()) id: string,
		@Body(new ParseArrayPipe({ items: WorkingHourDto })) hours: WorkingHourDto[],
		@Req() request: AuthenticatedRequest,
	) {
		return this.providers.replaceWorkingHours(id, hours, this.actor(request));
	}

	@Get(':id/working-hours')
	workingHours(@Param('id', new ParseUUIDPipe()) id: string) {
		return this.providers.getWorkingHours(id);
	}

	@Post(':id/blocked-periods')
	@Roles(UserRole.DentistOwner)
	createBlockedPeriod(
		@Param('id', new ParseUUIDPipe()) id: string,
		@Body() body: CreateBlockedPeriodDto,
		@Req() request: AuthenticatedRequest,
	) {
		return this.providers.createBlockedPeriod(id, body, this.actor(request));
	}

	@Get(':id/blocked-periods')
	blockedPeriods(
		@Param('id', new ParseUUIDPipe()) id: string,
		@Query() filters: BlockedPeriodFiltersDto,
	) {
		return this.providers.listBlockedPeriods(id, filters);
	}

	@Delete(':id/blocked-periods/:blockId')
	@Roles(UserRole.DentistOwner)
	deleteBlockedPeriod(
		@Param('id', new ParseUUIDPipe()) id: string,
		@Param('blockId', new ParseUUIDPipe()) blockId: string,
		@Req() request: AuthenticatedRequest,
	) {
		return this.providers.deleteBlockedPeriod(id, blockId, this.actor(request));
	}

	private actor(request: AuthenticatedRequest) {
		return { userId: request.user!.id, ip: request.ip ?? null };
	}
}
