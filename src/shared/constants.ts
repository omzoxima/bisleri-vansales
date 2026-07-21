/** Value charged per empty jar not returned (INR). */
export const JAR_VALUE_INR = 150;

/** Geo-fence radius for visit check-in (metres). */
export const VISIT_GEOFENCE_METRES = 200;

export const DAY_STATES = [
  'logged_in',
  'gate_pass_verified',
  'day_started',
  'demand_created',
  'settled',
  'day_ended',
] as const;
export type DayState = (typeof DAY_STATES)[number];

export const ORDER_TYPES = ['sale', 'foc', 'replacement', 'empty_jar'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_STATUSES = [
  'draft',
  'confirmed',
  'invoiced',
  'paid',
  'completed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_MODES = ['cash', 'cheque', 'paytm', 'coupon', 'credit'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const CHEQUE_BANKS = ['KOTAK', 'IDBI'] as const;

export const VISIT_TYPES = ['planned', 'unplanned'] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

export const VISIT_OUTCOMES = ['order', 'no_order', 'jar_only', 'payment_only'] as const;

/** Customer settled monthly — no in-app payment step. */
export const CUSTOMER_TYPE_COR_ROT = 'COR-ROT';

export const FOC_REASONS = [
  'Breakage',
  'Complaint',
  'Complimentary',
  'Self-Consumption',
  'Deposit',
  'Display',
  'Display Incentive',
  'DTH Scheme',
  'Expired Goods/Pet',
  'IDC Transfer',
  'Job Work',
  'POP Scheme',
  'Replacement',
  'Returnable',
  'Route Replacement',
  'RTO',
  'Sample',
  'Scheme',
  'Secondary Scheme',
  'Staff Sale',
] as const;
export type FocReason = (typeof FOC_REASONS)[number];

export const RETURN_REASONS = [
  'Damaged packaging',
  'Leakage',
  'Expired',
  'Quality complaint',
  'Wrong product delivered',
] as const;

export const CUSTOMER_SUB_CATEGORIES = [
  'BANK / FINANCE. INST',
  'BANQUETS',
  'BAR / RESTAURANT',
  'CASH DIST',
  'CATERERS',
  'CINEMA',
  'CLUB',
  'COFFEE SHOP',
  'COLD DRINKS',
  'CORPORATE OFFICES',
  'DAIRY',
  'DISTRIBUTOR',
  'ECOMMERCE',
  'FINE DINE',
  'FIVE STAR',
  'GROCERY / GEN STORES',
  'HOSPITALS',
  'HOTELS / RESTAURANT',
  'JUICE CENTER',
  'MALLS / SUPER MKT',
  'MEDICAL STORES',
  'MODERN TRADE',
  'MULTI PLEX',
  'PAN SHOP',
  'RAILWAY',
  'SCHOOL / COLLEGE',
  'SPA / SALOON',
  'STAR HOTEL',
  'STATIONERY',
  'TRAVELS',
  'WINE SHOP',
  'OTHERS',
] as const;

export const USER_ROLES = ['rep', 'supervisor', 'settlement', 'depot', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TRANSFER_STATUSES = ['pending', 'accepted', 'rejected', 'expired'] as const;

export const SETTLEMENT_LEDGERS = ['cash', 'stock', 'jars', 'foc'] as const;
export type SettlementLedger = (typeof SETTLEMENT_LEDGERS)[number];

export const STOCK_TXN_TYPES = [
  'load',
  'sale',
  'foc',
  'replacement_out',
  'replacement_in',
  'jar_in',
  'transfer_in',
  'transfer_out',
  'adjustment',
] as const;
export type StockTxnType = (typeof STOCK_TXN_TYPES)[number];

/** Tables the mobile app pulls as scoped masters, in pull order. */
export const MASTER_TABLES = [
  'branches',
  'routes',
  'warehouses',
  'vans',
  'hsn_masters',
  'items',
  'item_batches',
  'price_lists',
  'price_list_lines',
  'discount_headers',
  'discount_lines',
  'scheme_headers',
  'scheme_applicability',
  'scheme_order_items',
  'scheme_offer_items',
  'customer_groups',
  'customers',
  'visit_plans',
] as const;
export type MasterTable = (typeof MASTER_TABLES)[number];
