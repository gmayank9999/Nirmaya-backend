import { and, asc, eq, gte, lt, lte, SQL } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { patients } from "../schema/patients";
import { treatments } from "../schema/treatments";
import { transactions } from "../schema/transactions";
import { AppError } from "../types";
import type { TransactionExportQuery } from "../validators/exports";

// Accepts both the node-postgres client used in production and PGlite in tests.
export type Db = PgDatabase<any, any, any>;

// Vercel functions are capped at 30s; building a PDF/XLSX from more rows than this is not safe.
export const MAX_EXPORT_ROWS = 5000;

export type TxType = "payment" | "refund" | "adjustment";

export const TYPE_LABEL: Record<TxType, string> = {
  payment: "Payment",
  refund: "Refund",
  adjustment: "Adjustment",
};

export const MODE_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank: "Bank",
};

export const displayPatientId = (patientNumber: number | null | undefined, id: string) =>
  patientNumber != null ? `NIR-${String(patientNumber).padStart(4, "0")}` : id.slice(0, 8).toUpperCase();

// Money is summed in integer paise so totals never drift.
const toPaise = (value: string | number) => Math.round(Number(value) * 100);
const fromPaise = (paise: number) => paise / 100;

export interface ExportTransaction {
  id: string;
  createdAt: Date;
  type: TxType;
  amount: number;
  paymentMode: string | null;
  referenceId: string | null;
  notes: string | null;
  patientId: string;
  patientNumber: number | null;
  patientDisplayId: string;
  patientName: string;
  patientPhone: string;
  treatmentId: string;
  treatmentTitle: string;
}

export interface TransactionSummary {
  totalTransactions: number;
  totalPayments: number;
  totalRefunds: number;
  totalAdjustments: number;
  // payments - refunds. Adjustments are reported separately and not netted here.
  netCollections: number;
  uniquePatients: number;
}

export const summarizeTransactions = (rows: ExportTransaction[]): TransactionSummary => {
  let payments = 0;
  let refunds = 0;
  let adjustments = 0;
  const patientIds = new Set<string>();
  for (const row of rows) {
    const paise = toPaise(row.amount);
    if (row.type === "payment") payments += paise;
    else if (row.type === "refund") refunds += paise;
    else adjustments += paise;
    patientIds.add(row.patientId);
  }
  return {
    totalTransactions: rows.length,
    totalPayments: fromPaise(payments),
    totalRefunds: fromPaise(refunds),
    totalAdjustments: fromPaise(adjustments),
    netCollections: fromPaise(payments - refunds),
    uniquePatients: patientIds.size,
  };
};

// Plain YYYY-MM-DD values are IST calendar days (the clinic's timezone); anything else is an exact instant.
const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const rangeStart = (value: string) =>
  isDateOnly(value) ? new Date(`${value}T00:00:00+05:30`) : new Date(value);

const toExportTransaction = (row: {
  tx: typeof transactions.$inferSelect;
  patientNumber: number | null;
  patientName: string | null;
  patientPhone: string | null;
  treatmentTitle: string | null;
}): ExportTransaction => ({
  id: row.tx.id,
  createdAt: row.tx.createdAt,
  type: row.tx.type as TxType,
  amount: Number(row.tx.amount),
  paymentMode: row.tx.paymentMode,
  referenceId: row.tx.referenceId,
  notes: row.tx.notes,
  patientId: row.tx.patientId,
  patientNumber: row.patientNumber,
  patientDisplayId: displayPatientId(row.patientNumber, row.tx.patientId),
  patientName: row.patientName ?? "Unknown patient",
  patientPhone: row.patientPhone ?? "",
  treatmentId: row.tx.treatmentId,
  treatmentTitle: row.treatmentTitle ?? "Removed treatment",
});

export const fetchClinicTransactions = async (
  db: Db,
  clinicId: string,
  filters: TransactionExportQuery
): Promise<ExportTransaction[]> => {
  const conditions: SQL[] = [eq(transactions.clinicId, clinicId), eq(transactions.isDeleted, false)];
  if (filters.patientId) conditions.push(eq(transactions.patientId, filters.patientId));
  if (filters.paymentMode) conditions.push(eq(transactions.paymentMode, filters.paymentMode));
  if (filters.transactionType) conditions.push(eq(transactions.type, filters.transactionType));
  if (filters.dateFrom) conditions.push(gte(transactions.createdAt, rangeStart(filters.dateFrom)));
  if (filters.dateTo) {
    if (isDateOnly(filters.dateTo)) {
      const next = new Date(rangeStart(filters.dateTo).getTime() + 24 * 60 * 60 * 1000);
      conditions.push(lt(transactions.createdAt, next));
    } else {
      conditions.push(lte(transactions.createdAt, new Date(filters.dateTo)));
    }
  }

  const rows = await db
    .select({
      tx: transactions,
      patientNumber: patients.patientNumber,
      patientName: patients.name,
      patientPhone: patients.phone,
      treatmentTitle: treatments.title,
    })
    .from(transactions)
    .leftJoin(
      patients,
      and(eq(patients.id, transactions.patientId), eq(patients.clinicId, clinicId))
    )
    .leftJoin(
      treatments,
      and(eq(treatments.id, transactions.treatmentId), eq(treatments.clinicId, clinicId))
    )
    .where(and(...conditions))
    .orderBy(asc(transactions.createdAt), asc(transactions.id))
    .limit(MAX_EXPORT_ROWS + 1);

  if (rows.length > MAX_EXPORT_ROWS) {
    throw new AppError(
      413,
      "Export too large",
      `More than ${MAX_EXPORT_ROWS} transactions match. Narrow the date range and try again.`
    );
  }
  return rows.map(toExportTransaction);
};

