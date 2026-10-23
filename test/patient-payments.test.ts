import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, desc, eq, gt, ilike, sql } from "drizzle-orm";
import { patients } from "../src/schema/patients";
import { patientPendingAmount } from "../src/services/patientBalance";
import { patientPaymentQuerySchema } from "../src/validators/patients";

const pg = new PGlite();
const db = drizzle(pg);
const pending = patientPendingAmount("clinic-a");
const activeClinic = and(eq(patients.clinicId, "clinic-a"), eq(patients.isActive, true));

before(async () => {
  // Minimal independent fixtures: never connect to the application's database.
  await pg.exec(`
    CREATE TABLE patients (id text PRIMARY KEY, clinic_id text, name text,
      gender text, has_cghs boolean, is_active boolean DEFAULT true,
      created_at timestamp DEFAULT '2026-01-01');
    CREATE TABLE treatments (id text PRIMARY KEY, patient_id text, clinic_id text,
      final_fee numeric(12,2), is_deleted boolean DEFAULT false);
    CREATE TABLE transactions (id text PRIMARY KEY, treatment_id text, clinic_id text,
      type text, amount numeric(12,2), is_deleted boolean DEFAULT false);
    INSERT INTO patients (id, clinic_id, name, gender, has_cghs, is_active) VALUES
      ('a', 'clinic-a', 'Asha', 'female', true, true),
      ('b', 'clinic-a', 'Bina', 'female', false, true),
      ('c', 'clinic-a', 'Chirag', 'male', false, true),
      ('d', 'clinic-a', 'Deepa', 'female', true, true),
      ('e', 'clinic-a', 'Esha', 'female', true, true),
      ('f', 'clinic-a', 'Farah', 'female', true, true),
      ('g', 'clinic-a', 'Gone', 'male', false, false),
      ('z', 'clinic-b', 'Other clinic', 'female', true, true);
    INSERT INTO treatments (id, patient_id, clinic_id, final_fee, is_deleted) VALUES
      ('a1', 'a', 'clinic-a', 10000, false),
      ('a2', 'a', 'clinic-a', 4000, false),
      ('a3', 'a', 'clinic-a', 90000, true),
      ('a4', 'a', 'clinic-b', 90000, false),
      ('b1', 'b', 'clinic-a', 5000, false),
      ('d1', 'd', 'clinic-a', 2000, false),
      ('e1', 'e', 'clinic-a', 5000.01, false),
      ('f1', 'f', 'clinic-a', 10000, false),
      ('g1', 'g', 'clinic-a', 99999, false),
      ('z1', 'z', 'clinic-b', 99999, false);
    INSERT INTO transactions (id, treatment_id, clinic_id, type, amount, is_deleted) VALUES
      ('p1', 'a1', 'clinic-a', 'payment', 3000, false),
      ('p2', 'a1', 'clinic-a', 'payment', 2000, false),
      ('r1', 'a1', 'clinic-a', 'refund', 1000, false),
      ('p3', 'a1', 'clinic-a', 'payment', 9000, true),
      ('p4', 'a1', 'clinic-b', 'payment', 9000, false),
      ('p5', 'a2', 'clinic-a', 'payment', 9000, false),
      ('p6', 'd1', 'clinic-a', 'payment', 2000, false),
      ('p7', 'f1', 'clinic-a', 'payment', 2000, false),
      ('p8', 'f1', 'clinic-a', 'adjustment', 1000, false);
  `);
});
after(async () => pg.close());

test("pending totals handle multiple treatments, refunds, credits and deleted records", async () => {
  const rows = await db.select({ id: patients.id, pending: pending.mapWith(Number) })
    .from(patients).where(activeClinic).orderBy(patients.id);
  assert.deepEqual(rows, [
    { id: "a", pending: 6000 }, { id: "b", pending: 5000 },
    { id: "c", pending: 0 }, { id: "d", pending: 0 },
    { id: "e", pending: 5000.01 }, { id: "f", pending: 7000 },
  ]);
});

test("any pending excludes settled patients and patients without treatments", async () => {
  const rows = await db.select({ id: patients.id }).from(patients)
    .where(and(activeClinic, gt(pending, "0"))).orderBy(patients.id);
  assert.deepEqual(rows.map(r => r.id), ["a", "b", "e", "f"]);
});

test("exclusive threshold and numeric sorting apply before pagination with matching count", async () => {
  const where = and(activeClinic, gt(pending, "5000.00"));
  const page = (offset: number) => db.select({ id: patients.id }).from(patients)
    .where(where).orderBy(desc(pending), patients.createdAt, patients.id).limit(2).offset(offset);
  assert.deepEqual((await page(0)).map(r => r.id), ["f", "a"]);
  assert.deepEqual((await page(2)).map(r => r.id), ["e"]);
  const [count] = await db.select({ total: sql`count(*)`.mapWith(Number) }).from(patients).where(where);
  assert.equal(count.total, 3);
});

test("pending filter combines with search and demographic filters", async () => {
  const rows = await db.select({ id: patients.id }).from(patients)
    .where(and(activeClinic, gt(pending, "5000"), ilike(patients.name, "%ASHA%"),
      eq(patients.gender, "female"), eq(patients.hasCghs, true)));
  assert.deepEqual(rows, [{ id: "a" }]);
});

test("payment query rejects invalid thresholds and sorting", () => {
  for (const value of ["-1", "NaN", "Infinity", "1.001", "", "1e4", ["1", "2"], "1000000000000"]) {
    assert.equal(patientPaymentQuerySchema.safeParse({ minPending: value }).success, false);
  }
  for (const value of ["0", "5000", "5000.01", "999999999999.99"]) {
    assert.equal(patientPaymentQuerySchema.safeParse({ minPending: value }).success, true);
  }
  assert.equal(patientPaymentQuerySchema.safeParse({ sortBy: "invalid" }).success, false);
  assert.equal(patientPaymentQuerySchema.safeParse({ sortBy: "pending_desc", search: "Asha" }).success, true);
});
