// One-off migration: adds patients.patient_number (NIR-0001, NIR-0002, ...).
// Existing patients are numbered in the order they were created.
// Safe to re-run. Usage: npx tsx add-patient-number.ts
import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const steps = [
  `CREATE SEQUENCE IF NOT EXISTS patients_patient_number_seq`,
  `ALTER TABLE patients ADD COLUMN IF NOT EXISTS patient_number integer`,
  `WITH ordered AS (
     SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM patients
   )
   UPDATE patients p SET patient_number = o.rn
   FROM ordered o WHERE p.id = o.id AND p.patient_number IS NULL`,
  `SELECT setval('patients_patient_number_seq',
                 COALESCE((SELECT max(patient_number) FROM patients), 0) + 1, false)`,
  `ALTER TABLE patients ALTER COLUMN patient_number SET DEFAULT nextval('patients_patient_number_seq')`,
  `ALTER TABLE patients ALTER COLUMN patient_number SET NOT NULL`,
  `ALTER SEQUENCE patients_patient_number_seq OWNED BY patients.patient_number`,
  `CREATE UNIQUE INDEX IF NOT EXISTS patients_patient_number_idx ON patients (patient_number)`,
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const sql of steps) await client.query(sql);
    await client.query("COMMIT");
    const { rows } = await client.query(
      "SELECT patient_number, name FROM patients ORDER BY patient_number"
    );
    console.table(rows);
    console.log("Done.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
