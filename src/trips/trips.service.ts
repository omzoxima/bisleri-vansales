import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, like } from 'drizzle-orm';
import { getDb, schema as s } from '../db/client';
import { DayStartResponse } from '../shared';
import { ensureTodayGatePass } from '../domain/demoProvisioning';

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

    const gatePass = await ensureTodayGatePass(userId, today, trip.id, user.erpUserCode);

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

  /** Demo/testing "Reset Today's Data": drop rider-added ad-hoc stops and Route #2 gate passes for today. */
  async resetTodayAdHocStops(userId: string): Promise<void> {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    await db
      .delete(s.visitPlans)
      .where(
        and(
          eq(s.visitPlans.userId, userId),
          eq(s.visitPlans.planDate, today),
          eq(s.visitPlans.source, 'ad_hoc'),
        ),
      );

    const r2Passes = await db
      .select({ id: s.gatePasses.id })
      .from(s.gatePasses)
      .where(
        and(
          eq(s.gatePasses.userId, userId),
          eq(s.gatePasses.tripDate, today),
          like(s.gatePasses.erpGatepassNo, '%-R2'),
        ),
      );

    for (const gp of r2Passes) {
      await db.delete(s.gatePassLines).where(eq(s.gatePassLines.gatePassId, gp.id));
      await db.delete(s.gatePasses).where(eq(s.gatePasses.id, gp.id));
    }
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

  /**
   * Check if an additional route (Route #2, Route #3...) is available for the rider today.
   */
  async checkNextRouteAvailable(userId: string) {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const [user] = await db.select().from(s.users).where(eq(s.users.id, userId));
    if (!user) return { available: false };

    // If Route #2 Gate Pass already generated today for this user, no more routes available
    const [existingR2] = await db
      .select()
      .from(s.gatePasses)
      .where(
        and(
          eq(s.gatePasses.userId, userId),
          eq(s.gatePasses.tripDate, today),
          eq(s.gatePasses.erpGatepassNo, `GP-${user.erpUserCode}-${today.replace(/-/g, '')}-R2`),
        ),
      );
    if (existingR2) return { available: false };

    const allRoutes = await db.select().from(s.routes).where(eq(s.routes.isActive, true)).limit(5);
    const secondaryRoute = allRoutes[1] ?? allRoutes[0];
    if (!secondaryRoute) return { available: false };

    const customersOnRoute = await db
      .select()
      .from(s.customers)
      .where(eq(s.customers.routeId, secondaryRoute.id))
      .limit(10);

    return {
      available: true,
      nextTripNumber: 2,
      route: {
        id: secondaryRoute.id,
        code: secondaryRoute.code,
        name: secondaryRoute.name ?? 'Route #2 - East Industrial Park',
        stopCount: customersOnRoute.length || 6,
      },
    };
  }

  /**
   * Provision Gate Pass #2 and visit plan for Route #2 when rider accepts next route.
   */
  async startNextRoute(userId: string, routeId?: string) {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const [user] = await db.select().from(s.users).where(eq(s.users.id, userId));
    if (!user?.erpUserCode) throw new NotFoundException('User ERP code missing');

    // Create Gate Pass #2 for next route dispatch with distinct replenishment stock
    const items = await db.select().from(s.items).limit(10);
    const [newGp] = await db
      .insert(s.gatePasses)
      .values({
        userId,
        tripDate: today,
        erpGatepassNo: `GP-${user.erpUserCode}-${today.replace(/-/g, '')}-R2`,
        status: 'draft',
      })
      .returning();

    // Route #2 Replenishment Dispatch Quantities
    const route2QtyMap: Record<string, { cases: number; pcs: number }> = {
      'BIS-250': { cases: 14, pcs: 0 },
      'BIS-500': { cases: 22, pcs: 0 },
      'BIS-1000': { cases: 18, pcs: 0 },
      'BIS-2000': { cases: 10, pcs: 0 },
      'BIS-20L': { cases: 0, pcs: 40 },
      'VED-500': { cases: 5, pcs: 0 },
      'BIS-SODA': { cases: 6, pcs: 0 },
    };

    const batches = await db.select().from(s.itemBatches);
    const linesToInsert = items.map((it) => {
      const qtyDef = route2QtyMap[it.erpItemCode] ?? { cases: 6, pcs: 0 };
      const batch = batches.find((b) => b.itemId === it.id);
      return {
        gatePassId: newGp.id,
        itemId: it.id,
        batchId: batch?.id ?? null,
        qtyCases: qtyDef.cases,
        qtyPcs: qtyDef.pcs,
        qtyTotalPcs: qtyDef.cases * it.pcsPerCase + qtyDef.pcs,
      };
    });

    if (linesToInsert.length) {
      await db.insert(s.gatePassLines).values(linesToInsert);
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
      .where(eq(s.gatePassLines.gatePassId, newGp.id));

    // Fetch Route #2 customers for the next visit plan
    const allRoutes = await db.select().from(s.routes).where(eq(s.routes.isActive, true)).limit(5);
    const secondaryRoute = allRoutes[1] ?? allRoutes[0];
    const route2Customers = secondaryRoute
      ? await db.select().from(s.customers).where(eq(s.customers.routeId, secondaryRoute.id)).limit(10)
      : await db.select().from(s.customers).limit(8);

    const visitPlans = route2Customers.map((c, idx) => ({
      id: `vp-r2-${c.id}`,
      customerId: c.id,
      sequence: idx + 1,
      planDate: today,
      source: 'planned',
    }));

    return {
      success: true,
      tripNumber: 2,
      routeName: secondaryRoute?.name ?? 'Route #2 - Pune East Suburbs',
      gatePass: {
        ...newGp,
        lines,
      },
      visitPlans,
    };
  }
}
