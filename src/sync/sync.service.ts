import { Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  CUSTOMER_TYPE_COR_ROT,
  PUSH_ENTITIES,
  PushBatch,
  PushEnvelope,
  PushResult,
} from '../shared';
import { amountInWords, computeSettlement, round2 } from '../domain';
import { Db, getDb, schema as s } from '../db/client';
import { ErpService } from '../erp/erp.service';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Applies device outbox entries. Guarantees:
 *  - idempotent: one sync_events row per idempotency key; replays return 'duplicate'
 *  - ordered: entries applied in seq order within a batch
 *  - atomic: each entry runs in ONE Postgres transaction (order + lines +
 *    invoice + stock + ledger together) — the exact property whose absence
 *    caused the Power Apps "stock null / missing lines / double invoice" bugs.
 */
@Injectable()
export class SyncService {
  private readonly log = new Logger(SyncService.name);

  constructor(private readonly erp: ErpService) {}

  async applyBatch(userId: string, batch: PushBatch): Promise<{ results: PushResult[] }> {
    const db = getDb();
    const results: PushResult[] = [];
    const entries = [...batch.entries].sort((a, b) => a.seq - b.seq);

    for (const entry of entries) {
      const [dupe] = await db
        .select()
        .from(s.syncEvents)
        .where(eq(s.syncEvents.idempotencyKey, entry.idempotencyKey));
      if (dupe) {
        results.push({
          idempotencyKey: entry.idempotencyKey,
          status: dupe.status === 'applied' ? 'duplicate' : 'rejected',
          serverId: dupe.serverId ?? undefined,
          error: dupe.error ?? undefined,
        });
        continue;
      }

      try {
        const serverId = await db.transaction(async (tx) => {
          const id = await this.applyOne(tx, userId, batch.deviceId, entry);
          await tx.insert(s.syncEvents).values({
            idempotencyKey: entry.idempotencyKey,
            deviceId: batch.deviceId,
            userId,
            seq: entry.seq,
            entity: entry.entity,
            status: 'applied',
            serverId: id,
            payload: entry.payload as object,
          });
          return id;
        });
        results.push({ idempotencyKey: entry.idempotencyKey, status: 'applied', serverId });
      } catch (err: any) {
        const message = err?.message ?? 'apply failed';
        this.log.warn(`entry ${entry.entity}/${entry.idempotencyKey} rejected: ${message}`);
        await db
          .insert(s.syncEvents)
          .values({
            idempotencyKey: entry.idempotencyKey,
            deviceId: batch.deviceId,
            userId,
            seq: entry.seq,
            entity: entry.entity,
            status: 'rejected',
            error: message,
            payload: entry.payload as object,
          })
          .onConflictDoNothing();
        results.push({ idempotencyKey: entry.idempotencyKey, status: 'rejected', error: message });
      }
    }
    return { results };
  }

  private parsePayload(entry: PushEnvelope): any {
    const schema = PUSH_ENTITIES[entry.entity as keyof typeof PUSH_ENTITIES];
    if (!schema) throw new Error(`Unknown entity ${entry.entity}`);
    const parsed = schema.safeParse(entry.payload);
    if (!parsed.success) throw new Error(`Invalid ${entry.entity}: ${parsed.error.message}`);
    return parsed.data;
  }

  private async trip(tx: Tx, userId: string): Promise<typeof s.dayTrips.$inferSelect> {
    const today = new Date().toISOString().slice(0, 10);
    const [trip] = await tx
      .select()
      .from(s.dayTrips)
      .where(and(eq(s.dayTrips.userId, userId), eq(s.dayTrips.tripDate, today)));
    if (!trip) throw new Error('No day trip — call /trips/day-start first');
    return trip;
  }

