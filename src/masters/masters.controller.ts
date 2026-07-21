import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt.guard';
import { JwtPayload } from '../auth/auth.service';
import { MastersService } from './masters.service';

@Controller('sync')
@UseGuards(JwtAuthGuard)
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  /** Delta pull of scoped masters. Body: { since: { [table]: iso } } */
  @Post('masters')
  pull(
    @CurrentUser() user: JwtPayload,
    @Body() body: { since?: Partial<Record<string, string>> },
  ) {
    return this.masters.pull(user.sub, body?.since ?? {});
  }
}
