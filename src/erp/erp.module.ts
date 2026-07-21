import { Module } from '@nestjs/common';
import { ErpService } from './erp.service';
import { ErpWorker } from './erp.worker';

@Module({
  providers: [ErpService, ErpWorker],
  exports: [ErpService],
})
export class ErpModule {}
