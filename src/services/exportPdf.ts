import PDFDocument from "pdfkit";
import { COLORS, CLINIC, drawLetterhead } from "./pdfHeaderService";
import {
  ExportTransaction,
  MODE_LABEL,
  PatientStatement,
  TYPE_LABEL,
  TransactionSummary,
  describeFilters,
  formatInr,
  formatIstDate,
  formatIstDateTime,
} from "./exportData";
import type { TransactionExportQuery } from "../validators/exports";

const MARGIN = { top: 36, left: 36, right: 36, bottom: 50 };
const TYPE_COLOR: Record<string, string> = {
  payment: COLORS.text,
  refund: "#B3261E",
  adjustment: "#8A5A00",
};

const newDocument = () => new PDFDocument({ size: "A4", margins: MARGIN, bufferPages: true });

const collect = (doc: PDFKit.PDFDocument) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

const contentWidth = (doc: PDFKit.PDFDocument) =>
  doc.page.width - doc.page.margins.left - doc.page.margins.right;

const maxY = (doc: PDFKit.PDFDocument) => doc.page.height - doc.page.margins.bottom;

const ensureSpace = (doc: PDFKit.PDFDocument, needed: number) => {
  if (doc.y + needed > maxY(doc)) {
    doc.addPage();
    doc.y = doc.page.margins.top;
  }
};

const title = (doc: PDFKit.PDFDocument, text: string, y: number) => {
  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor(COLORS.navy)
    .text(text, doc.page.margins.left, y, { width: contentWidth(doc), align: "center" });
  return doc.y;
};

// `keepWith` reserves room for the content that follows so a heading is never stranded at a page bottom.
const sectionHeading = (doc: PDFKit.PDFDocument, text: string, keepWith = 60) => {
  ensureSpace(doc, keepWith);
  doc
    .font("Helvetica-Bold")
    .fontSize(10.5)
    .fillColor(COLORS.navy)
    .text(text, doc.page.margins.left, doc.y + 6, { width: contentWidth(doc) });
  doc.moveDown(0.3);
};

// Two-column key/value grid inside a light box. `pairs` are laid out in `columns` columns.
const keyValueBox = (doc: PDFKit.PDFDocument, pairs: Array<[string, string]>, columns = 2) => {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const colW = width / columns;
  const rowH = 17;
  const rows = Math.ceil(pairs.length / columns);
  ensureSpace(doc, rows * rowH + 12);
  const top = doc.y + 2;
  doc.rect(left, top, width, rows * rowH + 8).lineWidth(0.6).strokeColor(COLORS.rule).stroke();
  pairs.forEach(([k, v], i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = left + col * colW + 8;
    const y = top + 6 + row * rowH;
    doc.font("Helvetica").fontSize(8.5).fillColor(COLORS.muted).text(`${k}:`, x, y, {
      width: colW * 0.52,
      lineBreak: false,
    });
    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor(COLORS.text)
      .text(v, x + colW * 0.5, y, { width: colW * 0.5 - 12, lineBreak: false, ellipsis: true });
  });
  doc.y = top + rows * rowH + 10;
};

interface Column {
  header: string;
  width: number;
  align?: "left" | "right" | "center";
}
interface Cell {
  text: string;
  color?: string;
  bold?: boolean;
}

const PAD = 3;
const FONT_SIZE = 7.5;

// Table with wrapped cells, zebra rows and a heading row repeated on each new page.
const drawTable = (doc: PDFKit.PDFDocument, columns: Column[], rows: Cell[][]) => {
  const left = doc.page.margins.left;
  const width = columns.reduce((a, c) => a + c.width, 0);

  const drawHeader = () => {
    const h = 20;
    const y = doc.y; // doc.text() moves doc.y, so fix the row's y before drawing cells
    doc.rect(left, y, width, h).fill(COLORS.navy);
    let x = left;
    for (const col of columns) {
      doc
        .font("Helvetica-Bold")
        .fontSize(FONT_SIZE)
        .fillColor("#FFFFFF")
        .text(col.header, x + PAD, y + 6, {
          width: col.width - PAD * 2,
          align: col.align ?? "left",
          lineBreak: false,
        });
      x += col.width;
    }
    doc.y = y + h;
  };

  ensureSpace(doc, 20 + 26);
  drawHeader();

  rows.forEach((cells, index) => {
    doc.font("Helvetica").fontSize(FONT_SIZE);
    const heights = cells.map((cell, i) => {
      doc.font(cell.bold ? "Helvetica-Bold" : "Helvetica").fontSize(FONT_SIZE);
      return doc.heightOfString(cell.text || " ", { width: columns[i].width - PAD * 2 });
    });
    const rowH = Math.max(...heights) + 8;

    if (doc.y + rowH > maxY(doc)) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      drawHeader();
    }

    const y = doc.y;
    if (index % 2 === 1) doc.rect(left, y, width, rowH).fill(COLORS.zebra);
    doc
      .moveTo(left, y + rowH)
      .lineTo(left + width, y + rowH)
      .lineWidth(0.4)
      .strokeColor(COLORS.rule)
      .stroke();

    let x = left;
    cells.forEach((cell, i) => {
      doc
        .font(cell.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(FONT_SIZE)
        .fillColor(cell.color ?? COLORS.text)
        .text(cell.text, x + PAD, y + 4, {
          width: columns[i].width - PAD * 2,
          align: columns[i].align ?? "left",
        });
      x += columns[i].width;
    });
    doc.y = y + rowH;
  });
  doc.y += 4;
};

