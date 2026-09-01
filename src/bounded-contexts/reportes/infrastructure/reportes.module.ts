import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ReportesController } from './reportes.controller';
import { ReportesService } from '../application/ReportesService';
import { SharedModule } from '../../../shared/shared.module';

@Module({
  imports: [SharedModule, HttpModule],
  controllers: [ReportesController],
  providers: [ReportesService],
  exports: [ReportesService],
})
export class ReportesModule {}
