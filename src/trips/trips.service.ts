import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema as s } from '../db/client';
import { DayStartResponse } from '../shared';

const BLOCK_SIZE = Number(process.env.INVOICE_BLOCK_SIZE ?? 70);

@Injectable()
export class TripsService {
  /**
   * Idempotent day-start bundle:
   *  - get-or-create today's day_trip (unique on user+date — double taps are safe)
   *  - allocate the invoice-series block for offline numbering
   *  - return today's gate pass with lines
   */
  async dayStart(userId: string): Promise<DayStartResponse> {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    const [user] = await db.select().from(s.users).where(eq(s.users.id, userId));
    if (!user?.branchId) throw new NotFoundException('User has no branch');
    const [branch] = await db
      .select()
      .from(s.branches)
      .where(eq(s.branches.id, user.branchId));

    const [vanMap] = await db
      .select()
      .from(s.userVanMap)
      .where(eq(s.userVanMap.userId, userId))
      .orderBy(desc(s.userVanMap.effectiveDate))
      .limit(1);
    const [routeMap] = await db
      .select()
      .from(s.userRouteMap)
      .where(eq(s.userRouteMap.userId, userId))
      .limit(1);

    const trip = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(s.dayTrips)
        .where(and(eq(s.dayTrips.userId, userId), eq(s.dayTrips.tripDate, today)));
      if (existing) return existing;
      const [created] = await tx
        .insert(s.dayTrips)
        .values({
          userId,
          tripDate: today,
          vanId: vanMap?.vanId,
          routeId: routeMap?.routeId,
          state: 'logged_in',
        })
        .onConflictDoNothing()
        .returning();
      if (created) return created;
      const [raced] = await tx
        .select()
        .from(s.dayTrips)
        .where(and(eq(s.dayTrips.userId, userId), eq(s.dayTrips.tripDate, today)));
      return raced;
    });

    // Invoice block: reuse today's if already allocated, else carve the next range.
    const block = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(s.invoiceSeriesBlocks)
        .where(
          and(
            eq(s.invoiceSeriesBlocks.userId, userId),
            eq(s.invoiceSeriesBlocks.tripDate, today),
          ),
        );
      if (existing) return existing;

      const [last] = await tx
        .select()
        .from(s.invoiceSeriesBlocks)
        .where(eq(s.invoiceSeriesBlocks.branchId, user.branchId!))
        .orderBy(desc(s.invoiceSeriesBlocks.seqEnd))
        .limit(1);
      const seqStart = (last?.seqEnd ?? 0) + 1;
      const [created] = await tx
        .insert(s.invoiceSeriesBlocks)
        .values({
          userId,
          branchId: user.branchId!,
          tripDate: today,
          prefix: branch.invoicePrefix,
          seqStart,
          seqEnd: seqStart + BLOCK_SIZE - 1,
        })
        .returning();
      return created;
    });

    const [gatePass] = await db
      .select()
      .from(s.gatePasses)
      .where(and(eq(s.gatePasses.userId, userId), eq(s.gatePasses.tripDate, today)));

    let gatePassPayload: unknown = null;
    if (gatePass) {
      if (!gatePass.dayTripId) {
        await db
          .update(s.gatePasses)
          .set({ dayTripId: trip.id })
          .where(eq(s.gatePasses.id, gatePass.id));
      }
      const lines = await db
        .select({
          id: s.gatePassLines.id,
          itemId: s.gatePassLines.itemId,
          batchId: s.gatePassLines.batchId,
          qtyCases: s.gatePassLines.qtyCases,
          qtyPcs: s.gatePassLines.qtyPcs,
          qtyTotalPcs: s.gatePassLines.qtyTotalPcs,
        })
        .from(s.gatePassLines)
        .where(eq(s.gatePassLines.gatePassId, gatePass.id));
      gatePassPayload = { ...gatePass, dayTripId: trip.id, lines };
    }

    return {
      dayTripId: trip.id,
      tripDate: today,
      invoicePrefix: block.prefix,
      invoiceSeqStart: block.seqStart,
      invoiceSeqEnd: block.seqEnd,
      gatePass: gatePassPayload,
    };
  }

  async today(userId: string) {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const [trip] = await db
      .select()
      .from(s.dayTrips)
      .where(and(eq(s.dayTrips.userId, userId), eq(s.dayTrips.tripDate, today)));
    if (!trip) return null;
    const stock = await db
      .select()
      .from(s.vanStock)
      .where(eq(s.vanStock.dayTripId, trip.id));
    return { trip, stock };
  }
}
