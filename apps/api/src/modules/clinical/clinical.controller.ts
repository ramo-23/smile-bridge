import {
	Body,
	Controller,
	Get,
	Param,
	ParseIntPipe,
	ParseUUIDPipe,
	Patch,
	Post,
	Put,
	Req,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedRequest } from '../../common/guards/request-context';
import { UserRole } from '../../database/enums';
import {
	CreateClinicalNoteDto,
	CreateToothRecordDto,
	CreateTreatmentPlanDto,
	UpdateClinicalNoteDto,
	UpdateTreatmentPlanItemDto,
	UpdateTreatmentPlanItemStatusDto,
	VoidToothRecordDto,
} from './dto/clinical.dto';
import { ClinicalService } from './clinical.service';

@Controller()
@Roles(UserRole.DentistOwner, UserRole.Receptionist)
export class ClinicalController {
	constructor(private readonly clinical: ClinicalService) {}

	@Post('patients/:id/tooth-records')
	@Roles(UserRole.DentistOwner)
	addToothRecord(
		@Param('id', new ParseUUIDPipe()) patientId: string,
		@Body() body: CreateToothRecordDto,
		@Req() request: AuthenticatedRequest,
	) {
		return this.clinical.addToothRecord(patientId, body, this.actor(request));
	}

	@Post('tooth-records/:recordId/void')
	@Roles(UserRole.DentistOwner)
	voidToothRecord(
		@Param('recordId', new ParseUUIDPipe()) recordId: string,
		@Body() body: VoidToothRecordDto,
		@Req() request: AuthenticatedRequest,
	) {
		return this.clinical.voidToothRecord(recordId, body.reason, this.actor(request));
	}

	@Get('patients/:id/odontogram')
	odontogram(
		@Param('id', new ParseUUIDPipe()) patientId: string,
		@Req() request: AuthenticatedRequest,
	) {
		return this.clinical.getOdontogram(patientId, this.actor(request));
	}

	@Get('patients/:id/teeth/:toothNumber/history')
	toothHistory(
		@Param('id', new ParseUUIDPipe()) patientId: string,
		@Param('toothNumber', new ParseIntPipe()) toothNumber: number,
		@Req() request: AuthenticatedRequest,
	) {
		return this.clinical.getToothHistory(patientId, toothNumber, this.actor(request));
	}

	@Post('patients/:id/clinical-notes')
	@Roles(UserRole.DentistOwner)
	createClinicalNote(
		@Param('id', new ParseUUIDPipe()) patientId: string,
		@Body() body: CreateClinicalNoteDto,
		@Req() request: AuthenticatedRequest,
	) {
		return this.clinical.createClinicalNote(patientId, body, this.actor(request));
	}

	@Put('clinical-notes/:noteId')
	@Roles(UserRole.DentistOwner)
	updateClinicalNote(
		@Param('noteId', new ParseUUIDPipe()) noteId: string,
		@Body() body: UpdateClinicalNoteDto,
		@Req() request: AuthenticatedRequest,
	) {
		return this.clinical.updateClinicalNote(noteId, body, this.actor(request));
	}

	@Get('patients/:id/clinical-notes')
	clinicalNotes(
		@Param('id', new ParseUUIDPipe()) patientId: string,
		@Req() request: AuthenticatedRequest,
	) {
		return this.clinical.listClinicalNotes(patientId, this.actor(request));
	}

	@Get('clinical-notes/:noteId/versions')
	clinicalNoteVersions(
		@Param('noteId', new ParseUUIDPipe()) noteId: string,
		@Req() request: AuthenticatedRequest,
	) {
		return this.clinical.listClinicalNoteVersions(noteId, this.actor(request));
	}

	@Post('patients/:id/treatment-plans')
	@Roles(UserRole.DentistOwner)
	createTreatmentPlan(
		@Param('id', new ParseUUIDPipe()) patientId: string,
		@Body() body: CreateTreatmentPlanDto,
		@Req() request: AuthenticatedRequest,
	) {
		return this.clinical.createTreatmentPlan(patientId, body, this.actor(request));
	}

	@Post('treatment-plans/:planId/items')
	@Roles(UserRole.DentistOwner)
	addTreatmentPlanItems(
		@Param('planId', new ParseUUIDPipe()) planId: string,
		@Body() body: CreateTreatmentPlanDto,
		@Req() request: AuthenticatedRequest,
	) {
		return this.clinical.addTreatmentPlanItems(planId, body, this.actor(request));
	}

	@Patch('treatment-plans/:planId/items/:itemId')
	@Roles(UserRole.DentistOwner)
	updateTreatmentPlanItem(
		@Param('planId', new ParseUUIDPipe()) planId: string,
		@Param('itemId', new ParseUUIDPipe()) itemId: string,
		@Body() body: UpdateTreatmentPlanItemDto,
		@Req() request: AuthenticatedRequest,
	) {
		return this.clinical.updateTreatmentPlanItem(planId, itemId, body, this.actor(request));
	}

	@Patch('treatment-plans/:planId/items/:itemId/status')
	@Roles(UserRole.DentistOwner)
	updateTreatmentPlanItemStatus(
		@Param('planId', new ParseUUIDPipe()) planId: string,
		@Param('itemId', new ParseUUIDPipe()) itemId: string,
		@Body() body: UpdateTreatmentPlanItemStatusDto,
		@Req() request: AuthenticatedRequest,
	) {
		return this.clinical.updateTreatmentPlanItemStatus(planId, itemId, body.status, this.actor(request));
	}

	@Get('patients/:id/treatment-plans')
	treatmentPlans(
		@Param('id', new ParseUUIDPipe()) patientId: string,
		@Req() request: AuthenticatedRequest,
	) {
		return this.clinical.listTreatmentPlans(patientId, this.actor(request));
	}

	private actor(request: AuthenticatedRequest) {
		return { userId: request.user!.id, role: request.user!.role, ip: request.ip ?? null };
	}
}