// ---------------------------------------------------------------------------
// Patient statement
// ---------------------------------------------------------------------------

export interface TreatmentLine {
  id: string;
  title: string;
  startDate: string;
  status: string;
  totalFee: number;
  discountType: string | null;
  discountValue: number | null;
  discountAmount: number;
  finalFee: number;
  payments: number;
  refunds: number;
  adjustments: number;
  // payments - refunds
  netPaid: number;
  // max(finalFee - (netPaid + adjustments), 0): same convention as patientPendingAmount.
  balance: number;
}

export interface PatientStatement {
  patient: {
    id: string;
    displayId: string;
    name: string;
    phone: string;
    email: string | null;
    gender: string | null;
  };
  treatments: TreatmentLine[];
  transactions: ExportTransaction[];
  totals: {
    totalFees: number;
    totalDiscounts: number;
    totalFinalFees: number;
    payments: number;
    refunds: number;
    adjustments: number;
    outstandingBalance: number;
  };
  // Transactions that belong to a treatment that has since been removed.
  orphanTransactionCount: number;
}

export const getPatientStatement = async (
  db: Db,
  clinicId: string,
  patientId: string
): Promise<PatientStatement | null> => {
  const [patient] = await db
    .select()
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)))
    .limit(1);
  if (!patient) return null;

  const patientTreatments = await db
    .select()
    .from(treatments)
    .where(
      and(
        eq(treatments.patientId, patientId),
        eq(treatments.clinicId, clinicId),
        eq(treatments.isDeleted, false)
      )
    )
    .orderBy(asc(treatments.startDate), asc(treatments.createdAt));

  const txs = await fetchClinicTransactions(db, clinicId, { patientId });
  const treatmentIds = new Set(patientTreatments.map((t) => t.id));

  const lines: TreatmentLine[] = patientTreatments.map((t) => {
    let payments = 0;
    let refunds = 0;
    let adjustments = 0;
    for (const tx of txs) {
      if (tx.treatmentId !== t.id) continue;
      const paise = toPaise(tx.amount);
      if (tx.type === "payment") payments += paise;
      else if (tx.type === "refund") refunds += paise;
      else adjustments += paise;
    }
    const totalFee = toPaise(t.totalFee);
    const finalFee = toPaise(t.finalFee);
    const balance = Math.max(finalFee - (payments - refunds + adjustments), 0);
    return {
      id: t.id,
      title: t.title,
      startDate: t.startDate,
      status: t.status,
      totalFee: fromPaise(totalFee),
      discountType: t.discountType,
      discountValue: t.discountValue != null ? Number(t.discountValue) : null,
      discountAmount: fromPaise(totalFee - finalFee),
      finalFee: fromPaise(finalFee),
      payments: fromPaise(payments),
      refunds: fromPaise(refunds),
      adjustments: fromPaise(adjustments),
      netPaid: fromPaise(payments - refunds),
      balance: fromPaise(balance),
    };
  });

  const sum = (pick: (l: TreatmentLine) => number) =>
    fromPaise(lines.reduce((acc, l) => acc + toPaise(pick(l)), 0));
  const summary = summarizeTransactions(txs);

  return {
    patient: {
      id: patient.id,
      displayId: displayPatientId(patient.patientNumber, patient.id),
      name: patient.name,
      phone: patient.phone,
      email: patient.email,
      gender: patient.gender,
    },
    treatments: lines,
    transactions: txs,
    totals: {
      totalFees: sum((l) => l.totalFee),
      totalDiscounts: sum((l) => l.discountAmount),
      totalFinalFees: sum((l) => l.finalFee),
      payments: summary.totalPayments,
      refunds: summary.totalRefunds,
      adjustments: summary.totalAdjustments,
      outstandingBalance: sum((l) => l.balance),
    },
    orphanTransactionCount: txs.filter((tx) => !treatmentIds.has(tx.treatmentId)).length,
  };
};

// ---------------------------------------------------------------------------
// Formatting helpers shared by PDF/XLSX builders
// ---------------------------------------------------------------------------

export const formatInr = (value: number): string =>
  `INR ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// e.g. "04 Nov 2026, 03:20 PM" in IST.
export const formatIstDateTime = (date: Date): string => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${String(
    parts.dayPeriod
  ).toUpperCase()}`;
};

export const formatIstDate = (date: Date): string =>
  date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

// A Date whose UTC fields equal the IST wall-clock time, so Excel (timezone-less) shows IST.
export const toIstWallClock = (date: Date): Date => new Date(date.getTime() + 330 * 60 * 1000);

export const describeFilters = (filters: TransactionExportQuery): string[] => {
  const parts: string[] = [];
  if (filters.dateFrom || filters.dateTo) {
    parts.push(`Period: ${filters.dateFrom ?? "beginning"} to ${filters.dateTo ?? "today"}`);
  }
  if (filters.transactionType) parts.push(`Type: ${TYPE_LABEL[filters.transactionType]}`);
  if (filters.paymentMode) parts.push(`Mode: ${MODE_LABEL[filters.paymentMode]}`);
  if (filters.patientId) parts.push("Single patient");
  return parts;
};
