import ExcelJS from "exceljs";
import {
  ExportTransaction,
  MODE_LABEL,
  PatientStatement,
  TYPE_LABEL,
  TransactionSummary,
  toIstWallClock,
} from "./exportData";

// Indian digit grouping (lakh/crore) with the rupee sign.
const INR_FORMAT =
  '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"##,##0.00';
const DATETIME_FORMAT = "dd mmm yyyy hh:mm AM/PM";
const DATE_FORMAT = "dd mmm yyyy";
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF2F4B7C" },
};

const styleHeaderRow = (sheet: ExcelJS.Worksheet) => {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle" };
  row.height = 20;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
};

const toBuffer = async (workbook: ExcelJS.Workbook) =>
  Buffer.from(await workbook.xlsx.writeBuffer());

const dateOnly = (value: string) => new Date(`${value}T00:00:00Z`);

const newWorkbook = () => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Nirmaya";
  workbook.created = new Date();
  return workbook;
};

const labelValueSheet = (
  sheet: ExcelJS.Worksheet,
  rows: Array<[string, ExcelJS.CellValue, string?]>
) => {
  sheet.columns = [
    { header: "Item", key: "k", width: 36 },
    { header: "Value", key: "v", width: 28 },
  ];
  styleHeaderRow(sheet);
  for (const [label, value, format] of rows) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { horizontal: "right" };
    if (format) row.getCell(2).numFmt = format;
  }
};

// ---------------------------------------------------------------------------
// Clinic payment report
// ---------------------------------------------------------------------------

export const buildClinicReportXlsx = async (params: {
  transactions: ExportTransaction[];
  summary: TransactionSummary;
}): Promise<Buffer> => {
  const { transactions, summary } = params;
  const workbook = newWorkbook();

  const sheet = workbook.addWorksheet("Payment Transactions");
  sheet.columns = [
    { header: "S.No", key: "sno", width: 7 },
    { header: "Patient ID", key: "pid", width: 12 },
    { header: "Patient Name", key: "name", width: 26 },
    { header: "Patient Phone", key: "phone", width: 15 },
    { header: "Treatment", key: "treatment", width: 30 },
    { header: "Transaction ID", key: "id", width: 38 },
    { header: "Transaction Date", key: "date", width: 22 },
    { header: "Transaction Type", key: "type", width: 17 },
    { header: "Payment Mode", key: "mode", width: 14 },
    { header: "Amount", key: "amount", width: 16 },
    { header: "Reference ID", key: "ref", width: 22 },
    { header: "Notes", key: "notes", width: 34 },
  ];
  styleHeaderRow(sheet);

  transactions.forEach((tx, i) => {
    const row = sheet.addRow({
      sno: i + 1,
      pid: tx.patientDisplayId,
      name: tx.patientName,
      phone: tx.patientPhone,
      treatment: tx.treatmentTitle,
      id: tx.id,
      date: toIstWallClock(tx.createdAt),
      type: TYPE_LABEL[tx.type],
      mode: tx.paymentMode ? MODE_LABEL[tx.paymentMode] ?? tx.paymentMode : "",
      amount: tx.amount,
      ref: tx.referenceId ?? "",
      notes: tx.notes ?? "",
    });
    row.getCell("date").numFmt = DATETIME_FORMAT;
    row.getCell("amount").numFmt = INR_FORMAT;
  });
  sheet.autoFilter = { from: "A1", to: "L1" };

  const last = Math.max(transactions.length + 1, 2);
  const typeRange = `'Payment Transactions'!$H$2:$H$${last}`;
  const amountRange = `'Payment Transactions'!$J$2:$J$${last}`;
  const sumType = (label: string) => `SUMIFS(${amountRange},${typeRange},"${label}")`;

  const summarySheet = workbook.addWorksheet("Summary");
  labelValueSheet(summarySheet, [
    ["Report generated (IST)", toIstWallClock(new Date()), DATETIME_FORMAT],
    [
      "Total transactions",
      {
        formula: `COUNTA('Payment Transactions'!$F$2:$F$${last})`,
        result: summary.totalTransactions,
      },
    ],
    ["Total payments", { formula: sumType("Payment"), result: summary.totalPayments }, INR_FORMAT],
    ["Total refunds", { formula: sumType("Refund"), result: summary.totalRefunds }, INR_FORMAT],
    [
      "Total adjustments",
      { formula: sumType("Adjustment"), result: summary.totalAdjustments },
      INR_FORMAT,
    ],
    [
      "Net collections (payments - refunds)",
      { formula: "B4-B5", result: summary.netCollections },
      INR_FORMAT,
    ],
    [
      "Unique patients",
      transactions.length === 0
        ? 0
        : {
            formula: `SUMPRODUCT(1/COUNTIF('Payment Transactions'!$B$2:$B$${last},'Payment Transactions'!$B$2:$B$${last}))`,
            result: summary.uniquePatients,
          },
    ],
  ]);
  summarySheet.addRow([]);
  summarySheet.addRow(["Adjustments are reported separately and are not netted into net collections."]);

  return toBuffer(workbook);
};

