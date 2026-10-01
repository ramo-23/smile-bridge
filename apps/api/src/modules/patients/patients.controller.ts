import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { CreateAllergyDto, UpdateAllergyDto } from './dto/allergy.dto';
import { CreateInsuranceDto, UpdateInsuranceDto } from './dto/insurance.dto';
import { UpdateMedicalHistoryDto } from './dto/medical-history.dto';
import { CreateNextOfKinDto, UpdateNextOfKinDto } from './dto/next-of-kin.dto';
import { PatientSearchDto } from './dto/patient-search.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientsService } from './patients.service';

@Controller('patients')
@Roles(UserRole.DentistOwner, UserRole.Receptionist)
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Post()
  create(@Body() body: CreatePatientDto, @Req() request: AuthenticatedRequest) {
    return this.patients.create(body, this.actor(request));
  }

  @Get()
  search(@Query() query: PatientSearchDto) {
    return this.patients.search(query);
  }

  @Get(':id')
  profile(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.patients.getProfile(id, this.actor(request));
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePatientDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.update(id, body, this.actor(request));
  }

  @Post(':id/archive')
  archive(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.patients.archive(id, this.actor(request));
  }

  @Post(':id/restore')
  restore(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.patients.archive(id, this.actor(request), true);
  }

  @Post(':id/next-of-kin')
  createNextOfKin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateNextOfKinDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.createNextOfKin(id, body, this.actor(request));
  }

  @Patch(':id/next-of-kin')
  updateNextOfKinBody(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateNextOfKinDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.updateNextOfKin(id, body.id ?? '', body, this.actor(request));
  }

  @Patch(':id/next-of-kin/:kinId')
  updateNextOfKin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('kinId', new ParseUUIDPipe()) kinId: string,
    @Body() body: UpdateNextOfKinDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.updateNextOfKin(id, kinId, body, this.actor(request));
  }

  @Delete(':id/next-of-kin')
  deleteNextOfKinBody(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateNextOfKinDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.deleteNextOfKin(id, body.id ?? '', this.actor(request));
  }

  @Delete(':id/next-of-kin/:kinId')
  deleteNextOfKin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('kinId', new ParseUUIDPipe()) kinId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.deleteNextOfKin(id, kinId, this.actor(request));
  }

  @Post(':id/allergies')
  createAllergy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateAllergyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.createAllergy(id, body, this.actor(request));
  }

  @Patch(':id/allergies')
  updateAllergyBody(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateAllergyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.updateAllergy(id, body.id ?? '', body, this.actor(request));
  }

  @Patch(':id/allergies/:allergyId')
  updateAllergy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('allergyId', new ParseUUIDPipe()) allergyId: string,
    @Body() body: UpdateAllergyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.updateAllergy(id, allergyId, body, this.actor(request));
  }

  @Post(':id/insurance')
  createInsurance(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateInsuranceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.createInsurance(id, body, this.actor(request));
  }

  @Patch(':id/insurance')
  updateInsuranceBody(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateInsuranceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.updateInsurance(id, body.id ?? '', body, this.actor(request));
  }

  @Patch(':id/insurance/:policyId')
  updateInsurance(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('policyId', new ParseUUIDPipe()) policyId: string,
    @Body() body: UpdateInsuranceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.updateInsurance(id, policyId, body, this.actor(request));
  }

  @Get(':id/medical-history')
  getMedicalHistory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.getMedicalHistory(id, this.actor(request));
  }

  @Put(':id/medical-history')
  updateMedicalHistory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateMedicalHistoryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.updateMedicalHistory(id, body, this.actor(request));
  }

  @Post(':id/medical-history/confirm')
  @Roles(UserRole.DentistOwner)
  confirmMedicalHistory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patients.confirmMedicalHistory(id, this.actor(request));
  }

  private actor(request: AuthenticatedRequest) {
    return { id: request.user!.id, ip: request.ip ?? null };
  }
}
