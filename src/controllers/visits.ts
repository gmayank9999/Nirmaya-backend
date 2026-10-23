import { Request, Response } from "express";
import { and, eq, sql, gte, lte } from "drizzle-orm";
import db from "../config/db";
import { visits } from "../schema/visits";
import { treatments } from "../schema/treatments";
import { patients } from "../schema/patients";
import { transactions } from "../schema/transactions";
import { documents } from "../schema/documents";
import { sendSuccess } from "../utils/response";
import { parsePagination } from "../utils/pagination";
import { createAuditLog } from "../services/auditService";
import { enqueueSms } from "../services/smsService";
import { uploadToStorage } from "../services/documentService";
import { AppError } from "../types";

const getVisitDetailFiles = (req: Request) => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  return {
    reportFiles: files?.reportFiles ?? [],
    prescriptionFiles: files?.prescriptionFiles ?? [],
  };
};

const getClinicTreatment = async (clinicId: string, treatmentId: string) => {
  const [treatment] = await db
    .select()
    .from(treatments)
    .where(
      and(
        eq(treatments.id, treatmentId),
        eq(treatments.clinicId, clinicId),
        eq(treatments.isDeleted, false)
      )
    )
    .limit(1);

  if (!treatment) {
    throw new AppError(404, "Treatment not found", "Not found");
  }

  return treatment;
};

const getClinicPatient = async (clinicId: string, patientId: string) => {
  const [patient] = await db
    .select()
    .from(patients)
    .where(
      and(
        eq(patients.id, patientId),
        eq(patients.clinicId, clinicId),
        eq(patients.isActive, true)
      )
    )
    .limit(1);

  if (!patient) {
    throw new AppError(404, "Patient not found", "Not found");
  }

  return patient;
};

const parseNameList = (value: unknown) => {
  if (!value) return [] as string[];
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item))
          .filter((item) => item.trim().length > 0);
      }
    } catch (_) {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
  }
  return [] as string[];
};

export const createVisit = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const treatment = await getClinicTreatment(clinicId, req.body.treatmentId);
  const patient = await getClinicPatient(clinicId, treatment.patientId);

  const [visit] = await db
    .insert(visits)
    .values({
      clinicId,
      ...req.body,
    })
    .returning();

  await createAuditLog({
    clinicId,
    entity: "visit",
    entityId: visit.id,
    action: "create",
    newData: visit,
    changedBy: req.user!.id,
  });

  await enqueueSms({
    clinicId,
    patientId: treatment.patientId,
    treatmentId: treatment.id,
    eventType: "visit_added",
    payload: {
      visitDate: visit.visitDate,
      treatmentTitle: treatment.title,
      patientName: patient.name,
      phone: patient.phone,
    },
  });

  return sendSuccess(res, visit, "Visit created", 201);
};

export const createVisitWithDetails = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const treatment = await getClinicTreatment(clinicId, req.body.treatmentId);
  const patient = await getClinicPatient(clinicId, treatment.patientId);
  const files = getVisitDetailFiles(req);
  const reportNames = parseNameList(req.body.reportNames);
  const prescriptionNames = parseNameList(req.body.prescriptionNames);

  const [visit] = await db
    .insert(visits)
    .values({
      clinicId,
      treatmentId: req.body.treatmentId,
      visitDate: req.body.visitDate,
      notes: req.body.notes,
    })
    .returning();

  await createAuditLog({
    clinicId,
    entity: "visit",
    entityId: visit.id,
    action: "create",
    newData: visit,
    changedBy: req.user!.id,
  });

  let transaction: typeof transactions.$inferSelect | null = null;
  if (req.body.paymentAmount) {
    [transaction] = await db
      .insert(transactions)
      .values({
        clinicId,
        treatmentId: treatment.id,
        patientId: treatment.patientId,
        visitId: visit.id,
        type: "payment",
        amount: req.body.paymentAmount,
        paymentMode: req.body.paymentMode || null,
        referenceId: req.body.paymentReferenceId || null,
        notes: req.body.paymentNotes || null,
      })
      .returning();

    await createAuditLog({
      clinicId,
      entity: "transaction",
      entityId: transaction.id,
      action: "create",
      newData: transaction,
      changedBy: req.user!.id,
    });

    if (req.body.sendSms === true) await enqueueSms({
      clinicId,
      patientId: transaction.patientId,
      treatmentId: transaction.treatmentId,
      eventType: "payment_added",
      payload: {
        amount: transaction.amount,
        paymentMode: transaction.paymentMode,
        patientName: patient.name,
        phone: patient.phone,
      },
    });
  }

  const uploadedDocuments = [];
  const uploadVisitDocument = async (
    file: Express.Multer.File,
    category: "report" | "prescription",
    name?: string
  ) => {
    const uploaded = await uploadToStorage({
      clinicId,
      patientId: treatment.patientId,
      fileName: file.originalname,
      fileBuffer: file.buffer,
      contentType: file.mimetype,
      folder: category,
    });

    const [document] = await db
      .insert(documents)
      .values({
        clinicId,
        patientId: treatment.patientId,
        treatmentId: treatment.id,
        visitId: visit.id,
        category,
        fileUrl: uploaded.publicUrl,
        name: name || null,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        uploadedBy: req.user!.id,
      })
      .returning();

    await createAuditLog({
      clinicId,
      entity: "document",
      entityId: document.id,
      action: "create",
      newData: document,
      changedBy: req.user!.id,
    });

    return document;
  };

  for (const [index, file] of files.reportFiles.entries()) {
    uploadedDocuments.push(
      await uploadVisitDocument(file, "report", reportNames[index])
    );
  }
  for (const [index, file] of files.prescriptionFiles.entries()) {
    const document = await uploadVisitDocument(
      file,
      "prescription",
      prescriptionNames[index]
    );
    uploadedDocuments.push(document);
    await enqueueSms({
      clinicId,
      patientId: treatment.patientId,
      treatmentId: treatment.id,
      eventType: "prescription_uploaded",
      payload: {
        patientId: treatment.patientId,
        patientName: patient.name,
        phone: patient.phone,
        documentName: prescriptionNames[index] || file.originalname,
      },
    });
  }

  await enqueueSms({
    clinicId,
    patientId: treatment.patientId,
    treatmentId: treatment.id,
    eventType: "visit_added",
    payload: {
      visitDate: visit.visitDate,
      treatmentTitle: treatment.title,
      patientName: patient.name,
      phone: patient.phone,
    },
  });

  return sendSuccess(
    res,
    {
      visit,
      transaction,
      documents: uploadedDocuments,
    },
    "Visit details created",
    201
  );
};

