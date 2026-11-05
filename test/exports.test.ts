// Isolated tests: in-memory PGlite database, mocked storage, no network. The environment is
// forced to harmless values BEFORE any app module is imported so a real .env can never be used.
process.env.JWT_SECRET = "test-secret";
process.env.DATABASE_URL = "postgres://invalid.invalid:1/none";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_KEY = "test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
process.env.SUPABASE_STORAGE_BUCKET = "test-bucket";
process.env.VERCEL = "1";

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { patients } from "../src/schema/patients";
import { patientPendingAmount } from "../src/services/patientBalance";

const CLINIC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLINIC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLINIC_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = { rahul: uid(1), amit: uid(2), inactive: uid(3), noCghs: uid(4), tampered: uid(5), gone: uid(6), echs: uid(7), broken: uid(8), other: uid(9), echsOk: uid(10) };
const T = { t1: uid(101), t2: uid(102), t3del: uid(103), t4: uid(104), tB: uid(105) };

const pg = new PGlite();
const db = drizzle(pg);
const downloads: string[] = [];
const storage = new Map<string, Buffer>();

const base = "http://localhost:54321/storage/v1/object/public/test-bucket";
const cghsUrl = (clinic: string, patient: string, file: string) =>
  `${base}/clinic-${clinic}/patients/${patient}/cghs/${file}`;

const echsUrl = (clinic: string, patient: string, file: string) =>
  `${base}/clinic-${clinic}/patients/${patient}/echs/${file}`;

let server: Server;
let baseUrl: string;

const token = (claims: Record<string, unknown>) => jwt.sign(claims, "test-secret");
const adminA = token({ sub: uid(900), clinicId: CLINIC_A, role: "admin" });
const receptionistA = token({ sub: uid(901), clinicId: CLINIC_A, role: "receptionist" });
const adminB = token({ sub: uid(902), clinicId: CLINIC_B, role: "admin" });
const adminC = token({ sub: uid(903), clinicId: CLINIC_C, role: "admin" });
const noClinic = token({ sub: uid(904), role: "admin" });

const get = (path: string, jwtToken?: string) =>
  fetch(`${baseUrl}${path}`, { headers: jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {} });

