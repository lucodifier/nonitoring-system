import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/identity.entity';
import { IdentitiesService } from './identities.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [IdentitiesService],
  exports: [IdentitiesService, TypeOrmModule],
})
export class IdentitiesModule {}