  private async applyOne(
    tx: Tx,
    userId: string,
    deviceId: string,
    entry: PushEnvelope,
  ): Promise<string | undefined> {
    const p = this.parsePayload(entry);
    switch (entry.entity as keyof typeof PUSH_ENTITIES) {
      case 'day_event':
        return this.applyDayEvent(tx, userId, p);
      case 'visit':
        return this.applyVisit(tx, userId, p);
      case 'order':
        return this.applyOrder(tx, userId, p);
      case 'payment':
        return this.applyPayment(tx, userId, p);
      case 'jar_collection':
        return this.applyJarCollection(tx, userId, p);
      case 'van_transfer':
        return this.applyVanTransfer(tx, userId, p);
      case 'check_in_demand':
        return this.applyDemand(tx, userId, p);
      case 'settlement':
        return this.applySettlement(tx, userId, p);
      case 'customer_onboarding':
        return this.applyOnboarding(tx, userId, p);
      default:
        throw new Error(`No handler for ${entry.entity}`);
    }
  }

  // ── day events ────────────────────────────────────────────────────────────

  private async applyDayEvent(tx: Tx, userId: string, p: any): Promise<string> {
    const trip = await this.trip(tx, userId);
    if (p.event === 'gate_pass_verified') {
      const [gp] = await tx
        .select()
        .from(s.gatePasses)
        .where(and(eq(s.gatePasses.userId, userId), eq(s.gatePasses.tripDate, trip.tripDate)));
      if (!gp) throw new Error('No gate pass for today');
      // Security fix for the go-live issue "Shatrughan can accept Roshni's gate
      // pass": ownership is checked against the JWT user, never the payload.
      await tx
        .update(s.gatePasses)
        .set({ status: 'verified', verifiedAt: new Date(p.at), dayTripId: trip.id })
        .where(eq(s.gatePasses.id, gp.id));

      const lines = await tx
        .select()
        .from(s.gatePassLines)
        .where(eq(s.gatePassLines.gatePassId, gp.id));
      for (const line of lines) {
        await tx
          .insert(s.vanStock)
          .values({
            dayTripId: trip.id,
            itemId: line.itemId,
            batchId: line.batchId,
            loadedPcs: line.qtyTotalPcs,
            currentPcs: line.qtyTotalPcs,
          })
          .onConflictDoNothing();
        await tx.insert(s.stockLedger).values({
          dayTripId: trip.id,
          itemId: line.itemId,
          batchId: line.batchId,
          txnType: 'load',
          qtyPcs: line.qtyTotalPcs,
          refTable: 'gate_passes',
          refId: gp.id,
        });
      }
      await tx
        .update(s.dayTrips)
        .set({ state: 'gate_pass_verified' })
        .where(eq(s.dayTrips.id, trip.id));
      return trip.id;
    }

    if (p.event === 'day_started') {
      if (trip.state === 'day_ended') throw new Error('Day already ended');
      await tx
        .update(s.dayTrips)
        .set({
          state: 'day_started',
          startTime: new Date(p.at),
          startLat: p.lat,
          startLng: p.lng,
          attendanceType: 'Present',
        })
        .where(eq(s.dayTrips.id, trip.id));
      return trip.id;
    }

    if (p.event === 'day_ended') {
      if (trip.state === 'day_ended') return trip.id; // replay-safe
      if (trip.state !== 'settled') throw new Error('Settlement must balance before day end');
      const end = new Date(p.at);
      const hours = trip.startTime
        ? round2((end.getTime() - new Date(trip.startTime).getTime()) / 3_600_000)
        : null;
      await tx
        .update(s.dayTrips)
        .set({ state: 'day_ended', endTime: end, endLat: p.lat, endLng: p.lng, hoursWorked: hours })
        .where(eq(s.dayTrips.id, trip.id));
      await this.erp.enqueue(tx, 'push_day_end', trip.id, { dayTripId: trip.id });
      return trip.id;
    }
    throw new Error(`Unknown day event ${p.event}`);
  }

  // ── visits ────────────────────────────────────────────────────────────────

