import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedRequest } from '../../common/guards/request-context';
import { UserRole } from '../../database/enums';
import { BillingService } from './billing.service';
import {
  AddInvoiceLineDto,
  CashUpQueryDto,
  CreateCreditNoteDto,
  CreatePaymentDto,
  CreateInvoiceDto,
  CreatePerformedTreatmentDto,
  InvoiceListQueryDto,
} from './dto/billing.dto';

@Controller()
@Roles(UserRole.DentistOwner, UserRole.Receptionist)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('appointments/:id/performed-treatments')
  @Roles(UserRole.DentistOwner)
  createPerformedTreatment(
    @Param('id', new ParseUUIDPipe()) appointmentId: string,
    @Body() body: CreatePerformedTreatmentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.billing.createPerformedTreatment(appointmentId, body, this.actor(request));
  }

  @Delete('performed-treatments/:id')
  @Roles(UserRole.DentistOwner)
  deletePerformedTreatment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.billing.deletePerformedTreatment(id, this.actor(request));
  }

  @Get('patients/:id/billable')
  billable(@Param('id', new ParseUUIDPipe()) patientId: string) {
    return this.billing.getBillable(patientId);
  }

  @Post('patients/:id/invoices')
  createInvoice(
    @Param('id', new ParseUUIDPipe()) patientId: string,
    @Body() body: CreateInvoiceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.billing.createInvoice(patientId, body, this.actor(request));
  }

  @Get('patients/:id/invoices')
  patientInvoices(
    @Param('id', new ParseUUIDPipe()) patientId: string,
    @Query() query: InvoiceListQueryDto,
  ) {
    return this.billing.listInvoices(query, patientId);
  }

  @Get('invoices')
  invoices(@Query() query: InvoiceListQueryDto) {
    return this.billing.listInvoices(query);
  }

  @Get('invoices/:id')
  invoice(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.billing.getInvoice(id, this.actor(request));
  }

  @Post('invoices/:id/lines')
  addLine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AddInvoiceLineDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.billing.addLine(id, body, this.actor(request));
  }

  @Delete('invoices/:id/lines/:lineId')
  removeLine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.billing.removeLine(id, lineId, this.actor(request));
  }

  @Post('invoices/:id/issue')
  issue(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.billing.issueInvoice(id, this.actor(request));
  }

  @Delete('invoices/:id')
  deleteInvoice(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.billing.deleteInvoice(id, this.actor(request));
  }

  @Post('invoices/:id/payments')
  createPayment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreatePaymentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.billing.createPayment(id, body, this.actor(request));
  }

  @Post('invoices/:id/credit-notes')
  @Roles(UserRole.DentistOwner)
  createCreditNote(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateCreditNoteDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.billing.createCreditNote(id, body, this.actor(request));
  }

  @Get('reports/cash-up')
  cashUp(@Query() query: CashUpQueryDto, @Req() request: AuthenticatedRequest) {
    return this.billing.cashUp(query.date, this.actor(request));
  }

  private actor(request: AuthenticatedRequest) {
    return { userId: request.user!.id, role: request.user!.role, ip: request.ip ?? null };
  }
}
