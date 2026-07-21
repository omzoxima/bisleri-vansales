import { z } from 'zod';
import {
  CHEQUE_BANKS,
  FOC_REASONS,
  ORDER_TYPES,
  PAYMENT_MODES,
  VISIT_OUTCOMES,
  VISIT_TYPES,
} from './constants';

/**
 * Sync contract between device and server.
 *
 * Every business event captured offline becomes one outbox entry:
 *   { idempotencyKey, seq, entity, payload }
 * The server applies entries in seq order and upserts by idempotencyKey,
 * so a dropped connection can never double-post or lose a transaction.
 */

const uuid = z.string().uuid();
const isoDate = z.string(); // ISO 8601 timestamp
const money = z.number().finite();
const qty = z.number().int().min(0);

export const visitPushSchema = z.object({
  localUuid: uuid,
  customerId: uuid,
  visitType: z.enum(VISIT_TYPES),
  checkInTime: isoDate,
  checkOutTime: isoDate.nullish(),
  checkInLat: z.number(),
  checkInLng: z.number(),
  distanceFromCustomerM: z.number().nullish(),
  outcome: z.enum(VISIT_OUTCOMES).nullish(),
});

export const orderLinePushSchema = z.object({
  localUuid: uuid,
  itemId: uuid,
  batchId: uuid.nullish(),
  qtyCases: qty,
  qtyPcs: qty,
  qtyTotalPcs: qty,
  unitPrice: money,
  discountValue: money.default(0),
  schemeFree: z.boolean().default(false),
  emptyJarsReceived: qty.default(0),
  returnReason: z.string().nullish(),
  mfgDate: z.string().nullish(),
  lineAmount: money,
  cgst: money.default(0),
  sgst: money.default(0),
  cess: money.default(0),
  netAmount: money,
});

export const orderPushSchema = z.object({
  localUuid: uuid,
  visitLocalUuid: uuid.nullish(),
  customerId: uuid.nullish(), // null allowed for RTO-only FOC
  orderType: z.enum(ORDER_TYPES),
  orderDate: isoDate,
  grossAmount: money,
  discountAmount: money.default(0),
  schemeAmount: money.default(0),
  jarShortfallQty: qty.default(0),
  jarShortfallAmount: money.default(0),
  taxableAmount: money,
  cgst: money.default(0),
  sgst: money.default(0),
  cess: money.default(0),
  netAmount: money,
  focReason: z.enum(FOC_REASONS).nullish(),
  invoiceNo: z.string().nullish(), // consumed offline from the allocated block
  customerSignatureB64: z.string().nullish(),
  repSignatureB64: z.string().nullish(),
  lines: z.array(orderLinePushSchema).min(1),
});

export const paymentPushSchema = z.object({
  localUuid: uuid,
  customerId: uuid,
  orderLocalUuid: uuid.nullish(),
  mode: z.enum(PAYMENT_MODES),
  bank: z.enum(CHEQUE_BANKS).nullish(),
  chequeNo: z
    .string()
    .regex(/^\d{6}$/)
    .nullish(),
  chequeDate: z.string().nullish(),
  couponCount: qty.nullish(),
  amount: money.positive(),
  collectedAt: isoDate,
});

export const jarCollectionPushSchema = z.object({
  localUuid: uuid,
  visitLocalUuid: uuid.nullish(),
  customerId: uuid,
  totalQty: qty,
  totalValue: money,
  customerSignatureB64: z.string().nullish(),
  repSignatureB64: z.string().nullish(),
  lines: z
    .array(z.object({ itemId: uuid, qty: qty.min(1), unitValue: money }))
    .min(1),
});

export const transferPushSchema = z.object({
  localUuid: uuid,
  direction: z.enum(['out', 'accept_in']),
  counterpartyUserId: uuid,
  transferLocalUuid: uuid.nullish(), // for accept_in: the transfer being accepted (by localUuid)
  transferId: uuid.nullish(), // for accept_in: server id from the push notification
  lines: z
    .array(
      z.object({ itemId: uuid, batchId: uuid.nullish(), qtyCases: qty, qtyPcs: qty }),
    )
    .optional(),
});

export const demandPushSchema = z.object({
  localUuid: uuid,
  demandDate: z.string(),
  lines: z
    .array(
      z
        .object({ itemId: uuid, qtyCases: qty, qtyPcs: qty })
        .refine((l) => (l.qtyCases > 0) !== (l.qtyPcs > 0), {
          message: 'Enter cases OR pcs, not both',
        }),
    )
    .min(1),
});

export const dayEventPushSchema = z.object({
  localUuid: uuid,
  event: z.enum(['gate_pass_verified', 'day_started', 'day_ended']),
  at: isoDate,
  lat: z.number().nullish(),
  lng: z.number().nullish(),
  gatePassId: uuid.nullish(),
  signatureB64: z.string().nullish(),
});

export const settlementPushSchema = z.object({
  localUuid: uuid,
  cashActual: money,
  stockActualPcs: qty,
  jarsActual: qty,
  focActualAmount: money,
});

export const customerOnboardPushSchema = z.object({
  localUuid: uuid,
  name: z.string().min(2),
  phone: z.string().min(10),
  address1: z.string().min(3),
  address2: z.string().nullish(),
  pincode: z.string().nullish(),
  routeId: uuid,
  subCategory: z.string(),
  gstin: z.string().nullish(),
  lat: z.number().nullish(),
  lng: z.number().nullish(),
});

export const PUSH_ENTITIES = {
  visit: visitPushSchema,
  order: orderPushSchema,
  payment: paymentPushSchema,
  jar_collection: jarCollectionPushSchema,
  van_transfer: transferPushSchema,
  check_in_demand: demandPushSchema,
  day_event: dayEventPushSchema,
  settlement: settlementPushSchema,
  customer_onboarding: customerOnboardPushSchema,
} as const;
export type PushEntity = keyof typeof PUSH_ENTITIES;

export const pushEnvelopeSchema = z.object({
  idempotencyKey: uuid,
  seq: z.number().int().min(0),
  entity: z.string(),
  dayTripLocalUuid: uuid.nullish(),
  recordedAt: isoDate,
  payload: z.unknown(),
});
export type PushEnvelope = z.infer<typeof pushEnvelopeSchema>;

export const pushBatchSchema = z.object({
  deviceId: z.string(),
  entries: z.array(pushEnvelopeSchema).max(200),
});
export type PushBatch = z.infer<typeof pushBatchSchema>;

export interface PushResult {
  idempotencyKey: string;
  status: 'applied' | 'duplicate' | 'rejected';
  error?: string;
  serverId?: string;
}

export interface MasterPullRequest {
  /** ISO timestamp per table of last successful pull; missing key = full pull. */
  since: Partial<Record<string, string>>;
}

export interface MasterPullResponse {
  serverTime: string;
  tables: Record<string, unknown[]>;
}

export interface DayStartResponse {
  dayTripId: string;
  tripDate: string;
  invoicePrefix: string;
  invoiceSeqStart: number;
  invoiceSeqEnd: number;
  gatePass: unknown | null;
}
