import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { ErpModule } from '../erp/erp.module';

@Module({
  imports: [ErpModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
