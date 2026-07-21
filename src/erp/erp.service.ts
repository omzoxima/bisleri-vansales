import { Injectable } from '@nestjs/common';
import { schema as s } from '../db/client';

/**
 * ERP job enqueuing. Jobs are written INSIDE the same transaction as the
 * business record, so an order can never exist without its ERP push job
 * (Power Automate's "flow didn't fire" failure mode is impossible by design).
 *
 * The worker (erp.worker.ts) drains the table with retries. Swap the stub
 * connector for the real NAV/D365 staging-table or OData client without
 * touching any of the sync logic.
 */
@Injectable()
export class ErpService {
  async enqueue(
    tx: any,
    jobType: string,
    refId: string | null,
    payload: object,
  ): Promise<void> {
    await tx.insert(s.erpJobs).values({ jobType, refId, payload });
  }
}