// ---------------------------------------------------------------------------
// Patient statement
// ---------------------------------------------------------------------------

export const buildPatientStatementXlsx = async (statement: PatientStatement): Promise<Buffer> => {
  const { patient, treatments, transactions, totals } = statement;
  const workbook = newWorkbook();

  const details = workbook.addWorksheet("Patient Details");
  labelValueSheet(details, [
    ["Patient ID", patient.displayId],
    ["Patient Name", patient.name],
    ["Phone", patient.phone],
    ["Email", patient.email ?? ""],
    ["Gender", patient.gender ? patient.gender[0].toUpperCase() + patient.gender.slice(1) : ""],
    ["Statement generated (IST)", toIstWallClock(new Date()), DATETIME_FORMAT],
  ]);

  const ts = workbook.addWorksheet("Treatment Summary");
  ts.columns = [
    { header: "Treatment", key: "title", width: 30 },
    { header: "Start Date", key: "start", width: 14 },
    { header: "Status", key: "status", width: 12 },
    { header: "Total Fee", key: "total", width: 15 },
    { header: "Discount Type", key: "dtype", width: 14 },
    { header: "Discount Value", key: "dvalue", width: 15 },
    { header: "Final Fee", key: "final", width: 15 },
    { header: "Payments", key: "pay", width: 15 },
    { header: "Refunds", key: "ref", width: 15 },
    { header: "Adjustments", key: "adj", width: 15 },
    { header: "Net Paid (Payments - Refunds)", key: "net", width: 18 },
    { header: "Balance", key: "bal", width: 15 },
  ];
  styleHeaderRow(ts);
  ts.getRow(1).alignment = { vertical: "middle", wrapText: true };
  ts.getRow(1).height = 32;
  treatments.forEach((t, i) => {
    const r = i + 2;
    const row = ts.addRow({
      title: t.title,
      start: dateOnly(t.startDate),
      status: t.status,
      total: t.totalFee,
      dtype: t.discountType === "percentage" ? "Percentage" : t.discountType === "fixed_amount" ? "Fixed amount" : "",
      dvalue: t.discountValue ?? "",
      final: t.finalFee,
      pay: t.payments,
      ref: t.refunds,
      adj: t.adjustments,
      net: { formula: `H${r}-I${r}`, result: t.netPaid },
      bal: { formula: `MAX(G${r}-(K${r}+J${r}),0)`, result: t.balance },
    });
    row.getCell("start").numFmt = DATE_FORMAT;
    for (const key of ["total", "final", "pay", "ref", "adj", "net", "bal"]) {
      row.getCell(key).numFmt = INR_FORMAT;
    }
    if (t.discountType === "fixed_amount") row.getCell("dvalue").numFmt = INR_FORMAT;
  });
  ts.autoFilter = { from: "A1", to: "L1" };

  const history = workbook.addWorksheet("Transaction History");
  history.columns = [
    { header: "Transaction ID", key: "id", width: 38 },
    { header: "Date", key: "date", width: 22 },
    { header: "Treatment", key: "treatment", width: 30 },
    { header: "Type", key: "type", width: 14 },
    { header: "Payment Mode", key: "mode", width: 14 },
    { header: "Amount", key: "amount", width: 16 },
    { header: "Reference ID", key: "ref", width: 22 },
    { header: "Notes", key: "notes", width: 34 },
  ];
  styleHeaderRow(history);
  for (const tx of transactions) {
    const row = history.addRow({
      id: tx.id,
      date: toIstWallClock(tx.createdAt),
      treatment: tx.treatmentTitle,
      type: TYPE_LABEL[tx.type],
      mode: tx.paymentMode ? MODE_LABEL[tx.paymentMode] ?? tx.paymentMode : "",
      amount: tx.amount,
      ref: tx.referenceId ?? "",
      notes: tx.notes ?? "",
    });
    row.getCell("date").numFmt = DATETIME_FORMAT;
    row.getCell("amount").numFmt = INR_FORMAT;
  }
  history.autoFilter = { from: "A1", to: "H1" };

  const tLast = Math.max(treatments.length + 1, 2);
  const hLast = Math.max(transactions.length + 1, 2);
  const histType = `'Transaction History'!$D$2:$D$${hLast}`;
  const histAmount = `'Transaction History'!$F$2:$F$${hLast}`;
  const histSum = (label: string) => `SUMIFS(${histAmount},${histType},"${label}")`;
  const tsSum = (col: string) => `SUM('Treatment Summary'!${col}2:${col}${tLast})`;

  const fin = workbook.addWorksheet("Financial Summary");
  labelValueSheet(fin, [
    ["Total treatment fees", { formula: tsSum("D"), result: totals.totalFees }, INR_FORMAT],
    ["Discounts", { formula: "B2-B4", result: totals.totalDiscounts }, INR_FORMAT],
    ["Final fees", { formula: tsSum("G"), result: totals.totalFinalFees }, INR_FORMAT],
    ["Payments", { formula: histSum("Payment"), result: totals.payments }, INR_FORMAT],
    ["Refunds", { formula: histSum("Refund"), result: totals.refunds }, INR_FORMAT],
    ["Adjustments", { formula: histSum("Adjustment"), result: totals.adjustments }, INR_FORMAT],
    ["Outstanding balance", { formula: tsSum("L"), result: totals.outstandingBalance }, INR_FORMAT],
  ]);
  fin.addRow([]);
  fin.addRow([
    "Balance per treatment = final fee - (payments - refunds + adjustments), never below zero; outstanding balance is the sum of those balances (same convention as the patients list).",
  ]);
  if (statement.orphanTransactionCount > 0) {
    fin.addRow([
      `${statement.orphanTransactionCount} transaction(s) belong to a removed treatment and are included in the payment/refund/adjustment totals but not in any treatment balance.`,
    ]);
  }

  return toBuffer(workbook);
};

