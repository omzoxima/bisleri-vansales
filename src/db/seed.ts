/**
 * Seed realistic Bisleri demo data: branches, routes, vans, reps, SKUs,
 * pricing, discounts, a scheme, customers across all payment branches,
 * today's gate pass and a visit plan.
 *
 * Run: npm run db:seed -w @bisleri/api   (after db:migrate)
 * Idempotent: safe to re-run — it wipes and re-inserts demo rows.
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { getDb, getPool } from './client';
import * as s from './schema';

/**
 * STABLE deterministic UUIDs for master data. Re-running the seed keeps the
 * same ids, so devices that already synced masters stay consistent — no more
 * foreign-key rejections after a demo re-seed.
 */
function sid(key: string): string {
  const h = createHash('md5').update(`bisleri:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const db = getDb();

  console.log('Clearing existing data…');
  // Order matters (FK constraints).
  const tables = [
    s.settlementVariances, s.settlements, s.checkInDemandLines, s.checkInDemands,
    s.vanTransferLines, s.vanTransfers, s.emptyJarLines, s.emptyJarCollections,
    s.payments, s.invoices, s.orderLines, s.orders, s.visits, s.visitPlans, s.beatPlans,
    s.stockLedger, s.vanStock, s.gatePassLines, s.gatePasses, s.invoiceSeriesBlocks,
    s.dayTrips, s.customerOnboarding, s.customerBankDetails,
    s.discountLines, s.discountHeaders,
    s.schemeOfferItems, s.schemeOrderItems, s.schemeApplicability, s.schemeHeaders,
    s.priceListLines, s.priceLists, s.itemBatches, s.items, s.hsnMasters,
    s.customers, s.customerGroups,
    s.userVanMap, s.userRouteMap, s.vans, s.warehouses, s.syncEvents, s.erpJobs,
    s.files, s.auditLog, s.appNotifications, s.users, s.routes, s.branches,
  ];
  for (const t of tables) await db.delete(t);

  console.log('Seeding branches / routes / warehouses / vans…');
  const [mumbai, pune] = await db
    .insert(s.branches)
    .values([
      { id: sid('branch-MUM'), code: 'MUM', name: 'Mumbai', invoicePrefix: 'MI' },
      { id: sid('branch-PUN'), code: 'PUN', name: 'Pune', invoicePrefix: 'RI' },
    ])
    .returning();

  const [r101, r102, r201] = await db
    .insert(s.routes)
    .values([
      { id: sid('route-R101'), code: 'R101', name: 'Andheri East', branchId: mumbai.id },
      { id: sid('route-R102'), code: 'R102', name: 'Powai', branchId: mumbai.id },
      { id: sid('route-R201'), code: 'R201', name: 'Shivajinagar', branchId: pune.id },
    ])
    .returning();

  const [whMum, whPun] = await db
    .insert(s.warehouses)
    .values([
      { id: sid('wh-MUM-01'), code: 'WH-MUM-01', name: 'Mumbai Depot', branchId: mumbai.id },
      { id: sid('wh-PUN-01'), code: 'WH-PUN-01', name: 'Pune Depot', branchId: pune.id },
    ])
    .returning();

  const [van529, van584, vanPune1] = await db
    .insert(s.vans)
    .values([
      { id: sid('van-V529'), code: 'V529', registrationNo: 'MH02AB1234', warehouseId: whMum.id, branchId: mumbai.id },
      { id: sid('van-V584'), code: 'V584', registrationNo: 'MH02CD5678', warehouseId: whMum.id, branchId: mumbai.id },
      { id: sid('van-PUNE1'), code: 'PUNE1', registrationNo: 'MH12EF9012', warehouseId: whPun.id, branchId: pune.id },
    ])
    .returning();

  console.log('Seeding users…');
  const hash = await bcrypt.hash('bisleri@123', 10);
  const [kamlesh, roshni, mukesh, supervisor] = await db
    .insert(s.users)
    .values([
      { id: sid('user-U529'), erpUserCode: 'U529', name: 'Kamlesh Yadav', email: 'kamlesh@bisleri.demo', passwordHash: hash, role: 'rep', branchId: mumbai.id, phone: '9820000001' },
      { id: sid('user-U584'), erpUserCode: 'U584', name: 'Roshni Yadav', email: 'roshni@bisleri.demo', passwordHash: hash, role: 'rep', branchId: mumbai.id, phone: '9820000002' },
      { id: sid('user-U101'), erpUserCode: 'U101', name: 'Mukesh Choudhary', email: 'mukesh@bisleri.demo', passwordHash: hash, role: 'rep', branchId: pune.id, phone: '9820000003' },
      { id: sid('user-SUP1'), erpUserCode: 'SUP1', name: 'Amar Desai', email: 'amar@bisleri.demo', passwordHash: hash, role: 'supervisor', branchId: mumbai.id, phone: '9820000004' },
    ])
    .returning();

  await db.insert(s.userRouteMap).values([
    { userId: kamlesh.id, routeId: r101.id },
    { userId: kamlesh.id, routeId: r102.id },
    { userId: roshni.id, routeId: r102.id },
    { userId: mukesh.id, routeId: r201.id },
  ]);
  await db.insert(s.userVanMap).values([
    { userId: kamlesh.id, vanId: van529.id },
    { userId: roshni.id, vanId: van584.id },
    { userId: mukesh.id, vanId: vanPune1.id },
  ]);

  console.log('Seeding HSN / items / batches…');
  const [hsn18, hsn12] = await db
    .insert(s.hsnMasters)
    .values([
      { id: sid('hsn-18'), hsnCode: '22011010', gstRate: 18, cgstRate: 9, sgstRate: 9 },
      { id: sid('hsn-12'), hsnCode: '22011020', gstRate: 12, cgstRate: 6, sgstRate: 6 }, // 20 L jar @ 12% (6+6)
    ])
    .returning();

  const ITEM_DEFS = [
    { erpItemCode: 'BIS-250', description: 'Bisleri 250 ml (Bottle)', hsnId: hsn18.id, pcsPerCase: 24, mrp: 10 },
    { erpItemCode: 'BIS-500', description: 'Bisleri 500 ml (Bottle)', hsnId: hsn18.id, pcsPerCase: 24, mrp: 12 },
    { erpItemCode: 'BIS-1000', description: 'Bisleri 1 L (Bottle)', hsnId: hsn18.id, pcsPerCase: 12, mrp: 22 },
    { erpItemCode: 'BIS-2000', description: 'Bisleri 2 L (Bottle)', hsnId: hsn18.id, pcsPerCase: 9, mrp: 32 },
    { erpItemCode: 'BIS-5000', description: 'Bisleri 5 L (Can)', hsnId: hsn18.id, pcsPerCase: 4, mrp: 75 },
    { erpItemCode: 'BIS-20L', description: 'Bisleri 20 L Jar (Two-way)', hsnId: hsn12.id, pcsPerCase: 1, mrp: 90, isTwoWay: true },
    { erpItemCode: 'VED-500', description: 'Vedica 500 ml (Himalayan)', hsnId: hsn18.id, pcsPerCase: 24, mrp: 30 },
    { erpItemCode: 'BIS-SODA', description: 'Bisleri Soda 750 ml', hsnId: hsn18.id, pcsPerCase: 12, mrp: 20 },
    { erpItemCode: 'BIS-160', description: 'Bisleri 160 ml Cup', hsnId: hsn18.id, pcsPerCase: 48, mrp: 5 },
    { erpItemCode: 'BIS-10L', description: 'Bisleri 10 L (Can)', hsnId: hsn18.id, pcsPerCase: 2, mrp: 120 },
  ];
  const itemRows = await db
    .insert(s.items)
    .values(ITEM_DEFS.map((d) => ({ ...d, id: sid(`item-${d.erpItemCode}`) })))
    .returning();
  const item = (code: string) => {
    const found = itemRows.find((i) => i.erpItemCode === code);
    if (!found) throw new Error(`Missing seed item ${code}`);
    return found;
  };

  const batchRows = await db
    .insert(s.itemBatches)
    .values(
      itemRows.flatMap((it) => [
        { id: sid(`batch-${it.erpItemCode}-B240601`), itemId: it.id, batchNo: 'B240601', lotNo: 'L01', mfgDate: daysAgo(45) },
        { id: sid(`batch-${it.erpItemCode}-B240715`), itemId: it.id, batchNo: 'B240715', lotNo: 'L02', mfgDate: daysAgo(10) },
      ]),
    )
    .returning();
  const oldBatch = (itemId: string) => {
    const found = batchRows.find((b) => b.itemId === itemId && b.batchNo === 'B240601');
    if (!found) throw new Error('Missing batch');
    return found;
  };

  console.log('Seeding price lists…');
  const [plMum] = await db
    .insert(s.priceLists)
    .values([
      { id: sid('pl-MUM'), branchId: mumbai.id, name: 'Mumbai GT 2026', validFrom: daysAgo(180) },
      { id: sid('pl-PUN'), branchId: pune.id, name: 'Pune GT 2026', validFrom: daysAgo(180) },
    ])
    .returning();
  // Trade price ≈ 80% of MRP, tax-inclusive.
  await db.insert(s.priceListLines).values(
    itemRows.map((it) => ({
      id: sid(`pll-${it.erpItemCode}`),
      priceListId: plMum.id,
      itemId: it.id,
      unitPrice: Math.round(it.mrp * 0.8 * 100) / 100,
    })),
  );

  console.log('Seeding customer groups / customers…');
  const [gtGroup, horecaGroup] = await db
    .insert(s.customerGroups)
    .values([
      { id: sid('cg-GT'), code: 'GT', name: 'General Trade' },
      { id: sid('cg-HORECA'), code: 'HORECA', name: 'Hotels/Restaurants/Cafes' },
    ])
    .returning();

  const baseLat = 19.1197; // Andheri East
  const baseLng = 72.8697;
  const customerRows = await db
    .insert(s.customers)
    .values([
      {
        id: sid('cust-CID-001'),
        erpCustomerCode: 'CID-001', name: 'Sharma General Store', contactPerson: 'Ramesh Sharma',
        phone: '9821000001', address1: 'Shop 4, MV Road', city: 'Mumbai', pincode: '400069',
        lat: baseLat + 0.0005, lng: baseLng + 0.0005, routeId: r101.id, branchId: mumbai.id,
        customerGroupId: gtGroup.id, subCategory: 'GROCERY / GEN STORES',
        paymentMethod: 'cash', isGstRegistered: true, gstin: '27AAACB1234F1Z5',
        lastOrderDate: daysAgo(3), lastOrderValue: 2350,
      },
      {
        id: sid('cust-CID-002'),
        erpCustomerCode: 'CID-002', name: 'Hotel Sea View', contactPerson: 'Priya Nair',
        phone: '9821000002', address1: 'JB Nagar, Andheri E', city: 'Mumbai', pincode: '400059',
        lat: baseLat + 0.001, lng: baseLng - 0.0008, routeId: r101.id, branchId: mumbai.id,
        customerGroupId: horecaGroup.id, subCategory: 'HOTELS / RESTAURANT',
        paymentMethod: 'credit', isGstRegistered: true, gstin: '27AABCH5678K1Z2',
        creditLimit: 50000, creditUsed: 12000, lastOrderDate: daysAgo(2), lastOrderValue: 8400,
      },
      {
        id: sid('cust-CID-003'),
        erpCustomerCode: 'CID-003', name: 'Om Pan Shop', contactPerson: 'Sunil Gupta',
        phone: '9821000003', address1: 'Marol Naka', city: 'Mumbai', pincode: '400059',
        lat: baseLat - 0.0006, lng: baseLng + 0.001, routeId: r101.id, branchId: mumbai.id,
        customerGroupId: gtGroup.id, subCategory: 'PAN SHOP',
        paymentMethod: 'cash', isGstRegistered: false,
        lastOrderDate: daysAgo(1), lastOrderValue: 640,
      },
      {
        id: sid('cust-CID-004'),
        erpCustomerCode: 'CID-004', name: 'TechPark Cafeteria (COR)', contactPerson: 'Anita Joshi',
        phone: '9821000004', address1: 'Tower B, MIDC', city: 'Mumbai', pincode: '400093',
        lat: baseLat + 0.0015, lng: baseLng + 0.0012, routeId: r101.id, branchId: mumbai.id,
        customerGroupId: horecaGroup.id, subCategory: 'CORPORATE OFFICES',
        customerType: 'COR-ROT', paymentMethod: 'credit', isGstRegistered: true,
        gstin: '27AADCT9012L1Z8', creditLimit: 200000, creditUsed: 45000,
        lastOrderDate: daysAgo(1), lastOrderValue: 15600,
      },
      {
        id: sid('cust-CID-005'),
        erpCustomerCode: 'CID-005', name: 'Krishna Medical & General', contactPerson: 'Vijay Patil',
        phone: '9821000005', address1: 'Sakinaka Junction', city: 'Mumbai', pincode: '400072',
        lat: baseLat - 0.001, lng: baseLng - 0.0011, routeId: r101.id, branchId: mumbai.id,
        customerGroupId: gtGroup.id, subCategory: 'MEDICAL STORES',
        paymentMethod: 'paytm', isGstRegistered: false,
        lastOrderDate: daysAgo(5), lastOrderValue: 980,
      },
      {
        id: sid('cust-CID-006'),
        erpCustomerCode: 'CID-006', name: 'Blue Water Distributor', contactPerson: 'Farhan Shaikh',
        phone: '9821000006', address1: 'Chakala, Andheri E', city: 'Mumbai', pincode: '400099',
        lat: baseLat + 0.0008, lng: baseLng + 0.0018, routeId: r102.id, branchId: mumbai.id,
        customerGroupId: gtGroup.id, subCategory: 'DISTRIBUTOR',
        paymentMethod: 'cheque', isGstRegistered: true, gstin: '27AAFCB3456M1Z9',
        creditLimit: 100000, lastOrderDate: daysAgo(4), lastOrderValue: 22400,
      },
      {
        id: sid('cust-CID-007'),
        erpCustomerCode: 'CID-007', name: 'Cafe Aroma', contactPerson: 'Neha Kulkarni',
        phone: '9821000007', address1: 'FC Road', city: 'Pune', pincode: '411004',
        lat: 18.5236, lng: 73.8478, routeId: r201.id, branchId: pune.id,
        customerGroupId: horecaGroup.id, subCategory: 'COFFEE SHOP',
        paymentMethod: 'cash', isGstRegistered: true, gstin: '27AAGCC7890N1Z4',
        lastOrderDate: daysAgo(2), lastOrderValue: 1750,
      },
    ])
    .returning();
  const customer = (code: string) => {
    const found = customerRows.find((c) => c.erpCustomerCode === code);
    if (!found) throw new Error(`Missing customer ${code}`);
    return found;
  };

  await db.insert(s.customerBankDetails).values({
    customerId: customer('CID-002').id,
    bankName: 'Kotak Mahindra Bank', accountNo: '1234567890', ifsc: 'KKBK0000123', branchName: 'Andheri East',
  });

  console.log('Seeding discount + scheme…');
  const [dh] = await db
    .insert(s.discountHeaders)
    .values({ id: sid('dh-CID-002'), customerId: customer('CID-002').id, validFrom: daysAgo(30) })
    .returning();
  await db.insert(s.discountLines).values([
    { id: sid('dl-BIS-1000'), discountHeaderId: dh.id, itemId: item('BIS-1000').id, discountPerPc: 1 },
    { id: sid('dl-BIS-500'), discountHeaderId: dh.id, itemId: item('BIS-500').id, discountPerPc: 0.5 },
  ]);

  const [scheme] = await db
    .insert(s.schemeHeaders)
    .values({
      id: sid('scheme-1L-1012'),
      code: 'SCH-1L-1012', name: 'Buy 10 case 1 L, get 12 pcs free',
      branchId: mumbai.id, validFrom: daysAgo(15), validTo: daysAgo(-30),
    })
    .returning();
  await db.insert(s.schemeApplicability).values({ id: sid('schapp-1L'), schemeHeaderId: scheme.id, routeId: r101.id });
  await db.insert(s.schemeOrderItems).values({
    id: sid('schord-1L'),
    schemeHeaderId: scheme.id, itemId: item('BIS-1000').id, minQtyPcs: 120, // 10 cases × 12
  });
  await db.insert(s.schemeOfferItems).values({
    id: sid('schoff-1L'),
    schemeHeaderId: scheme.id, itemId: item('BIS-1000').id, freeQtyPcs: 12,
  });

  console.log("Seeding today's gate passes + visit plan…");
  const gpLoad: Array<{ code: string; cases: number; pcs: number }> = [
    { code: 'BIS-250', cases: 10, pcs: 0 },
    { code: 'BIS-500', cases: 20, pcs: 0 },
    { code: 'BIS-1000', cases: 15, pcs: 0 },
    { code: 'BIS-2000', cases: 8, pcs: 0 },
    { code: 'BIS-20L', cases: 0, pcs: 30 },
    { code: 'VED-500', cases: 2, pcs: 0 },
    { code: 'BIS-SODA', cases: 4, pcs: 0 },
  ];
  for (const rep of [kamlesh, roshni]) {
    const [gp] = await db
      .insert(s.gatePasses)
      .values({
        userId: rep.id, tripDate: today(),
        erpGatepassNo: `GP-${rep.erpUserCode}-${today().replace(/-/g, '')}`,
      })
      .returning();
    await db.insert(s.gatePassLines).values(
      gpLoad.map((l) => {
        const it = item(l.code);
        return {
          gatePassId: gp.id,
          itemId: it.id,
          batchId: oldBatch(it.id).id,
          qtyCases: l.cases,
          qtyPcs: l.pcs,
          qtyTotalPcs: l.cases * it.pcsPerCase + l.pcs,
        };
      }),
    );
  }

  await db.insert(s.visitPlans).values(
    ['CID-001', 'CID-002', 'CID-003', 'CID-004', 'CID-005'].map((code, i) => ({
      routeId: r101.id, userId: kamlesh.id, planDate: today(),
      customerId: customer(code).id, sequence: i + 1,
    })),
  );

  console.log('\nSeed complete ✅');
  console.log('Demo logins (password: bisleri@123):');
  console.log('  kamlesh@bisleri.demo  (rep, Mumbai R101+R102, van V529 — has gate pass + visit plan today)');
  console.log('  roshni@bisleri.demo   (rep, Mumbai R102, van V584)');
  console.log('  mukesh@bisleri.demo   (rep, Pune R201)');
  console.log('  amar@bisleri.demo     (supervisor)');
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
