import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { MastersModule } from './masters/masters.module';
import { TripsModule } from './trips/trips.module';
import { SyncModule } from './sync/sync.module';
import { ErpModule } from './erp/erp.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    MastersModule,
    TripsModule,
    SyncModule,
    ErpModule,
    AiModule,
  ],
})
export class AppModule {}
