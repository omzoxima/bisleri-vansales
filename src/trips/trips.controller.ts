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

  @Post('reset-today-ad-hoc')
  resetTodayAdHocStops(@CurrentUser() user: JwtPayload) {
    return this.trips.resetTodayAdHocStops(user.sub);
  }

  @Get('next-route')
  checkNextRoute(@CurrentUser() user: JwtPayload) {
    return this.trips.checkNextRouteAvailable(user.sub);
  }

  @Post('start-next-route')
  startNextRoute(@CurrentUser() user: JwtPayload) {
    return this.trips.startNextRoute(user.sub);
  }
}