  private async applyVisit(tx: Tx, userId: string, p: any): Promise<string> {
    const trip = await this.trip(tx, userId);
    const [visit] = await tx
      .insert(s.visits)
      .values({
        localUuid: p.localUuid,
        dayTripId: trip.id,
        customerId: p.customerId,
        visitType: p.visitType,
        checkInTime: new Date(p.checkInTime),
        checkOutTime: p.checkOutTime ? new Date(p.checkOutTime) : null,
        checkInLat: p.checkInLat,
        checkInLng: p.checkInLng,
        distanceFromCustomerM: p.distanceFromCustomerM,
        outcome: p.outcome,
      })
      .onConflictDoUpdate({
        target: s.visits.localUuid,
        set: {
          checkOutTime: p.checkOutTime ? new Date(p.checkOutTime) : null,
          outcome: p.outcome,
        },
      })
      .returning();
    return visit.id;
  }

  // ── orders (the heart of it) ──────────────────────────────────────────────

  private async applyOrder(tx: Tx, userId: string, p: any): Promise<string> {
    const trip = await this.trip(tx, userId);

    let visitId: string | null = null;
    if (p.visitLocalUuid) {
      const [visit] = await tx
        .select()
        .from(s.visits)
        .where(eq(s.visits.localUuid, p.visitLocalUuid));
      visitId = visit?.id ?? null;
    }

    const orderNo = `OR-${p.localUuid.slice(0, 8).toUpperCase()}`;
    const [order] = await tx
      .insert(s.orders)
      .values({
        localUuid: p.localUuid,
        orderNo,
        dayTripId: trip.id,
        visitId,
        customerId: p.customerId ?? null,
        orderType: p.orderType,
        orderDate: new Date(p.orderDate),
        grossAmount: p.grossAmount,
        discountAmount: p.discountAmount,
        schemeAmount: p.schemeAmount,
        jarShortfallQty: p.jarShortfallQty,
        jarShortfallAmount: p.jarShortfallAmount,
        taxableAmount: p.taxableAmount,
        cgst: p.cgst,
        sgst: p.sgst,
        cess: p.cess,
        netAmount: p.netAmount,
        status: 'confirmed',
        focReason: p.focReason ?? null,
      })
      .onConflictDoNothing({ target: s.orders.localUuid })
      .returning();
    if (!order) {
      const [existing] = await tx.select().from(s.orders).where(eq(s.orders.localUuid, p.localUuid));
      return existing.id; // replayed entry
    }

    for (const sig of ['customer', 'rep'] as const) {
      const b64 = sig === 'customer' ? p.customerSignatureB64 : p.repSignatureB64;
      if (!b64) continue;
      const [file] = await tx
        .insert(s.files)
        .values({ kind: 'signature', ownerTable: 'orders', ownerId: order.id, contentB64: b64 })
        .returning();
      await tx
        .update(s.orders)
        .set(sig === 'customer' ? { customerSignatureFileId: file.id } : { repSignatureFileId: file.id })
        .where(eq(s.orders.id, order.id));
    }

    // Lines + stock movement in the same transaction.
    const stockDirection = p.orderType === 'empty_jar' ? 0 : p.orderType === 'replacement' ? 0 : -1;
    for (const line of p.lines) {
      await tx.insert(s.orderLines).values({
        orderId: order.id,
        itemId: line.itemId,
        batchId: line.batchId ?? null,
        qtyCases: line.qtyCases,
        qtyPcs: line.qtyPcs,
        qtyTotalPcs: line.qtyTotalPcs,
        unitPrice: line.unitPrice,
        discountValue: line.discountValue,
        schemeFree: line.schemeFree,
        emptyJarsReceived: line.emptyJarsReceived,
        returnReason: line.returnReason ?? null,
        mfgDate: line.mfgDate ?? null,
        lineAmount: line.lineAmount,
        cgst: line.cgst,
        sgst: line.sgst,
        cess: line.cess,
        netAmount: line.netAmount,
      });

      if (stockDirection === -1 && line.qtyTotalPcs > 0) {
        const isFoc = p.orderType === 'foc' || line.schemeFree;
        await this.moveStock(tx, trip.id, line.itemId, line.batchId ?? null, -line.qtyTotalPcs, {
          txnType: isFoc ? 'foc' : 'sale',
          refId: order.id,
          soldDelta: isFoc ? 0 : line.qtyTotalPcs,
          focDelta: isFoc ? line.qtyTotalPcs : 0,
        });
      }
      // Replacement: damaged goods in, fresh goods out — net van count unchanged,
      // but both movements are recorded for settlement.
      if (p.orderType === 'replacement' && line.qtyTotalPcs > 0) {
        await tx.insert(s.stockLedger).values([
          { dayTripId: trip.id, itemId: line.itemId, batchId: line.batchId ?? null, txnType: 'replacement_in', qtyPcs: line.qtyTotalPcs, refTable: 'orders', refId: order.id },
          { dayTripId: trip.id, itemId: line.itemId, batchId: line.batchId ?? null, txnType: 'replacement_out', qtyPcs: -line.qtyTotalPcs, refTable: 'orders', refId: order.id },
        ]);
      }
    }

    // Invoice for sale orders — number came from the rep's offline block.
    if (p.orderType === 'sale' && p.invoiceNo) {
      const [customer] = p.customerId
        ? await tx.select().from(s.customers).where(eq(s.customers.id, p.customerId))
        : [undefined];
      const [invoice] = await tx
        .insert(s.invoices)
        .values({
          localUuid: p.localUuid,
          invoiceNo: p.invoiceNo,
          orderId: order.id,
          customerId: p.customerId ?? null,
          invoiceDate: new Date(p.orderDate),
          taxableAmount: p.taxableAmount,
          cgst: p.cgst,
          sgst: p.sgst,
          cess: p.cess,
          totalAmount: p.netAmount,
          amountInWords: amountInWords(p.netAmount),
          irnStatus: customer?.isGstRegistered ? 'pending' : 'not_applicable',
          docType: customer?.isGstRegistered ? 'delivery_challan' : 'tax_invoice', // challan until IRN lands
        })
        .onConflictDoNothing({ target: s.invoices.localUuid })
        .returning();

      if (invoice) {
        if (customer?.isGstRegistered) {
          await this.erp.enqueue(tx, 'irn_generate', invoice.id, { invoiceId: invoice.id });
        }
        if (customer && customer.paymentMethod === 'credit') {
          await tx
            .update(s.customers)
            .set({ creditUsed: round2(customer.creditUsed + p.netAmount) })
            .where(eq(s.customers.id, customer.id));
        }
      }
    }

    if (p.customerId) {
      await tx
        .update(s.customers)
        .set({
          lastOrderDate: new Date(p.orderDate).toISOString().slice(0, 10),
          lastOrderValue: p.netAmount,
        })
        .where(eq(s.customers.id, p.customerId));
    }

    await this.erp.enqueue(tx, 'push_invoice', order.id, { orderId: order.id });
    return order.id;
  }

