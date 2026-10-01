import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { UserRole } from '../../database/enums';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedRequest } from '../../common/guards/request-context';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
@Roles(UserRole.DentistOwner)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Body() body: CreateUserDto, @Req() request: AuthenticatedRequest) {
    return this.users.create(body, request.user!.id, request.ip ?? null);
  }

  @Get()
  list() {
    return this.users.list();
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateUserDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.update(id, body, request.user!.id, request.ip ?? null);
  }

  @Post(':id/reset-password')
  resetPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ResetPasswordDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.resetPassword(id, body.password, request.user!.id, request.ip ?? null);
  }
}
