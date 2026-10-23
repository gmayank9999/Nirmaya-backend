import assert from "node:assert/strict";
import { test } from "node:test";
import { createTransactionSchema, updateTransactionSchema } from "../src/validators/transactions";
import { createVisitWithDetailsSchema } from "../src/validators/visits";

const treatmentId = "11111111-1111-4111-8111-111111111111";
const payment = { treatmentId, patientId: treatmentId, amount: 100, type: "payment" };

test("payment SMS requires explicit opt-in on creation and editing", () => {
  for (const schema of [createTransactionSchema, updateTransactionSchema]) {
    assert.equal(schema.parse(payment).sendSms, false);
    assert.equal(schema.parse({ ...payment, sendSms: false }).sendSms, false);
    assert.equal(schema.parse({ ...payment, sendSms: true }).sendSms, true);
    assert.equal(schema.safeParse({ ...payment, sendSms: "false" }).success, false);
  }
});

test("multipart visits preserve false instead of coercing the nonempty string to true", () => {
  const visit = { treatmentId, visitDate: "2026-09-22", paymentAmount: "100" };
  assert.equal(createVisitWithDetailsSchema.parse(visit).sendSms, false);
  for (const value of [false, "false"]) {
    assert.equal(createVisitWithDetailsSchema.parse({ ...visit, sendSms: value }).sendSms, false);
  }
  for (const value of [true, "true"]) {
    assert.equal(createVisitWithDetailsSchema.parse({ ...visit, sendSms: value }).sendSms, true);
  }
  assert.equal(createVisitWithDetailsSchema.safeParse({ ...visit, sendSms: "yes" }).success, false);
});