const addPageNumbers = (doc: PDFKit.PDFDocument) => {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // allow drawing in the bottom margin without adding a page
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(
        `${CLINIC.fullName}  |  Page ${i + 1} of ${range.count}`,
        doc.page.margins.left,
        doc.page.height - 30,
        { width: contentWidth(doc), align: "center", lineBreak: false }
      );
    doc.page.margins.bottom = bottom;
  }
};

const typeCell = (type: string): Cell => ({
  text: TYPE_LABEL[type as keyof typeof TYPE_LABEL] ?? type,
  color: TYPE_COLOR[type],
  bold: true,
});

const amountCell = (tx: Pick<ExportTransaction, "type" | "amount">): Cell => ({
  text: formatInr(tx.amount),
  color: TYPE_COLOR[tx.type],
});

const generatedLine = (doc: PDFKit.PDFDocument, extra: string[] = []) => {
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text(
      [`Generated: ${formatIstDateTime(new Date())} IST`, ...extra].join("   |   "),
      doc.page.margins.left,
      doc.y + 2,
      { width: contentWidth(doc), align: "center" }
    );
};

// ---------------------------------------------------------------------------
// Clinic-wide payment report
// ---------------------------------------------------------------------------

export const buildClinicReportPdf = async (params: {
  transactions: ExportTransaction[];
  summary: TransactionSummary;
  filters: TransactionExportQuery;
}): Promise<Buffer> => {
  const doc = newDocument();
  const done = collect(doc);

  const headerBottom = drawLetterhead(doc);
  doc.y = title(doc, "CLINIC PAYMENT REPORT", headerBottom + 10);
  generatedLine(doc, describeFilters(params.filters));
  doc.moveDown(0.6);

  const s = params.summary;
  sectionHeading(doc, "Summary");
  keyValueBox(doc, [
    ["Total transactions", String(s.totalTransactions)],
    ["Unique patients", String(s.uniquePatients)],
    ["Total payments received", formatInr(s.totalPayments)],
    ["Total refunds", formatInr(s.totalRefunds)],
    ["Total adjustments", formatInr(s.totalAdjustments)],
    ["Net collections", formatInr(s.netCollections)],
  ]);

  sectionHeading(doc, "Transactions");
  if (params.transactions.length === 0) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text("No transactions match the selected filters.", doc.page.margins.left, doc.y + 4);
  } else {
    drawTable(
      doc,
      [
        { header: "S.No", width: 26 },
        { header: "Patient ID", width: 48 },
        { header: "Patient Name", width: 82 },
        { header: "Treatment", width: 92 },
        { header: "Date", width: 66 },
        { header: "Type", width: 52 },
        { header: "Mode", width: 36 },
        { header: "Amount", width: 68, align: "right" },
        { header: "Reference ID", width: 53 },
      ],
      params.transactions.map((tx, i) => [
        { text: String(i + 1) },
        { text: tx.patientDisplayId },
        { text: tx.patientName },
        { text: tx.treatmentTitle },
        { text: formatIstDateTime(tx.createdAt) },
        typeCell(tx.type),
        { text: tx.paymentMode ? MODE_LABEL[tx.paymentMode] ?? tx.paymentMode : "-" },
        amountCell(tx),
        { text: tx.referenceId || "-" },
      ])
    );
  }

  sectionHeading(doc, "Report totals", 110);
  keyValueBox(
    doc,
    [
      ["Payments", formatInr(s.totalPayments)],
      ["Refunds", formatInr(s.totalRefunds)],
      ["Adjustments", formatInr(s.totalAdjustments)],
      ["Net collections", formatInr(s.netCollections)],
    ],
    2
  );
  doc
    .font("Helvetica-Oblique")
    .fontSize(7.5)
    .fillColor(COLORS.muted)
    .text(
      "Net collections = payments - refunds. Adjustments are listed separately and are not included in net collections.",
      doc.page.margins.left,
      doc.y,
      { width: contentWidth(doc) }
    );

  addPageNumbers(doc);
  doc.end();
  return done;
};