  private async moveStock(
    tx: Tx,
    dayTripId: string,
    itemId: string,
    batchId: string | null,
    deltaPcs: number,
    opts: { txnType: string; refId?: string; soldDelta?: number; focDelta?: number; transferInDelta?: number; transferOutDelta?: number; returnedDelta?: number },
  ) {
    const batchCond = batchId ? eq(s.vanStock.batchId, batchId) : isNull(s.vanStock.batchId);
    let [row] = await tx
      .select()
      .from(s.vanStock)
      .where(and(eq(s.vanStock.dayTripId, dayTripId), eq(s.vanStock.itemId, itemId), batchCond));

    // Fall back to any batch row of the item — the device prices per item and
    // doesn't track batch splits, while gate-pass loads are batch-keyed.
    if (!row) {
      [row] = await tx
        .select()
        .from(s.vanStock)
        .where(and(eq(s.vanStock.dayTripId, dayTripId), eq(s.vanStock.itemId, itemId)));
    }
    if (!row) {
      if (deltaPcs < 0) throw new Error('No van stock for item — cannot deduct');
      [row] = await tx
        .insert(s.vanStock)
        .values({ dayTripId, itemId, batchId, currentPcs: 0 })
        .returning();
    }
    const newCurrent = row.currentPcs + deltaPcs;
    if (newCurrent < 0) {
      throw new Error(`Stock would go negative for item ${itemId} (${row.currentPcs} + ${deltaPcs})`);
    }
    await tx
      .update(s.vanStock)
      .set({
        currentPcs: newCurrent,
        soldPcs: row.soldPcs + (opts.soldDelta ?? 0),
        focPcs: row.focPcs + (opts.focDelta ?? 0),
        transferredInPcs: row.transferredInPcs + (opts.transferInDelta ?? 0),
        transferredOutPcs: row.transferredOutPcs + (opts.transferOutDelta ?? 0),
        returnedPcs: row.returnedPcs + (opts.returnedDelta ?? 0),
      })
      .where(eq(s.vanStock.id, row.id));
    await tx.insert(s.stockLedger).values({
      dayTripId,
      itemId,
      batchId: row.batchId,
      txnType: opts.txnType,
      qtyPcs: deltaPcs,
      refTable: 'orders',
      refId: opts.refId,
    });
  }

