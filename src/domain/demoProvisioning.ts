import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema as s } from '../db/client';

/**
 * Auto-provision or roll forward today's Gate Pass for demo/UAT environments.
 * When ERP integration goes live in production, real gate passes are generated
 * by the ERP, so this module can be disabled or bypassed via environment configuration.
 */
export async function ensureTodayGatePass(
  userId: string,
  today: string,
  tripId: string,
  userErpCode: string,
) {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(s.gatePasses)
    .where(and(eq(s.gatePasses.userId, userId), eq(s.gatePasses.tripDate, today)));

  if (existing) return existing;

  // Roll forward latest gate pass if one exists for this user
  const [latestGp] = await db
    .select()
    .from(s.gatePasses)
    .where(eq(s.gatePasses.userId, userId))
    .orderBy(desc(s.gatePasses.createdAt))
    .limit(1);

  if (latestGp) {
    const [newGp] = await db
      .insert(s.gatePasses)
      .values({
        userId,
        dayTripId: tripId,
        tripDate: today,
        erpGatepassNo: `GP-${userErpCode}-${today.replace(/-/g, '')}`,
        status: 'draft',
      })
      .returning();

    const oldLines = await db
      .select()
      .from(s.gatePassLines)
      .where(eq(s.gatePassLines.gatePassId, latestGp.id));

    if (oldLines.length) {
      await db.insert(s.gatePassLines).values(
        oldLines.map((l) => ({
          gatePassId: newGp.id,
          itemId: l.itemId,
          batchId: l.batchId,
          qtyCases: l.qtyCases,
          qtyPcs: l.qtyPcs,
          qtyTotalPcs: l.qtyTotalPcs,
        })),
      );
    }
    return newGp;
  }

  // Provision default van load if no previous gate pass exists
  const items = await db.select().from(s.items).limit(10);
  if (!items.length) return null;

  const [newGp] = await db
    .insert(s.gatePasses)
    .values({
      userId,
      dayTripId: tripId,
      tripDate: today,
      erpGatepassNo: `GP-${userErpCode}-${today.replace(/-/g, '')}`,
      status: 'draft',
    })
    .returning();

  const defaultQtyMap: Record<string, { cases: number; pcs: number }> = {
    'BIS-250': { cases: 10, pcs: 0 },
    'BIS-500': { cases: 20, pcs: 0 },
    'BIS-1000': { cases: 15, pcs: 0 },
    'BIS-2000': { cases: 8, pcs: 0 },
    'BIS-20L': { cases: 0, pcs: 30 },
    'VED-500': { cases: 2, pcs: 0 },
    'BIS-SODA': { cases: 4, pcs: 0 },
  };

  const batches = await db.select().from(s.itemBatches);
  const linesToInsert = items.map((it) => {
    const qtyDef = defaultQtyMap[it.erpItemCode] ?? { cases: 5, pcs: 0 };
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
  return newGp;
}

/**
 * Auto-provision or roll forward today's Visit Plans for demo/UAT environments.
 */
export async function ensureTodayVisitPlans(
  userId: string,
  today: string,
  routeIds: string[],
) {
  const db = getDb();
  const existingPlans = await db
    .select()
    .from(s.visitPlans)
    .where(and(eq(s.visitPlans.userId, userId), eq(s.visitPlans.planDate, today)));

  if (existingPlans.length) return existingPlans;

  const latestPlans = await db
    .select()
    .from(s.visitPlans)
    .where(eq(s.visitPlans.userId, userId))
    .orderBy(desc(s.visitPlans.createdAt));

  if (latestPlans.length) {
    const latestDate = latestPlans[0].planDate;
    const plansToRoll = latestPlans.filter((p) => p.planDate === latestDate);

    return db
      .insert(s.visitPlans)
      .values(
        plansToRoll.map((p) => ({
          userId,
          routeId: p.routeId,
          customerId: p.customerId,
          planDate: today,
          sequence: p.sequence,
        })),
      )
      .returning();
  }

  if (routeIds.length) {
    const custs = await db
      .select()
      .from(s.customers)
      .where(inArray(s.customers.routeId, routeIds))
      .limit(10);

    if (custs.length) {
      return db
        .insert(s.visitPlans)
        .values(
          custs.map((c, idx) => ({
            userId,
            routeId: c.routeId ?? routeIds[0],
            customerId: c.id,
            planDate: today,
            sequence: idx + 1,
          })),
        )
        .returning();
    }
  }

  return [];
}
