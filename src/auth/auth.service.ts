import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/client';

export interface JwtPayload {
  sub: string; // user id
  role: string;
  branchId: string | null;
  deviceId: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  async login(email: string, password: string, deviceId: string) {
    const db = getDb();
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase().trim()));

    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    // Device binding: first login enrols the device; later logins must match.
    if (user.deviceId && deviceId && user.deviceId !== deviceId) {
      throw new UnauthorizedException(
        'This account is bound to another device. Contact your supervisor.',
      );
    }
    if (!user.deviceId && deviceId) {
      await db
        .update(schema.users)
        .set({ deviceId })
        .where(eq(schema.users.id, user.id));
    }

    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      branchId: user.branchId,
      deviceId,
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        erpUserCode: user.erpUserCode,
        branchId: user.branchId,
      },
    };
  }
}
