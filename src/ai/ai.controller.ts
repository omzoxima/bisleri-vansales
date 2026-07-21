import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt.guard';
import { JwtPayload } from '../auth/auth.service';
import { AiService } from './ai.service';

const askSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(30), // cap history sent from the device
});

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('ask')
  async ask(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    const parsed = askSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.ai.ask(user.sub, parsed.data.messages);
  }
}
