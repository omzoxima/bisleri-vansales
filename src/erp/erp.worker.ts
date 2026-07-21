import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { asc, eq, lt, and } from 'drizzle-orm';
import { createHash } from 'crypto';
import { getDb, schema as s } from '../db/client';

const MAX_ATTEMPTS = 5;

/**
 * Drains erp_jobs. Replaces the Power Automate flow layer with a plain,
 * observable worker: pending → processing → done/failed with retries and
 * a durable error trail (no more silently-disabled flows after deployment).
 *
 * Connectors below are STUBS logging what they would post. Wire the real
 * NAV/D365 staging-table client and the ClearTax API here.
 */
@Injectable()
export class ErpWorker {
  private readonly log = new Logger(ErpWorker.name);
  private running = false;

  @Interval(30_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.drain();
    } catch (err: any) {
      // Transient network drops to Azure PG are expected in dev (laptop →
      // public internet). Jobs stay pending and the next tick retries.
      if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|timeout/i.test(String(err?.message))) {
        this.log.warn(`Azure PG unreachable this tick — will retry in 30 s (${err?.message})`);
      } else {
        this.log.error(`worker tick failed: ${err?.message}`);
      }
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<void> {
    const db = getDb();
    const jobs = await db
      .select()
      .from(s.erpJobs)
      .where(and(eq(s.erpJobs.status, 'pending'), lt(s.erpJobs.attempts, MAX_ATTEMPTS)))
      .orderBy(asc(s.erpJobs.createdAt))
      .limit(20);

    for (const job of jobs) {
      try {
        await db
          .update(s.erpJobs)
          .set({ status: 'processing', attempts: job.attempts + 1 })
          .where(eq(s.erpJobs.id, job.id));

        switch (job.jobType) {
          case 'irn_generate':
            await this.generateIrn((job.payload as any)?.invoiceId);
            break;
          default:
            // push_invoice / push_payment / push_demand / push_customer / push_day_end
            this.log.log(`[ERP stub] ${job.jobType} ref=${job.refId}`);
            break;
        }

        await db
          .update(s.erpJobs)
          .set({ status: 'done', completedAt: new Date() })
          .where(eq(s.erpJobs.id, job.id));
      } catch (err: any) {
        const failed = job.attempts + 1 >= MAX_ATTEMPTS;
        this.log.warn(`job ${job.jobType}/${job.id} attempt ${job.attempts + 1} failed: ${err?.message}`);
        await db
          .update(s.erpJobs)
          .set({ status: failed ? 'failed' : 'pending', lastError: String(err?.message ?? err) })
          .where(eq(s.erpJobs.id, job.id));
      }
    }
  }

  /**
   * ClearTax IRN stub: deterministic mock IRN + QR payload. The invoice is
   * only flagged 'generated' AFTER this completes — fixing the go-live bug
   * "IRN showing generated successfully but not generated". Until then the
   * printed document is a Delivery Challan, not a Tax Invoice.
   */
  private async generateIrn(invoiceId: string | undefined): Promise<void> {
    if (!invoiceId) throw new Error('irn_generate without invoiceId');
    const db = getDb();
    const [invoice] = await db.select().from(s.invoices).where(eq(s.invoices.id, invoiceId));
    if (!invoice) throw new Error(`invoice ${invoiceId} not found`);
    if (invoice.irnStatus === 'generated') return;

    const irn = createHash('sha256')
      .update(`${invoice.invoiceNo}|${invoice.totalAmount}|${invoice.invoiceDate.toISOString()}`)
      .digest('hex');
    await db
      .update(s.invoices)
      .set({
        irn,
        irnStatus: 'generated',
        irnGeneratedAt: new Date(),
        qrCodePayload: JSON.stringify({ irn, no: invoice.invoiceNo, amt: invoice.totalAmount }),
        docType: 'tax_invoice',
      })
      .where(eq(s.invoices.id, invoiceId));
    this.log.log(`[ClearTax stub] IRN generated for ${invoice.invoiceNo}`);
  }
}
