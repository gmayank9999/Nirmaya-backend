import { Request, Response } from "express";
import { and, eq, asc } from "drizzle-orm";
import db from "../config/db";
import { doctors } from "../schema/doctors";
import { sendSuccess } from "../utils/response";
import { createAuditLog } from "../services/auditService";
import { AppError } from "../types";

const requireAdmin = (req: Request) => {
  if (req.user!.role !== "admin") {
    throw new AppError(403, "Forbidden", "Only admins can manage doctors");
  }
};

export const listDoctors = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const includeInactive = req.query.includeInactive === "true";

  const whereClause = includeInactive
    ? eq(doctors.clinicId, clinicId)
    : and(eq(doctors.clinicId, clinicId), eq(doctors.isActive, true));

  const data = await db
    .select()
    .from(doctors)
    .where(whereClause)
    .orderBy(asc(doctors.name));

  return sendSuccess(res, data, "Doctors fetched");
};

export const createDoctor = async (req: Request, res: Response) => {
  requireAdmin(req);
  const clinicId = req.user!.clinicId;

  const [doctor] = await db
    .insert(doctors)
    .values({ clinicId, ...req.body })
    .returning();

  await createAuditLog({
    clinicId,
    entity: "doctor",
    entityId: doctor.id,
    action: "create",
    newData: doctor,
    changedBy: req.user!.id,
  });

  return sendSuccess(res, doctor, "Doctor added", 201);
};

export const updateDoctor = async (req: Request, res: Response) => {
  requireAdmin(req);
  const clinicId = req.user!.clinicId;
  const doctorId = req.params.id as string;

  const [existing] = await db
    .select()
    .from(doctors)
    .where(and(eq(doctors.id, doctorId), eq(doctors.clinicId, clinicId)))
    .limit(1);
  if (!existing) throw new AppError(404, "Doctor not found", "Not found");

  const [updated] = await db
    .update(doctors)
    .set({ ...req.body, updatedAt: new Date() })
    .where(and(eq(doctors.id, doctorId), eq(doctors.clinicId, clinicId)))
    .returning();

  await createAuditLog({
    clinicId,
    entity: "doctor",
    entityId: doctorId,
    action: "update",
    oldData: existing,
    newData: updated,
    changedBy: req.user!.id,
  });

  return sendSuccess(res, updated, "Doctor updated");
};