export const listVisits = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { page, limit, offset } = parsePagination(req.query);
  const treatmentId = req.query.treatmentId as string | undefined;
  const dateFrom = req.query.dateFrom as string | undefined;
  const dateTo = req.query.dateTo as string | undefined;

  let whereClause = and(eq(visits.clinicId, clinicId), eq(visits.isDeleted, false));

  if (treatmentId) {
    whereClause = and(whereClause, eq(visits.treatmentId, treatmentId));
  }
  if (dateFrom) {
    whereClause = and(whereClause, gte(visits.visitDate, dateFrom));
  }
  if (dateTo) {
    whereClause = and(whereClause, lte(visits.visitDate, dateTo));
  }

  const data = await db
    .select()
    .from(visits)
    .where(whereClause)
    .limit(limit)
    .offset(offset)
    .orderBy(visits.visitDate);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(visits)
    .where(whereClause);

  return sendSuccess(res, data, "Visits fetched", 200, {
    page,
    limit,
    total: Number(count),
  });
};

export const getVisit = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const visitId = req.params.id as string;

  const [visit] = await db
    .select()
    .from(visits)
    .where(and(eq(visits.id, visitId), eq(visits.clinicId, clinicId), eq(visits.isDeleted, false)))
    .limit(1);

  if (!visit) {
    throw new AppError(404, "Visit not found", "Not found");
  }

  const [treatment] = await db
    .select()
    .from(treatments)
    .where(
      and(
        eq(treatments.id, visit.treatmentId),
        eq(treatments.clinicId, clinicId),
        eq(treatments.isDeleted, false)
      )
    )
    .limit(1);

  if (!treatment) {
    throw new AppError(404, "Treatment not found", "Not found");
  }

  const [patient] = await db
    .select()
    .from(patients)
    .where(and(eq(patients.id, treatment.patientId), eq(patients.clinicId, clinicId)))
    .limit(1);

  const [visitTransactions, treatmentTransactions, visitDocuments] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.visitId, visitId),
          eq(transactions.clinicId, clinicId),
          eq(transactions.isDeleted, false)
        )
      ),
    db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.treatmentId, treatment.id),
          eq(transactions.clinicId, clinicId),
          eq(transactions.isDeleted, false)
        )
      ),
    db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.visitId, visitId),
          eq(documents.clinicId, clinicId),
          eq(documents.isDeleted, false)
        )
      ),
  ]);

  const treatmentPaidAmount = treatmentTransactions.reduce(
    (sum, transaction) => sum + Number(transaction.amount),
    0
  );
  const visitPaidAmount = visitTransactions.reduce(
    (sum, transaction) => sum + Number(transaction.amount),
    0
  );
  const finalFee = Number(treatment.finalFee);

  return sendSuccess(
    res,
    {
      visit,
      patient,
      treatment: {
        ...treatment,
        paidAmount: treatmentPaidAmount,
        balance: finalFee - treatmentPaidAmount,
      },
      documents: visitDocuments,
      transactions: visitTransactions,
      paymentSummary: {
        visitPaidAmount,
        treatmentPaidAmount,
        treatmentFinalFee: finalFee,
        treatmentBalance: finalFee - treatmentPaidAmount,
      },
    },
    "Visit fetched",
    200
  );
};

export const updateVisit = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const visitId = req.params.id as string;

  const [existing] = await db
    .select()
    .from(visits)
    .where(and(eq(visits.id, visitId), eq(visits.clinicId, clinicId)))
    .limit(1);

  if (!existing) {
    throw new AppError(404, "Visit not found", "Not found");
  }
  if (req.body.treatmentId) {
    await getClinicTreatment(clinicId, req.body.treatmentId);
  }

  const [updated] = await db
    .update(visits)
    .set({
      ...req.body,
      updatedAt: new Date(),
    })
    .where(and(eq(visits.id, visitId), eq(visits.clinicId, clinicId)))
    .returning();

  await createAuditLog({
    clinicId,
    entity: "visit",
    entityId: visitId,
    action: "update",
    oldData: existing,
    newData: updated,
    changedBy: req.user!.id,
  });

  return sendSuccess(res, updated, "Visit updated", 200);
};

export const deleteVisit = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const visitId = req.params.id as string;

  const [existing] = await db
    .select()
    .from(visits)
    .where(and(eq(visits.id, visitId), eq(visits.clinicId, clinicId)))
    .limit(1);

  if (!existing) {
    throw new AppError(404, "Visit not found", "Not found");
  }

  const [updated] = await db
    .update(visits)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(and(eq(visits.id, visitId), eq(visits.clinicId, clinicId)))
    .returning();

  await createAuditLog({
    clinicId,
    entity: "visit",
    entityId: visitId,
    action: "delete",
    oldData: existing,
    newData: updated,
    changedBy: req.user!.id,
  });

  return sendSuccess(res, updated, "Visit deleted", 200);
};
