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

    // Device binding.
    //  STRICT mode (STRICT_DEVICE_BINDING=true): a bound account can only log
    //  in from its enrolled device — for production rollout.
    //  Default (demo/UAT): last-login-wins — logging in from a new device
    //  simply re-binds the account to it, so the same demo user can move
    //  between emulator and phone freely.
    if (user.deviceId && deviceId && user.deviceId !== deviceId) {
      if (process.env.STRICT_DEVICE_BINDING === 'true') {
        throw new UnauthorizedException(
          'This account is bound to another device. Contact your supervisor.',
        );
      }
    }
    if (deviceId && user.deviceId !== deviceId) {
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
