import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { pushBatchSchema } from '../shared';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt.guard';
import { JwtPayload } from '../auth/auth.service';
import { SyncService } from './sync.service';

@Controller('sync')
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /** Drain a device outbox batch. Returns per-entry results keyed by idempotencyKey. */
  @Post('push')
  async push(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    const parsed = pushBatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.sync.applyBatch(user.sub, parsed.data);
  }

  /** Pending transfer-in / nudge notifications for this rep. */
  @Get('notifications')
  notifications(@CurrentUser() user: JwtPayload) {
    return this.sync.pendingNotifications(user.sub);
  }
}
