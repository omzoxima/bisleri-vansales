import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
/**
 * System-of-record schema (PostgreSQL). Mirrors ARCHITECTURE.md §4.
 * Quantities are stored in PIECES (base UOM); conversion via items.pcs_per_case.
 * Monetary values are INR rounded to 2 dp by the domain layer.
 */

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

// ───────────────────────────── Identity & territory ─────────────────────────

export const branches = pgTable('branches', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  invoicePrefix: text('invoice_prefix').notNull(), // MI / RI
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable('users', {
  id: id(),
  erpUserCode: text('erp_user_code').notNull().unique(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('rep'),
  branchId: uuid('branch_id').references(() => branches.id),
  deviceId: text('device_id'), // device binding — one enrolled device per rep
  fcmToken: text('fcm_token'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const routes = pgTable('routes', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  branchId: uuid('branch_id').references(() => branches.id).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userRouteMap = pgTable('user_route_map', {
  id: id(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  routeId: uuid('route_id').references(() => routes.id).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const warehouses = pgTable('warehouses', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  branchId: uuid('branch_id').references(() => branches.id).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const vans = pgTable('vans', {
  id: id(),
  code: text('code').notNull().unique(), // V529, PUNE1 …
  registrationNo: text('registration_no'),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id),
  branchId: uuid('branch_id').references(() => branches.id).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userVanMap = pgTable('user_van_map', {
  id: id(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  vanId: uuid('van_id').references(() => vans.id).notNull(),
  effectiveDate: date('effective_date').defaultNow().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────────────────────── Product & pricing masters ────────────────────

export const hsnMasters = pgTable('hsn_masters', {
  id: id(),
  hsnCode: text('hsn_code').notNull().unique(),
  gstRate: doublePrecision('gst_rate').notNull(), // 12 or 18
  cgstRate: doublePrecision('cgst_rate').notNull(), // 6 or 9
  sgstRate: doublePrecision('sgst_rate').notNull(),
  cessRate: doublePrecision('cess_rate').default(0).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const items = pgTable('items', {
  id: id(),
  erpItemCode: text('erp_item_code').notNull().unique(),
  description: text('description').notNull(),
  hsnId: uuid('hsn_id').references(() => hsnMasters.id).notNull(),
  category: text('category'),
  pcsPerCase: integer('pcs_per_case').notNull(),
  isTwoWay: boolean('is_two_way').default(false).notNull(), // returnable jar
  jarDepositValue: doublePrecision('jar_deposit_value').default(150).notNull(),
  mrp: doublePrecision('mrp').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const itemBatches = pgTable('item_batches', {
  id: id(),
  itemId: uuid('item_id').references(() => items.id).notNull(),
  batchNo: text('batch_no').notNull(),
  lotNo: text('lot_no').notNull(),
  mfgDate: date('mfg_date').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const priceLists = pgTable('price_lists', {
  id: id(),
  branchId: uuid('branch_id').references(() => branches.id).notNull(),
  name: text('name').notNull(),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const priceListLines = pgTable('price_list_lines', {
  id: id(),
  priceListId: uuid('price_list_id').references(() => priceLists.id).notNull(),
  itemId: uuid('item_id').references(() => items.id).notNull(),
  unitPrice: doublePrecision('unit_price').notNull(), // tax-inclusive, per pc
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const discountHeaders = pgTable('discount_headers', {
  id: id(),
  customerId: uuid('customer_id').references(() => customers.id),
  customerGroupId: uuid('customer_group_id').references(() => customerGroups.id),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const discountLines = pgTable('discount_lines', {
  id: id(),
  discountHeaderId: uuid('discount_header_id').references(() => discountHeaders.id).notNull(),
  itemId: uuid('item_id').references(() => items.id).notNull(),
  discountPerPc: doublePrecision('discount_per_pc').notNull(), // absolute INR / pc
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const schemeHeaders = pgTable('scheme_headers', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  branchId: uuid('branch_id').references(() => branches.id).notNull(),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const schemeApplicability = pgTable('scheme_applicability', {
  id: id(),
  schemeHeaderId: uuid('scheme_header_id').references(() => schemeHeaders.id).notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  customerGroupId: uuid('customer_group_id').references(() => customerGroups.id),
  routeId: uuid('route_id').references(() => routes.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const schemeOrderItems = pgTable('scheme_order_items', {
  id: id(),
  schemeHeaderId: uuid('scheme_header_id').references(() => schemeHeaders.id).notNull(),
  itemId: uuid('item_id').references(() => items.id).notNull(),
  minQtyPcs: integer('min_qty_pcs').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const schemeOfferItems = pgTable('scheme_offer_items', {
  id: id(),
  schemeHeaderId: uuid('scheme_header_id').references(() => schemeHeaders.id).notNull(),
  itemId: uuid('item_id').references(() => items.id).notNull(),
  freeQtyPcs: integer('free_qty_pcs').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────────────────────── Customers ────────────────────────────────────

export const customerGroups = pgTable('customer_groups', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const customers = pgTable('customers', {
  id: id(),
  erpCustomerCode: text('erp_customer_code').unique(),
  name: text('name').notNull(),
  contactPerson: text('contact_person'),
  phone: text('phone'),
  email: text('email'),
  address1: text('address1'),
  address2: text('address2'),
  city: text('city'),
  district: text('district'),
  state: text('state'),
  pincode: text('pincode'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  routeId: uuid('route_id').references(() => routes.id),
  branchId: uuid('branch_id').references(() => branches.id),
  customerGroupId: uuid('customer_group_id').references(() => customerGroups.id),
  subCategory: text('sub_category'),
  customerType: text('customer_type'), // e.g. COR-ROT
  paymentMethod: text('payment_method').notNull().default('cash'), // cash|credit|coupon|kotak|paytm
  isGstRegistered: boolean('is_gst_registered').default(false).notNull(),
  gstin: text('gstin'),
  pan: text('pan'),
  fssaiNo: text('fssai_no'),
  aadhaar: text('aadhaar'),
  creditLimit: doublePrecision('credit_limit').default(0).notNull(),
  creditUsed: doublePrecision('credit_used').default(0).notNull(),
  dob: date('dob'),
  anniversary: date('anniversary'),
  status: text('status').notNull().default('onboarded'), // verification|onboarded|rejected
  lastOrderDate: date('last_order_date'),
  lastOrderValue: doublePrecision('last_order_value'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const customerBankDetails = pgTable('customer_bank_details', {
  id: id(),
  customerId: uuid('customer_id').references(() => customers.id).notNull(),
  bankName: text('bank_name'),
  accountNo: text('account_no'),
  ifsc: text('ifsc'),
  branchName: text('branch_name'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────────────────────── Trip / day lifecycle ─────────────────────────

export const dayTrips = pgTable(
  'day_trips',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    vanId: uuid('van_id').references(() => vans.id),
    routeId: uuid('route_id').references(() => routes.id),
    tripDate: date('trip_date').notNull(),
    state: text('state').notNull().default('logged_in'),
    startTime: timestamp('start_time', { withTimezone: true }),
    startLat: doublePrecision('start_lat'),
    startLng: doublePrecision('start_lng'),
    endTime: timestamp('end_time', { withTimezone: true }),
    endLat: doublePrecision('end_lat'),
    endLng: doublePrecision('end_lng'),
    attendanceType: text('attendance_type'),
    hoursWorked: doublePrecision('hours_worked'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('day_trips_user_date_uq').on(t.userId, t.tripDate)],
);

export const gatePasses = pgTable('gate_passes', {
  id: id(),
  dayTripId: uuid('day_trip_id').references(() => dayTrips.id),
  userId: uuid('user_id').references(() => users.id).notNull(),
  tripDate: date('trip_date').notNull(),
  erpGatepassNo: text('erp_gatepass_no').notNull(),
  status: text('status').notNull().default('pending'), // pending|verified
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  signatureFileId: uuid('signature_file_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const gatePassLines = pgTable('gate_pass_lines', {
  id: id(),
  gatePassId: uuid('gate_pass_id').references(() => gatePasses.id).notNull(),
  itemId: uuid('item_id').references(() => items.id).notNull(),
  batchId: uuid('batch_id').references(() => itemBatches.id),
  qtyCases: integer('qty_cases').default(0).notNull(),
  qtyPcs: integer('qty_pcs').default(0).notNull(),
  qtyTotalPcs: integer('qty_total_pcs').notNull(),
  verified: boolean('verified').default(false).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const vanStock = pgTable(
  'van_stock',
  {
    id: id(),
    dayTripId: uuid('day_trip_id').references(() => dayTrips.id).notNull(),
    itemId: uuid('item_id').references(() => items.id).notNull(),
    batchId: uuid('batch_id').references(() => itemBatches.id),
    loadedPcs: integer('loaded_pcs').default(0).notNull(),
    soldPcs: integer('sold_pcs').default(0).notNull(),
    focPcs: integer('foc_pcs').default(0).notNull(),
    returnedPcs: integer('returned_pcs').default(0).notNull(),
    transferredInPcs: integer('transferred_in_pcs').default(0).notNull(),
    transferredOutPcs: integer('transferred_out_pcs').default(0).notNull(),
    currentPcs: integer('current_pcs').default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('van_stock_trip_item_batch_uq').on(t.dayTripId, t.itemId, t.batchId)],
);

export const stockLedger = pgTable('stock_ledger', {
  id: id(),
  dayTripId: uuid('day_trip_id').references(() => dayTrips.id).notNull(),
  itemId: uuid('item_id').references(() => items.id).notNull(),
  batchId: uuid('batch_id').references(() => itemBatches.id),
  txnType: text('txn_type').notNull(), // load|sale|foc|replacement_in|replacement_out|jar_in|transfer_in|transfer_out|adjustment
  qtyPcs: integer('qty_pcs').notNull(), // signed
  refTable: text('ref_table'),
  refId: uuid('ref_id'),
  createdAt: createdAt(),
});

// ───────────────────────────── Visits & orders ──────────────────────────────

export const visitPlans = pgTable('visit_plans', {
  id: id(),
  routeId: uuid('route_id').references(() => routes.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  planDate: date('plan_date').notNull(),
  customerId: uuid('customer_id').references(() => customers.id).notNull(),
  sequence: integer('sequence').default(0).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const beatPlans = pgTable('beat_plans', {
  id: id(),
  routeId: uuid('route_id').references(() => routes.id).notNull(),
  dayOfWeek: integer('day_of_week').notNull(), // 0=Sun … 6=Sat
  customerId: uuid('customer_id').references(() => customers.id).notNull(),
  sequence: integer('sequence').default(0).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const visits = pgTable(
  'visits',
  {
    id: id(),
    localUuid: uuid('local_uuid').notNull(),
    dayTripId: uuid('day_trip_id').references(() => dayTrips.id).notNull(),
    customerId: uuid('customer_id').references(() => customers.id).notNull(),
    visitType: text('visit_type').notNull(),
    plannedVisitId: uuid('planned_visit_id').references(() => visitPlans.id),
    checkInTime: timestamp('check_in_time', { withTimezone: true }).notNull(),
    checkOutTime: timestamp('check_out_time', { withTimezone: true }),
    checkInLat: doublePrecision('check_in_lat'),
    checkInLng: doublePrecision('check_in_lng'),
    distanceFromCustomerM: doublePrecision('distance_from_customer_m'),
    outcome: text('outcome'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('visits_local_uuid_uq').on(t.localUuid)],
);

export const orders = pgTable(
  'orders',
  {
    id: id(),
    localUuid: uuid('local_uuid').notNull(),
    orderNo: text('order_no').notNull(),
    dayTripId: uuid('day_trip_id').references(() => dayTrips.id).notNull(),
    visitId: uuid('visit_id').references(() => visits.id),
    customerId: uuid('customer_id').references(() => customers.id),
    orderType: text('order_type').notNull(),
    orderDate: timestamp('order_date', { withTimezone: true }).notNull(),
    grossAmount: doublePrecision('gross_amount').default(0).notNull(),
    discountAmount: doublePrecision('discount_amount').default(0).notNull(),
    schemeAmount: doublePrecision('scheme_amount').default(0).notNull(),
    jarShortfallQty: integer('jar_shortfall_qty').default(0).notNull(),
    jarShortfallAmount: doublePrecision('jar_shortfall_amount').default(0).notNull(),
    taxableAmount: doublePrecision('taxable_amount').default(0).notNull(),
    cgst: doublePrecision('cgst').default(0).notNull(),
    sgst: doublePrecision('sgst').default(0).notNull(),
    cess: doublePrecision('cess').default(0).notNull(),
    netAmount: doublePrecision('net_amount').default(0).notNull(),
    status: text('status').notNull().default('confirmed'),
    focReason: text('foc_reason'),
    customerSignatureFileId: uuid('customer_signature_file_id'),
    repSignatureFileId: uuid('rep_signature_file_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('orders_local_uuid_uq').on(t.localUuid)],
);

export const orderLines = pgTable('order_lines', {
  id: id(),
  orderId: uuid('order_id').references(() => orders.id).notNull(),
  itemId: uuid('item_id').references(() => items.id).notNull(),
  batchId: uuid('batch_id').references(() => itemBatches.id),
  qtyCases: integer('qty_cases').default(0).notNull(),
  qtyPcs: integer('qty_pcs').default(0).notNull(),
  qtyTotalPcs: integer('qty_total_pcs').notNull(),
  unitPrice: doublePrecision('unit_price').default(0).notNull(),
  discountValue: doublePrecision('discount_value').default(0).notNull(),
  schemeFree: boolean('scheme_free').default(false).notNull(),
  emptyJarsReceived: integer('empty_jars_received').default(0).notNull(),
  returnReason: text('return_reason'),
  mfgDate: date('mfg_date'),
  lineAmount: doublePrecision('line_amount').default(0).notNull(),
  cgst: doublePrecision('cgst').default(0).notNull(),
  sgst: doublePrecision('sgst').default(0).notNull(),
  cess: doublePrecision('cess').default(0).notNull(),
  netAmount: doublePrecision('net_amount').default(0).notNull(),
  createdAt: createdAt(),
});

// ───────────────────────────── Invoicing & payments ─────────────────────────

export const invoiceSeriesBlocks = pgTable('invoice_series_blocks', {
  id: id(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  branchId: uuid('branch_id').references(() => branches.id).notNull(),
  tripDate: date('trip_date').notNull(),
  prefix: text('prefix').notNull(),
  seqStart: integer('seq_start').notNull(),
  seqEnd: integer('seq_end').notNull(),
  lastUsedSeq: integer('last_used_seq'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    localUuid: uuid('local_uuid').notNull(),
    invoiceNo: text('invoice_no').notNull().unique(),
    parentInvoiceId: uuid('parent_invoice_id'),
    orderId: uuid('order_id').references(() => orders.id).notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    invoiceDate: timestamp('invoice_date', { withTimezone: true }).notNull(),
    taxableAmount: doublePrecision('taxable_amount').default(0).notNull(),
    cgst: doublePrecision('cgst').default(0).notNull(),
    sgst: doublePrecision('sgst').default(0).notNull(),
    cess: doublePrecision('cess').default(0).notNull(),
    totalAmount: doublePrecision('total_amount').default(0).notNull(),
    amountInWords: text('amount_in_words'),
    irn: text('irn'),
    irnStatus: text('irn_status').notNull().default('not_applicable'), // pending|generated|failed|not_applicable
    irnGeneratedAt: timestamp('irn_generated_at', { withTimezone: true }),
    qrCodePayload: text('qr_code_payload'),
    docType: text('doc_type').notNull().default('tax_invoice'), // tax_invoice|delivery_challan
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('invoices_local_uuid_uq').on(t.localUuid)],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    localUuid: uuid('local_uuid').notNull(),
    paymentNo: text('payment_no').notNull(),
    dayTripId: uuid('day_trip_id').references(() => dayTrips.id).notNull(),
    customerId: uuid('customer_id').references(() => customers.id).notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    orderId: uuid('order_id').references(() => orders.id),
    mode: text('mode').notNull(),
    bank: text('bank'),
    chequeNo: text('cheque_no'),
    chequeDate: date('cheque_date'),
    couponCount: integer('coupon_count').default(0).notNull(),
    amount: doublePrecision('amount').notNull(),
    status: text('status').notNull().default('confirmed'),
    collectedAt: timestamp('collected_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('payments_local_uuid_uq').on(t.localUuid)],
);

// ───────────────────────────── Other transactions ───────────────────────────

export const emptyJarCollections = pgTable(
  'empty_jar_collections',
  {
    id: id(),
    localUuid: uuid('local_uuid').notNull(),
    dayTripId: uuid('day_trip_id').references(() => dayTrips.id).notNull(),
    visitId: uuid('visit_id').references(() => visits.id),
    customerId: uuid('customer_id').references(() => customers.id).notNull(),
    totalQty: integer('total_qty').notNull(),
    totalValue: doublePrecision('total_value').notNull(),
    status: text('status').notNull().default('finalized'),
    customerSignatureFileId: uuid('customer_signature_file_id'),
    repSignatureFileId: uuid('rep_signature_file_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('jar_collections_local_uuid_uq').on(t.localUuid)],
);

export const emptyJarLines = pgTable('empty_jar_lines', {
  id: id(),
  collectionId: uuid('collection_id').references(() => emptyJarCollections.id).notNull(),
  itemId: uuid('item_id').references(() => items.id).notNull(),
  qty: integer('qty').notNull(),
  unitValue: doublePrecision('unit_value').notNull(),
  createdAt: createdAt(),
});

export const vanTransfers = pgTable(
  'van_transfers',
  {
    id: id(),
    localUuid: uuid('local_uuid').notNull(),
    fromUserId: uuid('from_user_id').references(() => users.id).notNull(),
    toUserId: uuid('to_user_id').references(() => users.id).notNull(),
    fromVanId: uuid('from_van_id').references(() => vans.id),
    toVanId: uuid('to_van_id').references(() => vans.id),
    status: text('status').notNull().default('pending'),
    initiatedAt: timestamp('initiated_at', { withTimezone: true }).defaultNow().notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('van_transfers_local_uuid_uq').on(t.localUuid)],
);

export const vanTransferLines = pgTable('van_transfer_lines', {
  id: id(),
  transferId: uuid('transfer_id').references(() => vanTransfers.id).notNull(),
  itemId: uuid('item_id').references(() => items.id).notNull(),
  batchId: uuid('batch_id').references(() => itemBatches.id),
  qtyCases: integer('qty_cases').default(0).notNull(),
  qtyPcs: integer('qty_pcs').default(0).notNull(),
  qtyTotalPcs: integer('qty_total_pcs').notNull(),
  createdAt: createdAt(),
});

export const checkInDemands = pgTable(
  'check_in_demands',
  {
    id: id(),
    localUuid: uuid('local_uuid').notNull(),
    dayTripId: uuid('day_trip_id').references(() => dayTrips.id).notNull(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    demandDate: date('demand_date').notNull(),
    status: text('status').notNull().default('submitted'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('demands_local_uuid_uq').on(t.localUuid)],
);

export const checkInDemandLines = pgTable('check_in_demand_lines', {
  id: id(),
  demandId: uuid('demand_id').references(() => checkInDemands.id).notNull(),
  itemId: uuid('item_id').references(() => items.id).notNull(),
  qtyCases: integer('qty_cases').default(0).notNull(),
  qtyPcs: integer('qty_pcs').default(0).notNull(),
  createdAt: createdAt(),
});

export const settlements = pgTable(
  'settlements',
  {
    id: id(),
    localUuid: uuid('local_uuid'),
    dayTripId: uuid('day_trip_id').references(() => dayTrips.id).notNull().unique(),
    cashExpected: doublePrecision('cash_expected').default(0).notNull(),
    cashActual: doublePrecision('cash_actual').default(0).notNull(),
    cashVariance: doublePrecision('cash_variance').default(0).notNull(),
    stockExpectedPcs: integer('stock_expected_pcs').default(0).notNull(),
    stockActualPcs: integer('stock_actual_pcs').default(0).notNull(),
    stockVariancePcs: integer('stock_variance_pcs').default(0).notNull(),
    jarsExpected: integer('jars_expected').default(0).notNull(),
    jarsActual: integer('jars_actual').default(0).notNull(),
    jarsVariance: integer('jars_variance').default(0).notNull(),
    focNormAmount: doublePrecision('foc_norm_amount').default(0).notNull(),
    focActualAmount: doublePrecision('foc_actual_amount').default(0).notNull(),
    focVariance: doublePrecision('foc_variance').default(0).notNull(),
    status: text('status').notNull().default('open'), // open|balanced|escalated|closed
    closedBy: uuid('closed_by').references(() => users.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
);

export const settlementVariances = pgTable('settlement_variances', {
  id: id(),
  settlementId: uuid('settlement_id').references(() => settlements.id).notNull(),
  ledger: text('ledger').notNull(),
  itemId: uuid('item_id').references(() => items.id),
  expected: doublePrecision('expected').notNull(),
  actual: doublePrecision('actual').notNull(),
  delta: doublePrecision('delta').notNull(),
  score: doublePrecision('score').default(0).notNull(),
  resolution: text('resolution'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const customerOnboarding = pgTable(
  'customer_onboarding',
  {
    id: id(),
    localUuid: uuid('local_uuid').notNull(),
    createdBy: uuid('created_by').references(() => users.id).notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    address1: text('address1').notNull(),
    address2: text('address2'),
    pincode: text('pincode'),
    routeId: uuid('route_id').references(() => routes.id).notNull(),
    subCategory: text('sub_category'),
    gstin: text('gstin'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    status: text('status').notNull().default('verification'), // verification|onboarded|rejected
    erpCustomerCode: text('erp_customer_code'),
    customerId: uuid('customer_id').references(() => customers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('onboarding_local_uuid_uq').on(t.localUuid)],
);

// ───────────────────────────── Platform plumbing ────────────────────────────

/** Server-side inbox: one row per applied outbox entry — the idempotency guard. */
export const syncEvents = pgTable(
  'sync_events',
  {
    id: id(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    deviceId: text('device_id').notNull(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    seq: integer('seq').notNull(),
    entity: text('entity').notNull(),
    status: text('status').notNull(), // applied|rejected
    error: text('error'),
    serverId: uuid('server_id'),
    payload: jsonb('payload'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sync_events_idem_uq').on(t.idempotencyKey)],
);

export const erpJobs = pgTable('erp_jobs', {
  id: id(),
  jobType: text('job_type').notNull(), // push_invoice|push_payment|push_stock|push_demand|irn_generate|push_customer
  refId: uuid('ref_id'),
  payload: jsonb('payload'),
  status: text('status').notNull().default('pending'), // pending|processing|done|failed
  attempts: integer('attempts').default(0).notNull(),
  lastError: text('last_error'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const files = pgTable('files', {
  id: id(),
  kind: text('kind').notNull(), // signature|photo_evidence|print_copy
  ownerTable: text('owner_table'),
  ownerId: uuid('owner_id'),
  contentB64: text('content_b64'), // swap for Blob storage URL in production
  sha256: text('sha256'),
  createdAt: createdAt(),
});

export const auditLog = pgTable('audit_log', {
  id: id(),
  userId: uuid('user_id'),
  deviceId: text('device_id'),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: uuid('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
});

export const appNotifications = pgTable('app_notifications', {
  id: id(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  type: text('type').notNull(), // transfer_in|nudge|system
  payload: jsonb('payload'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: createdAt(),
});
