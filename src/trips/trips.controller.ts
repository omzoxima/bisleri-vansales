import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt.guard';
import { JwtPayload } from '../auth/auth.service';
import { TripsService } from './trips.service';

@Controller('trips')
@UseGuards(JwtAuthGuard)
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post('day-start')
  dayStart(@CurrentUser() user: JwtPayload) {
    return this.trips.dayStart(user.sub);
  }

  @Get('today')
  today(@CurrentUser() user: JwtPayload) {
    return this.trips.today(user.sub);
  }
}
