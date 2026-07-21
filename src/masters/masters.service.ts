import { Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, SQL } from 'drizzle-orm';
import { getDb, schema as s } from '../db/client';
import { MasterPullResponse } from '../shared';

/**
 * Scoped delta pull of master data.
 *
 * The Power Apps build loaded 25+ unscoped collections at OnStart (2,000 areas,
 * 229 stock headers…) and was "slow on any network". Here each table is
 * (a) scoped to the rep's branch/routes and (b) filtered by updated_at > since,
 * so a normal morning pull is a few hundred small rows.
 */
@Injectable()
export class MastersService {
  async pull(
    userId: string,
    since: Partial<Record<string, string>>,
  ): Promise<MasterPullResponse> {
    const db = getDb();
    const serverTime = new Date().toISOString();

    const [user] = await db.select().from(s.users).where(eq(s.users.id, userId));
    if (!user) return { serverTime, tables: {} };

    const routeRows = await db
      .select({ routeId: s.userRouteMap.routeId })
      .from(s.userRouteMap)
      .where(eq(s.userRouteMap.userId, userId));
    const routeIds = routeRows.map((r) => r.routeId);
    const branchId = user.branchId;

    const withDelta = (table: string, col: any, scope?: SQL): SQL | undefined => {
      const sinceIso = since[table];
      const deltaCond = sinceIso ? gt(col, new Date(sinceIso)) : undefined;
      const conditions = [deltaCond, scope].filter(Boolean) as SQL[];
      return conditions.length ? and(...conditions) : undefined;
    };

    const today = new Date().toISOString().slice(0, 10);

    const tables: Record<string, unknown[]> = {};

    tables.branches = await db
      .select()
      .from(s.branches)
      .where(withDelta('branches', s.branches.updatedAt));

    tables.routes = routeIds.length
      ? await db
          .select()
          .from(s.routes)
          .where(withDelta('routes', s.routes.updatedAt, inArray(s.routes.id, routeIds)))
      : [];

    tables.warehouses = branchId
      ? await db
          .select()
          .from(s.warehouses)
          .where(
            withDelta('warehouses', s.warehouses.updatedAt, eq(s.warehouses.branchId, branchId)),
          )
      : [];

    tables.vans = branchId
      ? await db
          .select()
          .from(s.vans)
          .where(withDelta('vans', s.vans.updatedAt, eq(s.vans.branchId, branchId)))
      : [];

    tables.hsn_masters = await db
      .select()
      .from(s.hsnMasters)
      .where(withDelta('hsn_masters', s.hsnMasters.updatedAt));

    tables.items = await db
      .select()
      .from(s.items)
      .where(withDelta('items', s.items.updatedAt));

    tables.item_batches = await db
      .select()
      .from(s.itemBatches)
      .where(withDelta('item_batches', s.itemBatches.updatedAt));

    tables.price_lists = branchId
      ? await db
          .select()
          .from(s.priceLists)
          .where(
            withDelta('price_lists', s.priceLists.updatedAt, eq(s.priceLists.branchId, branchId)),
          )
      : [];

    const priceListIds = (tables.price_lists as Array<{ id: string }>).map((p) => p.id);
    tables.price_list_lines = priceListIds.length
      ? await db
          .select()
          .from(s.priceListLines)
          .where(
            withDelta(
              'price_list_lines',
              s.priceListLines.updatedAt,
              inArray(s.priceListLines.priceListId, priceListIds),
            ),
          )
      : [];

    tables.customer_groups = await db
      .select()
      .from(s.customerGroups)
      .where(withDelta('customer_groups', s.customerGroups.updatedAt));

    tables.customers = routeIds.length
      ? await db
          .select()
          .from(s.customers)
          .where(
            withDelta('customers', s.customers.updatedAt, inArray(s.customers.routeId, routeIds)),
          )
      : [];

    // Discounts/schemes: pull whole-branch (small) and evaluate locally.
    tables.discount_headers = await db
      .select()
      .from(s.discountHeaders)
      .where(withDelta('discount_headers', s.discountHeaders.updatedAt));
    tables.discount_lines = await db
      .select()
      .from(s.discountLines)
      .where(withDelta('discount_lines', s.discountLines.updatedAt));

    tables.scheme_headers = branchId
      ? await db
          .select()
          .from(s.schemeHeaders)
          .where(
            withDelta(
              'scheme_headers',
              s.schemeHeaders.updatedAt,
              eq(s.schemeHeaders.branchId, branchId),
            ),
          )
      : [];
    tables.scheme_applicability = await db
      .select()
      .from(s.schemeApplicability)
      .where(withDelta('scheme_applicability', s.schemeApplicability.updatedAt));
    tables.scheme_order_items = await db
      .select()
      .from(s.schemeOrderItems)
      .where(withDelta('scheme_order_items', s.schemeOrderItems.updatedAt));
    tables.scheme_offer_items = await db
      .select()
      .from(s.schemeOfferItems)
      .where(withDelta('scheme_offer_items', s.schemeOfferItems.updatedAt));

    tables.visit_plans = await db
      .select()
      .from(s.visitPlans)
      .where(and(eq(s.visitPlans.userId, userId), eq(s.visitPlans.planDate, today)));

    // Branch colleagues (no credentials) — needed for van-to-van transfers.
    tables.users = branchId
      ? await db
          .select({
            id: s.users.id,
            erpUserCode: s.users.erpUserCode,
            name: s.users.name,
            role: s.users.role,
          })
          .from(s.users)
          .where(and(eq(s.users.branchId, branchId), eq(s.users.isActive, true)))
      : [];

    return { serverTime, tables };
  }
}
