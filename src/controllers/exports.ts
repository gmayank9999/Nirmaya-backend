import { Request, Response, NextFunction } from "express";
import archiver from "archiver";
import { AppError } from "../types";
import { istDateStamp, sanitizeFilenamePart } from "../utils/filename";
import {
  Db,
  fetchClinicTransactions,
  getPatientStatement,
  summarizeTransactions,
} from "../services/exportData";
import { buildClinicReportPdf, buildPatientStatementPdf } from "../services/exportPdf";
import { buildClinicReportXlsx, buildPatientStatementXlsx } from "../services/exportXlsx";
import {
  SCHEMES,
  Scheme,
  StorageDownloader,
  listSchemePatients,
  writeSchemeZip,
} from "../services/cghsExport";
import type { TransactionExportQuery } from "../validators/exports";

export const PDF_TYPE = "application/pdf";
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const ZIP_TYPE = "application/zip";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ExportDeps {
  db: Db;
  supabaseUrl: string;
  bucket: string;
  download: StorageDownloader;
}

// Binary downloads are sent as-is (no JSON envelope); errors thrown before this point reach the error middleware.
const sendFile = (res: Response, body: Buffer, contentType: string, fileName: string) => {
  res
    .status(200)
    .set({
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
      "Access-Control-Expose-Headers": "Content-Disposition",
    })
    .end(body);
};

export const makeExportHandlers = (deps: ExportDeps) => {
  const loadClinicReport = async (req: Request) => {
    const filters = req.query as unknown as TransactionExportQuery;
    const transactions = await fetchClinicTransactions(deps.db, req.user!.clinicId, filters);
    return { filters, transactions, summary: summarizeTransactions(transactions) };
  };

  const loadStatement = async (req: Request) => {
    const patientId = req.params.id as string;
    // A malformed id can never match a patient; answer 404 like any other unknown id.
    const statement = UUID.test(patientId)
      ? await getPatientStatement(deps.db, req.user!.clinicId, patientId)
      : null;
    if (!statement) throw new AppError(404, "Patient not found", "Not found");
    const fileBase = `${statement.patient.displayId}_${sanitizeFilenamePart(
      statement.patient.name,
      "patient"
    )}_Payment_Statement`;
    return { statement, fileBase };
  };

  // One handler per scheme (CGHS / ECHS): same query, validation and ZIP layout.
  const exportSchemeZip = (scheme: Scheme) => async (req: Request, res: Response, next: NextFunction) => {
    const { label } = SCHEMES[scheme];
    if (!deps.bucket) {
      return next(new AppError(500, "Storage not configured", "Bucket missing"));
    }
    const clinicId = req.user!.clinicId;
    // Throws 404/413 before any bytes are streamed, so the normal error middleware handles it.
    const eligible = await listSchemePatients(deps.db, clinicId, scheme);

    res.status(200).set({
      "Content-Type": ZIP_TYPE,
      "Content-Disposition": `attachment; filename="Nirmaya_${label}_Records_${istDateStamp()}.zip"`,
      "Cache-Control": "no-store",
      "Access-Control-Expose-Headers": "Content-Disposition",
    });

    const archive = archiver("zip", { zlib: { level: 1 } });
    archive.on("warning", (err) => console.warn(`[${label} export] archive warning`, err));
    archive.on("error", (err) => {
      console.error(`[${label} export] archive error`, err);
      res.destroy(err);
    });
    archive.pipe(res);

    try {
      await writeSchemeZip({
        scheme,
        archive,
        eligible,
        clinicId,
        supabaseUrl: deps.supabaseUrl,
        bucket: deps.bucket,
        download: deps.download,
      });
    } catch (error) {
      console.error(`[${label} export] failed`, error);
      // Headers/body may already be on the wire: abort the connection rather than send a second response.
      archive.abort();
      res.destroy(error as Error);
    }
  };

  return {
    exportTransactionsPdf: async (req: Request, res: Response) => {
      const data = await loadClinicReport(req);
      const pdf = await buildClinicReportPdf(data);
      sendFile(res, pdf, PDF_TYPE, `Royal_Dental_Clinic_Payment_Report_${istDateStamp()}.pdf`);
    },

    exportTransactionsExcel: async (req: Request, res: Response) => {
      const data = await loadClinicReport(req);
      const xlsx = await buildClinicReportXlsx(data);
      sendFile(res, xlsx, XLSX_TYPE, `Royal_Dental_Clinic_Payment_Report_${istDateStamp()}.xlsx`);
    },

    exportPatientPdf: async (req: Request, res: Response) => {
      const { statement, fileBase } = await loadStatement(req);
      sendFile(res, await buildPatientStatementPdf(statement), PDF_TYPE, `${fileBase}.pdf`);
    },

    exportPatientExcel: async (req: Request, res: Response) => {
      const { statement, fileBase } = await loadStatement(req);
      sendFile(res, await buildPatientStatementXlsx(statement), XLSX_TYPE, `${fileBase}.xlsx`);
    },

    exportCghsZip: exportSchemeZip("cghs"),
    exportEchsZip: exportSchemeZip("echs"),
  };
};