  // ── payments ──────────────────────────────────────────────────────────────

  private async applyPayment(tx: Tx, userId: string, p: any): Promise<string> {
    const trip = await this.trip(tx, userId);

    let orderId: string | null = null;
    let invoiceId: string | null = null;
    if (p.orderLocalUuid) {
      const [order] = await tx.select().from(s.orders).where(eq(s.orders.localUuid, p.orderLocalUuid));
      if (order) {
        orderId = order.id;
        const [inv] = await tx.select().from(s.invoices).where(eq(s.invoices.orderId, order.id));
        invoiceId = inv?.id ?? null;
        await tx.update(s.orders).set({ status: 'paid' }).where(eq(s.orders.id, order.id));
      }
    }

    const [payment] = await tx
      .insert(s.payments)
      .values({
        localUuid: p.localUuid,
        paymentNo: `PAY-${p.localUuid.slice(0, 8).toUpperCase()}`,
        dayTripId: trip.id,
        customerId: p.customerId,
        invoiceId,
        orderId,
        mode: p.mode,
        bank: p.bank ?? null,
        chequeNo: p.chequeNo ?? null,
        chequeDate: p.chequeDate ?? null,
        couponCount: p.couponCount ?? 0,
        amount: p.amount,
        collectedAt: new Date(p.collectedAt),
      })
      .onConflictDoNothing({ target: s.payments.localUuid })
      .returning();
    if (!payment) {
      const [existing] = await tx.select().from(s.payments).where(eq(s.payments.localUuid, p.localUuid));
      return existing.id;
    }
    await this.erp.enqueue(tx, 'push_payment', payment.id, { paymentId: payment.id });
    return payment.id;
  }

  // ── empty jar collections ─────────────────────────────────────────────────

  private async applyJarCollection(tx: Tx, userId: string, p: any): Promise<string> {
    const trip = await this.trip(tx, userId);
    const [header] = await tx
      .insert(s.emptyJarCollections)
      .values({
        localUuid: p.localUuid,
        dayTripId: trip.id,
        customerId: p.customerId,
        totalQty: p.totalQty,
        totalValue: p.totalValue,
      })
      .onConflictDoNothing({ target: s.emptyJarCollections.localUuid })
      .returning();
    if (!header) {
      const [existing] = await tx
        .select()
        .from(s.emptyJarCollections)
        .where(eq(s.emptyJarCollections.localUuid, p.localUuid));
      return existing.id;
    }
    for (const line of p.lines) {
      await tx.insert(s.emptyJarLines).values({
        collectionId: header.id,
        itemId: line.itemId,
        qty: line.qty,
        unitValue: line.unitValue,
      });
      await tx.insert(s.stockLedger).values({
        dayTripId: trip.id,
        itemId: line.itemId,
        txnType: 'jar_in',
        qtyPcs: line.qty,
        refTable: 'empty_jar_collections',
        refId: header.id,
      });
    }
    return header.id;
  }

