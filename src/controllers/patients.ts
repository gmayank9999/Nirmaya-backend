import { Request, Response } from "express";
import { and, eq, ilike, or, sql, inArray, gt, desc, getTableColumns } from "drizzle-orm";
import db from "../config/db";
import { patients } from "../schema/patients";
import { treatments } from "../schema/treatments";
import { visits } from "../schema/visits";
import { documents } from "../schema/documents";
import { transactions } from "../schema/transactions";
import { followups } from "../schema/followups";
import { sendSuccess } from "../utils/response";
import { parsePagination } from "../utils/pagination";
import { createAuditLog } from "../services/auditService";
import { enqueueSms } from "../services/smsService";
import { uploadToStorage } from "../services/documentService";
import { AppError } from "../types";
import { patientPendingAmount } from "../services/patientBalance";

const getPatientProofFiles = (req: Request) => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  return {
    idProofFile: files?.idProofFile?.[0],
    cghsFile: files?.cghsFile?.[0],
    echsFile: files?.echsFile?.[0],
  };
};

const uploadPatientProofFiles = async (params: {
  clinicId: string;
  patientId: string;
  files: ReturnType<typeof getPatientProofFiles>;
}) => {
  const updates: Partial<typeof patients.$inferInsert> = {};

  const uploadProof = async (
    file: Express.Multer.File | undefined,
    folder: string
  ) => {
    if (!file) return null;
    return uploadToStorage({
      clinicId: params.clinicId,
      patientId: params.patientId,
      fileName: file.originalname,
      fileBuffer: file.buffer,
      contentType: file.mimetype,
      folder,
    });
  };

  const [idProof, cghs, echs] = await Promise.all([
    uploadProof(params.files.idProofFile, "id-proof"),
    uploadProof(params.files.cghsFile, "cghs"),
    uploadProof(params.files.echsFile, "echs"),
  ]);

  if (idProof) {
    updates.hasIdProof = true;
    updates.idProofFileUrl = idProof.publicUrl;
  }
  if (cghs) {
    updates.hasCghs = true;
    updates.cghsFileUrl = cghs.publicUrl;
  }
  if (echs) {
    updates.hasEchs = true;
    updates.echsFileUrl = echs.publicUrl;
  }

  return updates;
};

const assertRequiredProofFiles = (params: {
  body: Record<string, any>;
  files: ReturnType<typeof getPatientProofFiles>;
  existing?: typeof patients.$inferSelect;
}) => {
  const hasCghs = params.body.hasCghs ?? params.existing?.hasCghs ?? false;
  const hasEchs = params.body.hasEchs ?? params.existing?.hasEchs ?? false;
  const cghsFileUrl = params.body.cghsFileUrl ?? params.existing?.cghsFileUrl;
  const echsFileUrl = params.body.echsFileUrl ?? params.existing?.echsFileUrl;

  if (hasCghs && !params.files.cghsFile && !cghsFileUrl) {
    throw new AppError(
      400,
      "CGHS document is required",
      "Upload cghsFile or provide cghsFileUrl when hasCghs is true"
    );
  }

  if (hasEchs && !params.files.echsFile && !echsFileUrl) {
    throw new AppError(
      400,
      "ECHS document is required",
      "Upload echsFile or provide echsFileUrl when hasEchs is true"
    );
  }
};

export const createPatient = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const files = getPatientProofFiles(req);
  assertRequiredProofFiles({ body: req.body, files });

  const [createdPatient] = await db
    .insert(patients)
    .values({
      clinicId,
      ...req.body,
    })
    .returning();

  const proofUpdates = await uploadPatientProofFiles({
    clinicId,
    patientId: createdPatient.id,
    files,
  });

  const [patient] = Object.keys(proofUpdates).length
    ? await db
        .update(patients)
        .set({ ...proofUpdates, updatedAt: new Date() })
        .where(and(eq(patients.id, createdPatient.id), eq(patients.clinicId, clinicId)))
        .returning()
    : [createdPatient];

  await createAuditLog({
    clinicId,
    entity: "patient",
    entityId: patient.id,
    action: "create",
    newData: patient,
    changedBy: req.user!.id,
  });

  await enqueueSms({
    clinicId,
    patientId: patient.id,
    eventType: "patient_created",
    payload: { patientName: patient.name, phone: patient.phone },
  });

  return sendSuccess(res, patient, "Patient created", 201);
};