// ---------------------------------------------------------------------------
// CGHS / ECHS index
// ---------------------------------------------------------------------------

export interface SchemeIndexRow {
  patientId: string;
  patientNumber: number | null;
  patientDisplayId: string;
  name: string;
  phone: string;
  available: boolean;
  status: string;
  fileName: string;
}

export const buildSchemeIndexXlsx = async (
  rows: SchemeIndexRow[],
  exportDate: Date,
  label: string
): Promise<Buffer> => {
  const workbook = newWorkbook();
  const sheet = workbook.addWorksheet(`${label} Patient Index`);
  sheet.columns = [
    { header: "S.No", key: "sno", width: 7 },
    { header: "Patient ID", key: "pid", width: 38 },
    { header: "Patient Number", key: "num", width: 16 },
    { header: "Patient Name", key: "name", width: 28 },
    { header: "Phone Number", key: "phone", width: 16 },
    { header: `${label} Available`, key: "avail", width: 15 },
    { header: "Document Download Status", key: "status", width: 40 },
    { header: "Document Filename", key: "file", width: 34 },
    { header: "Export Date", key: "date", width: 22 },
  ];
  styleHeaderRow(sheet);
  rows.forEach((r, i) => {
    const row = sheet.addRow({
      sno: i + 1,
      pid: r.patientId,
      num: r.patientDisplayId,
      name: r.name,
      phone: r.phone,
      avail: r.available ? "Yes" : "No",
      status: r.status,
      file: r.fileName,
      date: toIstWallClock(exportDate),
    });
    row.getCell("date").numFmt = DATETIME_FORMAT;
  });
  sheet.autoFilter = { from: "A1", to: "I1" };
  return toBuffer(workbook);
};