  // ── van transfers ─────────────────────────────────────────────────────────

  private async applyVanTransfer(tx: Tx, userId: string, p: any): Promise<string> {
    const trip = await this.trip(tx, userId);

    if (p.direction === 'out') {
      const [transfer] = await tx
        .insert(s.vanTransfers)
        .values({
          localUuid: p.localUuid,
          fromUserId: userId,
          toUserId: p.counterpartyUserId,
          fromVanId: trip.vanId,
          status: 'pending',
        })
        .onConflictDoNothing({ target: s.vanTransfers.localUuid })
        .returning();
      if (!transfer) {
        const [existing] = await tx
          .select()
          .from(s.vanTransfers)
          .where(eq(s.vanTransfers.localUuid, p.localUuid));
        return existing.id;
      }
      for (const line of p.lines ?? []) {
        const [item] = await tx.select().from(s.items).where(eq(s.items.id, line.itemId));
        if (!item) throw new Error(`Unknown item ${line.itemId}`);
        const total = line.qtyCases * item.pcsPerCase + line.qtyPcs;
        await tx.insert(s.vanTransferLines).values({
          transferId: transfer.id,
          itemId: line.itemId,
          batchId: line.batchId ?? null,
          qtyCases: line.qtyCases,
          qtyPcs: line.qtyPcs,
          qtyTotalPcs: total,
        });
        await this.moveStock(tx, trip.id, line.itemId, line.batchId ?? null, -total, {
          txnType: 'transfer_out',
          refId: transfer.id,
          transferOutDelta: total,
        });
      }
      await tx.insert(s.appNotifications).values({
        userId: p.counterpartyUserId,
        type: 'transfer_in',
        payload: { transferId: transfer.id, fromUserId: userId },
      });
      return transfer.id;
    }

    // accept_in — stock increments ONLY on acceptance (blueprint rule)
    const [transfer] = await tx
      .select()
      .from(s.vanTransfers)
      .where(
        p.transferId
          ? eq(s.vanTransfers.id, p.transferId)
          : eq(s.vanTransfers.localUuid, p.transferLocalUuid ?? p.localUuid),
      );
    if (!transfer) throw new Error('Transfer not found');
    if (transfer.toUserId !== userId) throw new Error('Not your transfer');
    if (transfer.status === 'accepted') return transfer.id;

    const lines = await tx
      .select()
      .from(s.vanTransferLines)
      .where(eq(s.vanTransferLines.transferId, transfer.id));
    for (const line of lines) {
      await this.moveStock(tx, trip.id, line.itemId, line.batchId, line.qtyTotalPcs, {
        txnType: 'transfer_in',
        refId: transfer.id,
        transferInDelta: line.qtyTotalPcs,
      });
    }
    await tx
      .update(s.vanTransfers)
      .set({ status: 'accepted', acceptedAt: new Date(), toVanId: trip.vanId })
      .where(eq(s.vanTransfers.id, transfer.id));
    return transfer.id;
  }

  // ── check-in demand ───────────────────────────────────────────────────────

