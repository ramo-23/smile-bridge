import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { SessionEntity } from '../auth/entities/session.entity';
import { UserEntity } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, SessionEntity]), AuditModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