before(async () => {
  await pg.exec(`
    CREATE TABLE patients (id text PRIMARY KEY, clinic_id text, patient_number integer, name text, phone text,
      email text, age integer, gender text, height_cm numeric, weight_kg numeric, blood_group text,
      has_id_proof boolean DEFAULT false, id_proof_file_url text, has_cghs boolean DEFAULT false, cghs_file_url text,
      has_echs boolean DEFAULT false, echs_file_url text, is_active boolean DEFAULT true,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE treatments (id text PRIMARY KEY, clinic_id text, patient_id text, title text, status text,
      start_date date, estimated_end_date date, actual_end_date date, total_fee numeric(12,2), discount_type text,
      discount_value numeric(12,2), final_fee numeric(12,2), paid_amount numeric(12,2) DEFAULT 0, notes text,
      is_deleted boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE transactions (id text PRIMARY KEY, clinic_id text, treatment_id text, patient_id text, visit_id text,
      type text, amount numeric(12,2), payment_mode text, reference_id text, notes text,
      is_deleted boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
  `);

  const patient = (id: string, clinic: string, num: number, name: string, extra: string, hasCghs: boolean, url: string | null, active = true) =>
    pg.query(
      `INSERT INTO patients (id, clinic_id, patient_number, name, phone, email, gender, has_cghs, cghs_file_url, is_active, ${extra.split("|")[0]})
       VALUES ($1,$2,$3,$4,'9000000000','p@example.com','male',$5,$6,$7, ${extra.split("|")[1]})`,
      [id, clinic, num, name, hasCghs, url, active]
    );
  await patient(P.rahul, CLINIC_A, 1, "Rahul Sharma", "has_echs|false", true, cghsUrl(CLINIC_A, P.rahul, "1730000000-card%20front.PDF"));
  await patient(P.amit, CLINIC_A, 2, "Amit/Kumar ../x", "has_echs|false", true, null);
  await patient(P.inactive, CLINIC_A, 3, "Inactive Person", "has_echs|false", true, cghsUrl(CLINIC_A, P.inactive, "1-a.pdf"), false);
  await patient(P.noCghs, CLINIC_A, 4, "No Cghs", "has_echs|false", false, null);
  await patient(P.tampered, CLINIC_A, 5, "Tampered Url", "has_echs|false", true, cghsUrl(CLINIC_B, P.other, "1-evil.pdf"));
  await patient(P.gone, CLINIC_A, 6, "Gone File", "has_echs|false", true, cghsUrl(CLINIC_A, P.gone, "1-missing.jpg"));
  await patient(P.echs, CLINIC_A, 7, "Echs Only", "has_echs, echs_file_url|true, 'http://localhost:54321/storage/v1/object/public/test-bucket/clinic-x/echs/1-e.pdf'", false, null);
  await patient(P.broken, CLINIC_A, 8, "Broken Storage", "has_echs|false", true, cghsUrl(CLINIC_A, P.broken, "1-fail.png"));
  await patient(P.echsOk, CLINIC_A, 10, "Echs Ok", "has_echs, echs_file_url|true, '" + echsUrl(CLINIC_A, P.echsOk, "1700-echs%20card.JPG") + "'", false, null);
  await patient(P.other, CLINIC_B, 9, "Other Clinic", "has_echs|false", true, cghsUrl(CLINIC_B, P.other, "1-b.pdf"));

  storage.set(`clinic-${CLINIC_A}/patients/${P.rahul}/cghs/1730000000-card front.PDF`, Buffer.from("PDF-BYTES"));
  storage.set(`clinic-${CLINIC_A}/patients/${P.echsOk}/echs/1700-echs card.JPG`, Buffer.from("ECHS-BYTES"));

  const treatment = (id: string, clinic: string, pat: string, title: string, total: number, final: number, deleted = false, dtype: string | null = null, dval: number | null = null) =>
    pg.query(
      `INSERT INTO treatments (id, clinic_id, patient_id, title, status, start_date, total_fee, discount_type, discount_value, final_fee, is_deleted)
       VALUES ($1,$2,$3,$4,'ongoing','2026-10-01',$5,$6,$7,$8,$9)`,
      [id, clinic, pat, title, total, dtype, dval, final, deleted]
    );
  await treatment(T.t1, CLINIC_A, P.rahul, "Root Canal", 12000, 10000, false, "fixed_amount", 2000);
  await treatment(T.t2, CLINIC_A, P.rahul, "Cleaning", 4000, 4000);
  await treatment(T.t3del, CLINIC_A, P.rahul, "Deleted Treatment", 90000, 90000, true);
  await treatment(T.t4, CLINIC_A, P.amit, "Braces", 5000, 5000);
  await treatment(T.tB, CLINIC_B, P.other, "Other Clinic Work", 7000, 7000);

  const tx = (id: number, clinic: string, treat: string, pat: string, type: string, amount: number, mode: string | null, at: string, deleted = false) =>
    pg.query(
      `INSERT INTO transactions (id, clinic_id, treatment_id, patient_id, type, amount, payment_mode, reference_id, created_at, is_deleted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [uid(500 + id), clinic, treat, pat, type, amount, mode, `REF${id}`, at, deleted]
    );
  await tx(1, CLINIC_A, T.t1, P.rahul, "payment", 3000, "upi", "2026-10-01T10:00:00Z");
  await tx(2, CLINIC_A, T.t1, P.rahul, "payment", 2000, "cash", "2026-10-15T10:00:00Z");
  await tx(3, CLINIC_A, T.t1, P.rahul, "refund", 1000, "cash", "2026-10-20T10:00:00Z");
  await tx(4, CLINIC_A, T.t2, P.rahul, "adjustment", 500, null, "2026-10-21T10:00:00Z");
  await tx(5, CLINIC_A, T.t1, P.rahul, "payment", 9000, "upi", "2026-10-02T10:00:00Z", true);
  await tx(6, CLINIC_A, T.t4, P.amit, "payment", 700, "cash", "2026-11-02T10:00:00Z");
  await tx(7, CLINIC_B, T.tB, P.other, "payment", 4242, "card", "2026-10-10T10:00:00Z");

  // Imported after env is fixed. Mirrors the real route wiring with the in-memory db and mock storage.
  const { requireAuth, requireClinicScope, requireRole } = await import("../src/middlewares/auth");
  const { validateQuery } = await import("../src/middlewares/validate");
  const { asyncHandler, errorHandler } = await import("../src/middlewares/errorHandler");
  const { makeExportHandlers } = await import("../src/controllers/exports");
  const { transactionExportQuerySchema } = await import("../src/validators/exports");
  const { StorageObjectNotFound } = await import("../src/services/cghsExport");

  const handlers = makeExportHandlers({
    db,
    supabaseUrl: "http://localhost:54321",
    bucket: "test-bucket",
    download: async (objectPath) => {
      downloads.push(objectPath);
      if (objectPath.includes("fail")) throw new Error("socket hang up");
      const data = storage.get(objectPath);
      if (!data) throw new StorageObjectNotFound("Object not found");
      return data;
    },
  });

  const app = express();
  app.use(requireAuth, requireClinicScope);
  app.get("/transactions/export/pdf", validateQuery(transactionExportQuerySchema), asyncHandler(handlers.exportTransactionsPdf));
  app.get("/transactions/export/excel", validateQuery(transactionExportQuerySchema), asyncHandler(handlers.exportTransactionsExcel));
  app.get("/patients/export/cghs", requireRole("admin"), asyncHandler(handlers.exportCghsZip));
  app.get("/patients/export/echs", requireRole("admin"), asyncHandler(handlers.exportEchsZip));
  app.get("/patients/:id/export/pdf", asyncHandler(handlers.exportPatientPdf));
  app.get("/patients/:id/export/excel", asyncHandler(handlers.exportPatientExcel));
  app.use(errorHandler);

  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  await pg.close();
});

const loadXlsx = async (res: Response) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()) as any);
  return workbook;
};

const sheetRows = (sheet: ExcelJS.Worksheet) => {
  const rows: ExcelJS.CellValue[][] = [];
  sheet.eachRow((row, i) => {
    if (i > 1) rows.push((row.values as ExcelJS.CellValue[]).slice(1));
  });
  return rows;
};
const plain = (v: ExcelJS.CellValue) => (v && typeof v === "object" && "result" in v ? (v as any).result : v);

// ---------------------------------------------------------------------------
// Payment exports
// ---------------------------------------------------------------------------

test("clinic PDF export: content type, filename, valid PDF, no JSON envelope", async () => {
  const res = await get("/transactions/export/pdf", adminA);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.match(res.headers.get("content-disposition")!, /^attachment; filename="Royal_Dental_Clinic_Payment_Report_\d{4}-\d{2}-\d{2}\.pdf"$/);
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(body.subarray(0, 5).toString(), "%PDF-");
  assert.ok(body.length > 2000);
});

test("clinic Excel export: content type and a real xlsx (zip) container", async () => {
  const res = await get("/transactions/export/excel", adminA);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.match(res.headers.get("content-disposition")!, /Royal_Dental_Clinic_Payment_Report_\d{4}-\d{2}-\d{2}\.xlsx/);
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(body.subarray(0, 2).toString(), "PK");
});

test("export endpoints reject missing/invalid tokens and tokens without clinic scope", async () => {
  for (const path of ["/transactions/export/pdf", "/transactions/export/excel", "/patients/export/cghs", "/patients/export/echs", `/patients/${P.rahul}/export/pdf`]) {
    assert.equal((await get(path)).status, 401, path);
    assert.equal((await get(path, "garbage")).status, 401, path);
    assert.equal((await get(path, noClinic)).status, 421, path);
  }
});

test("clinic workbook contains only this clinic's non-deleted transactions with correct types and totals", async () => {
  const workbook = await loadXlsx(await get("/transactions/export/excel", adminA));
  assert.deepEqual(workbook.worksheets.map((s) => s.name), ["Payment Transactions", "Summary"]);

  const sheet = workbook.getWorksheet("Payment Transactions")!;
  const rows = sheetRows(sheet);
  assert.equal(rows.length, 5); // 7 seeded - 1 deleted - 1 other clinic
  const types = rows.map((r) => r[7]);
  assert.deepEqual(types, ["Payment", "Payment", "Refund", "Adjustment", "Payment"]);
  assert.ok(!rows.some((r) => r[5] === uid(507)), "other clinic's transaction leaked");
  assert.ok(!rows.some((r) => r[5] === uid(505)), "soft-deleted transaction exported");
  assert.deepEqual(rows.map((r) => r[9]), [3000, 2000, 1000, 500, 700]); // refund stays a refund amount, not negated
  assert.equal(sheet.views[0].state, "frozen");
  assert.ok(sheet.autoFilter);

  const summary = Object.fromEntries(
    sheetRows(workbook.getWorksheet("Summary")!)
      .filter((r) => r[0])
      .map((r) => [String(r[0]), plain(r[1])])
  );
  assert.equal(summary["Total transactions"], 5);
  assert.equal(summary["Total payments"], 5700);
  assert.equal(summary["Total refunds"], 1000);
  assert.equal(summary["Total adjustments"], 500);
  assert.equal(summary["Net collections (payments - refunds)"], 4700);
  assert.equal(summary["Unique patients"], 2);
});

test("filters: date range (IST days), patient, type and mode", async () => {
  const count = async (query: string) => {
    const wb = await loadXlsx(await get(`/transactions/export/excel?${query}`, adminA));
    return sheetRows(wb.getWorksheet("Payment Transactions")!);
  };
  const inRange = await count("dateFrom=2026-10-16&dateTo=2026-10-20");
  assert.equal(inRange.length, 1);
  assert.equal(inRange[0][7], "Refund");

  assert.equal((await count(`patientId=${P.amit}`)).length, 1);
  assert.equal((await count("transactionType=payment")).length, 3);
  assert.equal((await count("paymentMode=cash")).length, 3);
  assert.equal((await count("dateFrom=2030-01-01")).length, 0);
});

test("invalid filters return 400; empty results still produce valid files", async () => {
  assert.equal((await get("/transactions/export/pdf?paymentMode=bitcoin", adminA)).status, 400);
  assert.equal((await get("/transactions/export/excel?patientId=not-a-uuid", adminA)).status, 400);
  const emptyPdf = await get("/transactions/export/pdf?dateFrom=2030-01-01", adminA);
  assert.equal(emptyPdf.status, 200);
  assert.equal(Buffer.from(await emptyPdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  const emptyXlsx = await loadXlsx(await get("/transactions/export/excel?dateFrom=2030-01-01", adminC));
  assert.equal(sheetRows(emptyXlsx.getWorksheet("Payment Transactions")!).length, 0);
});

test("another clinic only ever sees its own transactions", async () => {
  const wb = await loadXlsx(await get("/transactions/export/excel", adminB));
  const rows = sheetRows(wb.getWorksheet("Payment Transactions")!);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][5], uid(507));
});

test("large clinic report spans multiple PDF pages without failing", async () => {
  const { buildClinicReportPdf } = await import("../src/services/exportPdf");
  const { summarizeTransactions } = await import("../src/services/exportData");
  const many = Array.from({ length: 300 }, (_, i) => ({
    id: `id-${i}`,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    type: (["payment", "refund", "adjustment"] as const)[i % 3],
    amount: 1234.5 + i,
    paymentMode: "upi",
    referenceId: "X".repeat(30),
    notes: null,
    patientId: `p-${i % 7}`,
    patientNumber: i % 7,
    patientDisplayId: `NIR-${String(i % 7).padStart(4, "0")}`,
    patientName: "A Very Long Patient Name That Must Wrap",
    patientPhone: "9000000000",
    treatmentId: "t",
    treatmentTitle: "Long treatment name that has to wrap across several lines in the cell",
  }));
  const pdf = await buildClinicReportPdf({ transactions: many, summary: summarizeTransactions(many), filters: {} });
  const pages = (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
  assert.ok(pages >= 5, `expected several pages, got ${pages}`);
});

// ---------------------------------------------------------------------------
// Patient statement
// ---------------------------------------------------------------------------

test("patient statement PDF/Excel: headers, filename and sanitized name", async () => {
  const pdf = await get(`/patients/${P.rahul}/export/pdf`, adminA);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(pdf.headers.get("content-disposition"), 'attachment; filename="NIR-0001_Rahul_Sharma_Payment_Statement.pdf"');
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");

  const xlsx = await get(`/patients/${P.amit}/export/excel`, adminA);
  assert.equal(xlsx.headers.get("content-disposition"), 'attachment; filename="NIR-0002_Amit_Kumar_._x_Payment_Statement.xlsx"');
});

test("patient statement only includes the requested patient's data and matches the patients-list pending amount", async () => {
  const wb = await loadXlsx(await get(`/patients/${P.rahul}/export/excel`, adminA));
  assert.deepEqual(wb.worksheets.map((s) => s.name), ["Patient Details", "Treatment Summary", "Transaction History", "Financial Summary"]);

  const treatments = sheetRows(wb.getWorksheet("Treatment Summary")!);
  assert.deepEqual(treatments.map((r) => r[0]), ["Root Canal", "Cleaning"]); // deleted treatment excluded
  const [rootCanal, cleaning] = treatments;
  assert.equal(rootCanal[3], 12000);
  assert.equal(rootCanal[6], 10000);
  assert.equal(plain(rootCanal[10]), 4000); // net paid = 5000 - 1000
  assert.equal(plain(rootCanal[11]), 6000);
  assert.equal(plain(cleaning[11]), 3500); // 4000 - 500 adjustment

  const history = sheetRows(wb.getWorksheet("Transaction History")!);
  assert.equal(history.length, 4);
  assert.ok(history.every((r) => String(r[0]).startsWith("00000000-0000-4000-8000-0000000005")));
  assert.ok(!history.some((r) => r[0] === uid(506)), "another patient's transaction leaked");

  const fin = Object.fromEntries(
    sheetRows(wb.getWorksheet("Financial Summary")!).filter((r) => r[0] && r[1] !== undefined).map((r) => [String(r[0]), plain(r[1])])
  );
  assert.equal(fin["Total treatment fees"], 16000);
  assert.equal(fin["Discounts"], 2000);
  assert.equal(fin["Final fees"], 14000);
  assert.equal(fin["Payments"], 5000);
  assert.equal(fin["Refunds"], 1000);
  assert.equal(fin["Adjustments"], 500);
  assert.equal(fin["Outstanding balance"], 9500);

  const [{ pending }] = await db
    .select({ pending: patientPendingAmount(CLINIC_A) })
    .from(patients)
    .where(eq(patients.id, P.rahul));
  assert.equal(Number(pending), fin["Outstanding balance"]);
});

test("patient statement rejects other-clinic, unknown and malformed ids with 404", async () => {
  assert.equal((await get(`/patients/${P.other}/export/pdf`, adminA)).status, 404);
  assert.equal((await get(`/patients/${P.rahul}/export/excel`, adminB)).status, 404);
  assert.equal((await get(`/patients/${uid(4040)}/export/pdf`, adminA)).status, 404);
  assert.equal((await get(`/patients/not-a-uuid/export/pdf`, adminA)).status, 404);
});

// ---------------------------------------------------------------------------
// CGHS export
// ---------------------------------------------------------------------------

test("CGHS export is admin-only and never touches storage for other roles", async () => {
  downloads.length = 0;
  assert.equal((await get("/patients/export/cghs", receptionistA)).status, 403);
  assert.equal(downloads.length, 0);
});

test("CGHS export with no eligible patients returns 404 JSON, not an empty ZIP", async () => {
  const res = await get("/patients/export/cghs", adminC);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.success, false);
});

test("CGHS ZIP: folder layout, sanitized names, preserved extension, resilient to bad/missing files", async () => {
  downloads.length = 0;
  const res = await get("/patients/export/cghs", adminA);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/zip");
  assert.match(res.headers.get("content-disposition")!, /Nirmaya_CGHS_Records_\d{4}-\d{2}-\d{2}\.zip/);

  const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
  const files = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
  assert.deepEqual(files, ["CGHS/NIR-0001_Rahul_Sharma/CGHS_Card.pdf", "CGHS_Patient_Index.xlsx"]);
  assert.equal(await zip.file("CGHS/NIR-0001_Rahul_Sharma/CGHS_Card.pdf")!.async("string"), "PDF-BYTES");
  for (const name of Object.keys(zip.files)) {
    assert.ok(!name.includes(".."), name);
    assert.ok(!name.startsWith("/"), name);
  }

  // Only valid, in-scope CGHS paths were ever requested (tampered URL, ECHS, inactive, other clinic never fetched).
  assert.deepEqual(downloads.sort(), [
    `clinic-${CLINIC_A}/patients/${P.broken}/cghs/1-fail.png`,
    `clinic-${CLINIC_A}/patients/${P.gone}/cghs/1-missing.jpg`,
    `clinic-${CLINIC_A}/patients/${P.rahul}/cghs/1730000000-card front.PDF`,
  ].sort());

  const index = new ExcelJS.Workbook();
  await index.xlsx.load((await zip.file("CGHS_Patient_Index.xlsx")!.async("nodebuffer")) as any);
  const rows = sheetRows(index.worksheets[0]);
  const byName = Object.fromEntries(rows.map((r) => [String(r[3]), r]));
  assert.deepEqual(Object.keys(byName).sort(), ["Amit/Kumar ../x", "Broken Storage", "Gone File", "Rahul Sharma", "Tampered Url"]);
  assert.equal(byName["Rahul Sharma"][6], "Downloaded");
  assert.equal(byName["Rahul Sharma"][7], "CGHS_Card.pdf");
  assert.equal(byName["Rahul Sharma"][2], "NIR-0001");
  assert.match(String(byName["Amit/Kumar ../x"][6]), /^Missing - no CGHS file/);
  assert.match(String(byName["Gone File"][6]), /^Missing - file not found/);
  assert.match(String(byName["Broken Storage"][6]), /^Failed - could not download/);
  assert.doesNotMatch(String(byName["Broken Storage"][6]), /socket/); // internal error text not leaked
  assert.match(String(byName["Tampered Url"][6]), /^Failed - stored file location/);
  assert.ok(rows.every((r) => r[5] === "Yes"));
});

test("resolveSchemeStoragePath only accepts this clinic/patient's cghs objects in the configured bucket", async () => {
  const { resolveSchemeStoragePath } = await import("../src/services/cghsExport");
  const ok = (url: string) =>
    resolveSchemeStoragePath({ url, supabaseUrl: "http://localhost:54321", bucket: "test-bucket", clinicId: CLINIC_A, patientId: P.rahul });
  const good = cghsUrl(CLINIC_A, P.rahul, "1-card.pdf");
  assert.equal(ok(good), `clinic-${CLINIC_A}/patients/${P.rahul}/cghs/1-card.pdf`);
  assert.equal(ok(good.replace("localhost:54321", "evil.example.com")), null);
  assert.equal(ok(good.replace("test-bucket", "other-bucket")), null);
  assert.equal(ok(cghsUrl(CLINIC_B, P.rahul, "1-card.pdf")), null);
  assert.equal(ok(cghsUrl(CLINIC_A, P.amit, "1-card.pdf")), null);
  assert.equal(ok(good.replace("/cghs/", "/echs/")), null);
  assert.equal(ok(good.replace("/cghs/1-card.pdf", "/cghs/%2e%2e/id-proof/1-x.pdf")), null);
  assert.equal(ok(good.replace("/cghs/1-card.pdf", "/cghs/a%2Fb.pdf")), null);
  assert.equal(ok("file:///etc/passwd"), null);
  assert.equal(ok("not a url"), null);
});

test("duplicate patient names/folders never collide in the ZIP", async () => {
  const { writeSchemeZip } = await import("../src/services/cghsExport");
  const archiver = (await import("archiver")).default;
  const archive = archiver("zip");
  const chunks: Buffer[] = [];
  archive.on("data", (c: Buffer) => chunks.push(c));
  const mk = (n: number) => ({
    id: uid(7000 + n),
    patientNumber: null,
    name: "Same Name",
    phone: "9",
    fileUrl: cghsUrl(CLINIC_A, uid(7000 + n), "1-c.jpg"),
  });
  await writeSchemeZip({
    archive,
    eligible: [mk(1), mk(2)],
    clinicId: CLINIC_A,
    supabaseUrl: "http://localhost:54321",
    bucket: "test-bucket",
    download: async () => Buffer.from("x"),
  });
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  const files = Object.keys(zip.files).filter((n) => n.endsWith(".jpg"));
  assert.equal(files.length, 2);
  assert.equal(new Set(files).size, 2);
});

test("real routers register export routes before '/:id' and with the expected guards", async () => {
  const patientsRouter = (await import("../src/routes/patients")).default as any;
  const transactionsRouter = (await import("../src/routes/transactions")).default as any;
  const paths = (router: any) => router.stack.filter((l: any) => l.route).map((l: any) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
  const p = paths(patientsRouter);
  assert.ok(p.indexOf("get /export/cghs") >= 0 && p.indexOf("get /export/cghs") < p.indexOf("get /:id"));
  assert.ok(p.indexOf("get /export/echs") >= 0 && p.indexOf("get /export/echs") < p.indexOf("get /:id"));
  assert.ok(p.indexOf("get /:id/export/pdf") < p.indexOf("get /:id"));
  assert.ok(p.includes("get /:id/export/excel"));
  const t = paths(transactionsRouter);
  assert.ok(t.includes("get /export/pdf") && t.includes("get /export/excel"));
});

// ---------------------------------------------------------------------------
// ECHS export (same machinery, ECHS fields/folder)
// ---------------------------------------------------------------------------

test("ECHS export is admin-only and 404s with an ECHS-specific message when empty", async () => {
  downloads.length = 0;
  assert.equal((await get("/patients/export/echs", receptionistA)).status, 403);
  assert.equal(downloads.length, 0);
  const res = await get("/patients/export/echs", adminC);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).message, "No ECHS records");
});

test("ECHS ZIP contains only ECHS documents, laid out under ECHS/ with an ECHS index", async () => {
  downloads.length = 0;
  const res = await get("/patients/export/echs", adminA);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/zip");
  assert.match(res.headers.get("content-disposition")!, /Nirmaya_ECHS_Records_\d{4}-\d{2}-\d{2}\.zip/);

  const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
  const files = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
  assert.deepEqual(files, ["ECHS/NIR-0010_Echs_Ok/ECHS_Card.jpg", "ECHS_Patient_Index.xlsx"]);
  assert.equal(await zip.file("ECHS/NIR-0010_Echs_Ok/ECHS_Card.jpg")!.async("string"), "ECHS-BYTES");

  // Only the valid ECHS object was fetched: no CGHS files, no malformed URL, nothing cross-clinic.
  assert.deepEqual(downloads, [`clinic-${CLINIC_A}/patients/${P.echsOk}/echs/1700-echs card.JPG`]);

  const index = new ExcelJS.Workbook();
  await index.xlsx.load((await zip.file("ECHS_Patient_Index.xlsx")!.async("nodebuffer")) as any);
  const sheet = index.worksheets[0];
  assert.equal(sheet.name, "ECHS Patient Index");
  assert.equal(sheet.getRow(1).getCell(6).value, "ECHS Available");
  const byName = Object.fromEntries(sheetRows(sheet).map((r) => [String(r[3]), r]));
  assert.deepEqual(Object.keys(byName).sort(), ["Echs Ok", "Echs Only"]);
  assert.equal(byName["Echs Ok"][6], "Downloaded");
  assert.equal(byName["Echs Ok"][7], "ECHS_Card.jpg");
  assert.match(String(byName["Echs Only"][6]), /^Failed - stored file location is not a valid ECHS file path/);
});

test("storage-path resolver keeps CGHS and ECHS folders separate", async () => {
  const { resolveSchemeStoragePath } = await import("../src/services/cghsExport");
  const resolve = (scheme: "cghs" | "echs", url: string) =>
    resolveSchemeStoragePath({ scheme, url, supabaseUrl: "http://localhost:54321", bucket: "test-bucket", clinicId: CLINIC_A, patientId: P.rahul });
  const echs = echsUrl(CLINIC_A, P.rahul, "1-a.pdf");
  const cghs = cghsUrl(CLINIC_A, P.rahul, "1-a.pdf");
  assert.equal(resolve("echs", echs), `clinic-${CLINIC_A}/patients/${P.rahul}/echs/1-a.pdf`);
  assert.equal(resolve("echs", cghs), null);
  assert.equal(resolve("cghs", echs), null);
  assert.equal(resolve("cghs", cghs), `clinic-${CLINIC_A}/patients/${P.rahul}/cghs/1-a.pdf`);
});