// ---------------------------------------------------------------------------
// Patient payment statement
// ---------------------------------------------------------------------------

export const buildPatientStatementPdf = async (statement: PatientStatement): Promise<Buffer> => {
  const doc = newDocument();
  const done = collect(doc);
  const { patient, treatments, transactions, totals } = statement;

  const headerBottom = drawLetterhead(doc);
  doc.y = title(doc, "PATIENT PAYMENT STATEMENT", headerBottom + 10);
  generatedLine(doc);
  doc.moveDown(0.6);

  sectionHeading(doc, "Patient");
  keyValueBox(doc, [
    ["Patient ID", patient.displayId],
    ["Name", patient.name],
    ["Phone", patient.phone],
    ["Email", patient.email || "-"],
    ["Gender", patient.gender ? patient.gender[0].toUpperCase() + patient.gender.slice(1) : "-"],
    ["Statement date", formatIstDate(new Date())],
  ]);

  sectionHeading(doc, "Treatment summary");
  if (treatments.length === 0) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text("No treatments recorded for this patient.", doc.page.margins.left, doc.y + 4);
  } else {
    drawTable(
      doc,
      [
        { header: "Treatment", width: 123 },
        { header: "Total Fee", width: 66, align: "right" },
        { header: "Discount", width: 62, align: "right" },
        { header: "Final Fee", width: 66, align: "right" },
        { header: "Net Paid", width: 66, align: "right" },
        { header: "Adjust.", width: 62, align: "right" },
        { header: "Balance", width: 78, align: "right" },
      ],
      [
        ...treatments.map((t): Cell[] => [
          { text: `${t.title}\n(${t.status})` },
          { text: formatInr(t.totalFee) },
          { text: formatInr(t.discountAmount) },
          { text: formatInr(t.finalFee) },
          { text: formatInr(t.netPaid) },
          { text: formatInr(t.adjustments) },
          { text: formatInr(t.balance), bold: true, color: t.balance > 0 ? "#B3261E" : COLORS.text },
        ]),
      ]
    );
  }

  sectionHeading(doc, "Payment history");
  if (transactions.length === 0) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text("No transactions recorded for this patient.", doc.page.margins.left, doc.y + 4);
  } else {
    drawTable(
      doc,
      [
        { header: "S.No", width: 28 },
        { header: "Date", width: 74 },
        { header: "Treatment", width: 120 },
        { header: "Type", width: 60 },
        { header: "Mode", width: 44 },
        { header: "Amount", width: 90, align: "right" },
        { header: "Reference ID", width: 107 },
      ],
      transactions.map((tx, i) => [
        { text: String(i + 1) },
        { text: formatIstDateTime(tx.createdAt) },
        { text: tx.treatmentTitle },
        typeCell(tx.type),
        { text: tx.paymentMode ? MODE_LABEL[tx.paymentMode] ?? tx.paymentMode : "-" },
        amountCell(tx),
        { text: tx.referenceId || "-" },
      ])
    );
  }

  sectionHeading(doc, "Financial summary", 150);
  keyValueBox(doc, [
    ["Total treatment fees", formatInr(totals.totalFees)],
    ["Total discounts", formatInr(totals.totalDiscounts)],
    ["Total final fees", formatInr(totals.totalFinalFees)],
    ["Total payments", formatInr(totals.payments)],
    ["Total refunds", formatInr(totals.refunds)],
    ["Total adjustments", formatInr(totals.adjustments)],
    ["Outstanding balance", formatInr(totals.outstandingBalance)],
  ]);

  const notes = [
    "Balance per treatment = final fee - (payments - refunds + adjustments), never below zero. Outstanding balance is the sum of these balances and matches the pending amount shown in the patients list.",
    "Net Paid = payments - refunds. Adjustments are shown separately.",
  ];
  if (statement.orphanTransactionCount > 0) {
    notes.push(
      `${statement.orphanTransactionCount} transaction(s) belong to a removed treatment: they are listed above and included in the payment/refund/adjustment totals, but not in any treatment balance.`
    );
  }
  doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(COLORS.muted);
  for (const note of notes) {
    ensureSpace(doc, 24);
    doc.text(note, doc.page.margins.left, doc.y + 2, { width: contentWidth(doc) });
  }

  addPageNumbers(doc);
  doc.end();
  return done;
};