  private async applyDemand(tx: Tx, userId: string, p: any): Promise<string> {
    const trip = await this.trip(tx, userId);
    const [demand] = await tx
      .insert(s.checkInDemands)
      .values({
        localUuid: p.localUuid,
        dayTripId: trip.id,
        userId,
        demandDate: p.demandDate,
      })
      .onConflictDoNothing({ target: s.checkInDemands.localUuid })
      .returning();
    if (!demand) {
      const [existing] = await tx
        .select()
        .from(s.checkInDemands)
        .where(eq(s.checkInDemands.localUuid, p.localUuid));
      // Edit flow: replace lines.
      await tx.delete(s.checkInDemandLines).where(eq(s.checkInDemandLines.demandId, existing.id));
      for (const line of p.lines) {
        await tx.insert(s.checkInDemandLines).values({
          demandId: existing.id,
          itemId: line.itemId,
          qtyCases: line.qtyCases,
          qtyPcs: line.qtyPcs,
        });
      }
      return existing.id;
    }
    for (const line of p.lines) {
      await tx.insert(s.checkInDemandLines).values({
        demandId: demand.id,
        itemId: line.itemId,
        qtyCases: line.qtyCases,
        qtyPcs: line.qtyPcs,
      });
    }
    if (trip.state === 'day_started') {
      await tx.update(s.dayTrips).set({ state: 'demand_created' }).where(eq(s.dayTrips.id, trip.id));
    }
    await this.erp.enqueue(tx, 'push_demand', demand.id, { demandId: demand.id });
    return demand.id;
  }

  // ── settlement ────────────────────────────────────────────────────────────

  private async applySettlement(tx: Tx, userId: string, p: any): Promise<string> {
    const trip = await this.trip(tx, userId);

    // Server recomputes EXPECTED from its own ledgers — the rep only supplies actuals.
    const [orderAgg] = await tx
      .select({
        invoiced: sql<number>`coalesce(sum(${s.orders.netAmount}) filter (where ${s.orders.orderType} = 'sale'), 0)`,
        focAmount: sql<number>`coalesce(sum(${s.orders.grossAmount}) filter (where ${s.orders.orderType} = 'foc'), 0)`,
      })
      .from(s.orders)
      .where(eq(s.orders.dayTripId, trip.id));

    const [payAgg] = await tx
      .select({
        digital: sql<number>`coalesce(sum(${s.payments.amount}) filter (where ${s.payments.mode} in ('paytm','cheque','coupon')), 0)`,
      })
      .from(s.payments)
      .where(eq(s.payments.dayTripId, trip.id));

    const [creditAgg] = await tx
      .select({
        credit: sql<number>`coalesce(sum(${s.orders.netAmount}), 0)`,
      })
      .from(s.orders)
      .innerJoin(s.customers, eq(s.orders.customerId, s.customers.id))
      .where(and(eq(s.orders.dayTripId, trip.id), eq(s.customers.paymentMethod, 'credit'), eq(s.orders.orderType, 'sale')));

    const stockRows = await tx.select().from(s.vanStock).where(eq(s.vanStock.dayTripId, trip.id));
    const loaded = stockRows.reduce((sum, r) => sum + r.loadedPcs, 0);
    const sold = stockRows.reduce((sum, r) => sum + r.soldPcs, 0);
    const foc = stockRows.reduce((sum, r) => sum + r.focPcs, 0);
    const tin = stockRows.reduce((sum, r) => sum + r.transferredInPcs, 0);
    const tout = stockRows.reduce((sum, r) => sum + r.transferredOutPcs, 0);

    const [jarAgg] = await tx
      .select({
        sold: sql<number>`coalesce(sum(${s.orderLines.qtyTotalPcs}), 0)`,
        received: sql<number>`coalesce(sum(${s.orderLines.emptyJarsReceived}), 0)`,
      })
      .from(s.orderLines)
      .innerJoin(s.orders, eq(s.orderLines.orderId, s.orders.id))
      .innerJoin(s.items, eq(s.orderLines.itemId, s.items.id))
      .where(and(eq(s.orders.dayTripId, trip.id), eq(s.items.isTwoWay, true)));

    const [shortfallAgg] = await tx
      .select({ qty: sql<number>`coalesce(sum(${s.orders.jarShortfallQty}), 0)` })
      .from(s.orders)
      .where(eq(s.orders.dayTripId, trip.id));

    const result = computeSettlement({
      invoicedTotal: Number(orderAgg.invoiced),
      creditTotal: Number(creditAgg.credit),
      digitalTotal: Number(payAgg.digital),
      cashDeposited: p.cashActual,
      loadedPcs: loaded,
      soldPcs: sold,
      focPcs: foc,
      transferInPcs: tin,
      transferOutPcs: tout,
      replacementInPcs: 0,
      stockReturnedPcs: p.stockActualPcs,
      twoWayUnitsSold: Number(jarAgg.sold),
      jarsCollected: Number(jarAgg.received),
      jarShortfallBilledQty: Number(shortfallAgg.qty),
      jarsPhysicalCount: p.jarsActual,
      focNormAmount: Number(orderAgg.focAmount), // norm = booked FOC; over-norm scoring is a later phase
      focActualAmount: p.focActualAmount,
    });

    const by = (ledger: string) => {
      const found = result.ledgers.find((l) => l.ledger === ledger);
      if (!found) throw new Error(`Missing ledger ${ledger}`);
      return found;
    };
    const cash = by('cash');
    const stock = by('stock');
    const jars = by('jars');
    const focL = by('foc');

    const values = {
      localUuid: p.localUuid,
      dayTripId: trip.id,
      cashExpected: cash.expected,
      cashActual: cash.actual,
      cashVariance: cash.variance,
      stockExpectedPcs: Math.round(stock.expected),
      stockActualPcs: Math.round(stock.actual),
      stockVariancePcs: Math.round(stock.variance),
      jarsExpected: Math.round(jars.expected),
      jarsActual: Math.round(jars.actual),
      jarsVariance: Math.round(jars.variance),
      focNormAmount: focL.expected,
      focActualAmount: focL.actual,
      focVariance: focL.variance,
      status: result.balanced ? 'balanced' : 'open',
    };

    const [settlement] = await tx
      .insert(s.settlements)
      .values(values)
      .onConflictDoUpdate({ target: s.settlements.dayTripId, set: values })
      .returning();

    await tx.delete(s.settlementVariances).where(eq(s.settlementVariances.settlementId, settlement.id));
    for (const ledger of result.ledgers) {
      if (!ledger.withinTolerance) {
        await tx.insert(s.settlementVariances).values({
          settlementId: settlement.id,
          ledger: ledger.ledger,
          expected: ledger.expected,
          actual: ledger.actual,
          delta: ledger.variance,
          score: Math.abs(ledger.variance),
        });
      }
    }

    if (result.balanced && (trip.state === 'demand_created' || trip.state === 'day_started')) {
      await tx.update(s.dayTrips).set({ state: 'settled' }).where(eq(s.dayTrips.id, trip.id));
    }
    return settlement.id;
  }