export const listPatients = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { page, limit, offset } = parsePagination(req.query);
  const search = (req.query.search as string) || "";
  const gender = req.query.gender as "male" | "female" | "other" | undefined;
  const hasIdProof = req.query.hasIdProof as string | undefined;
  const hasCghs = req.query.hasCghs as string | undefined;
  const hasEchs = req.query.hasEchs as string | undefined;
  const createdFrom = req.query.createdFrom as string | undefined;
  const createdTo = req.query.createdTo as string | undefined;
  const minPending = req.query.minPending as string | undefined;
  const pendingAmount = patientPendingAmount(clinicId);

  let whereClause = and(eq(patients.clinicId, clinicId), eq(patients.isActive, true));

  if (search) {
    // "12", "#12" and "NIR-0012" all look up patient number 12.
    const numberMatch = search.trim().match(/^(?:nir-?|#)?0*(\d+)$/i);
    whereClause = and(
      whereClause,
      or(
        ilike(patients.phone, `%${search}%`),
        ilike(patients.name, `%${search}%`),
        numberMatch ? eq(patients.patientNumber, Number(numberMatch[1])) : undefined
      )
    );
  }
  if (gender) {
    whereClause = and(whereClause, eq(patients.gender, gender));
  }
  if (hasIdProof !== undefined) {
    whereClause = and(whereClause, eq(patients.hasIdProof, hasIdProof === "true"));
  }
  if (hasCghs !== undefined) {
    whereClause = and(whereClause, eq(patients.hasCghs, hasCghs === "true"));
  }
  if (hasEchs !== undefined) {
    whereClause = and(whereClause, eq(patients.hasEchs, hasEchs === "true"));
  }
  if (createdFrom) {
    whereClause = and(whereClause, sql`${patients.createdAt} >= ${new Date(createdFrom)}`);
  }
  if (createdTo) {
    whereClause = and(whereClause, sql`${patients.createdAt} <= ${new Date(createdTo)}`);
  }

  if (minPending !== undefined) {
    whereClause = and(whereClause, gt(pendingAmount, minPending));
  }

  const data = await db
    .select({ ...getTableColumns(patients), pendingAmount: pendingAmount.as("pendingAmount") })
    .from(patients)
    .where(whereClause)
    .limit(limit)
    .offset(offset)
    .orderBy(
      ...(req.query.sortBy === "pending_desc" ? [desc(pendingAmount)] : []),
      patients.createdAt,
      patients.id
    );

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(patients)
    .where(whereClause);

  return sendSuccess(res, data, "Patients fetched", 200, {
    page,
    limit,
    total: Number(count),
  });
};

export const getPatient = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const patientId = req.params.id as string;

  const [patient] = await db
    .select()
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)))
    .limit(1);

  if (!patient) {
    throw new AppError(404, "Patient not found", "Not found");
  }

  const patientTreatments = await db
    .select()
    .from(treatments)
    .where(
      and(
        eq(treatments.patientId, patientId),
        eq(treatments.clinicId, clinicId),
        eq(treatments.isDeleted, false)
      )
    );

  const treatmentIds = patientTreatments.map((t) => t.id);

  const [patientVisits, patientDocuments, patientTransactions, patientFollowups] =
    await Promise.all([
      treatmentIds.length
        ? db
            .select()
            .from(visits)
            .where(
              and(
                eq(visits.clinicId, clinicId),
                eq(visits.isDeleted, false),
                inArray(visits.treatmentId, treatmentIds)
              )
            )
        : Promise.resolve([]),
      db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.patientId, patientId),
            eq(documents.clinicId, clinicId),
            eq(documents.isDeleted, false)
          )
        ),
      db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.patientId, patientId),
            eq(transactions.clinicId, clinicId),
            eq(transactions.isDeleted, false)
          )
        ),
      db
        .select()
        .from(followups)
        .where(
          and(
            eq(followups.patientId, patientId),
            eq(followups.clinicId, clinicId),
            eq(followups.isDeleted, false)
          )
        ),
    ]);

  return sendSuccess(
    res,
    {
      patient,
      treatments: patientTreatments,
      visits: patientVisits,
      documents: patientDocuments,
      transactions: patientTransactions,
      followups: patientFollowups,
    },
    "Patient fetched",
    200
  );
};

export const updatePatient = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const patientId = req.params.id as string;
  const files = getPatientProofFiles(req);

  const [existing] = await db
    .select()
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)))
    .limit(1);

  if (!existing) {
    throw new AppError(404, "Patient not found", "Not found");
  }
  assertRequiredProofFiles({ body: req.body, files, existing });

  const proofUpdates = await uploadPatientProofFiles({
    clinicId,
    patientId,
    files,
  });

  const [updated] = await db
    .update(patients)
    .set({
      ...req.body,
      ...(req.body.hasCghs === false ? { cghsFileUrl: null } : {}),
      ...(req.body.hasEchs === false ? { echsFileUrl: null } : {}),
      ...proofUpdates,
      updatedAt: new Date(),
    })
    .where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)))
    .returning();

  await createAuditLog({
    clinicId,
    entity: "patient",
    entityId: patientId,
    action: "update",
    oldData: existing,
    newData: updated,
    changedBy: req.user!.id,
  });

  await enqueueSms({
    clinicId,
    patientId: updated.id,
    eventType: "patient_updated",
    payload: {
      patientName: updated.name,
      phone: updated.phone,
    },
  });

  return sendSuccess(res, updated, "Patient updated", 200);
};

export const deletePatient = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const patientId = req.params.id as string;

  const [existing] = await db
    .select()
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)))
    .limit(1);

  if (!existing) {
    throw new AppError(404, "Patient not found", "Not found");
  }

  const [updated] = await db
    .update(patients)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)))
    .returning();

  await createAuditLog({
    clinicId,
    entity: "patient",
    entityId: patientId,
    action: "delete",
    oldData: existing,
    newData: updated,
    changedBy: req.user!.id,
  });

  return sendSuccess(res, updated, "Patient deactivated", 200);
};
