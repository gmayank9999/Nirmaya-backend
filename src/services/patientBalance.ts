import { getTableName, sql } from "drizzle-orm";
import { patients } from "../schema/patients";

// Sum positive balances per treatment: a credit on one treatment must not
// hide an unpaid balance on another. Refund amounts are stored as positive.
// Adjustments retain the existing ledger convention of reducing the balance.
export const patientPendingAmount = (clinicId: string) => sql<number>`COALESCE((
  SELECT SUM(GREATEST(t.final_fee - COALESCE((
    SELECT SUM(CASE WHEN tx.type = 'refund' THEN -tx.amount ELSE tx.amount END)
    FROM transactions tx
    WHERE tx.treatment_id = t.id
      AND tx.clinic_id = ${clinicId}
      AND tx.is_deleted = false
  ), 0), 0))
  FROM treatments t
  WHERE t.patient_id = ${sql.identifier(getTableName(patients))}.${sql.identifier(patients.id.name)}
    AND t.clinic_id = ${clinicId}
    AND t.is_deleted = false
), 0)`;