  // ── customer onboarding ───────────────────────────────────────────────────

  private async applyOnboarding(tx: Tx, userId: string, p: any): Promise<string> {
    const [row] = await tx
      .insert(s.customerOnboarding)
      .values({
        localUuid: p.localUuid,
        createdBy: userId,
        name: p.name,
        phone: p.phone,
        address1: p.address1,
        address2: p.address2 ?? null,
        pincode: p.pincode ?? null,
        routeId: p.routeId,
        subCategory: p.subCategory,
        gstin: p.gstin ?? null,
        lat: p.lat,
        lng: p.lng,
      })
      .onConflictDoNothing({ target: s.customerOnboarding.localUuid })
      .returning();
    if (!row) {
      const [existing] = await tx
        .select()
        .from(s.customerOnboarding)
        .where(eq(s.customerOnboarding.localUuid, p.localUuid));
      return existing.id;
    }
    await this.erp.enqueue(tx, 'push_customer', row.id, { onboardingId: row.id });
    return row.id;
  }

  // ── notifications ─────────────────────────────────────────────────────────

  async pendingNotifications(userId: string) {
    const db = getDb();
    return db
      .select()
      .from(s.appNotifications)
      .where(and(eq(s.appNotifications.userId, userId), isNull(s.appNotifications.readAt)));
  }
}
