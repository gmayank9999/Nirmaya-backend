import { Request, Response } from "express";
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import db from "../config/db";
import { appointments } from "../schema/appointments";
import { doctors } from "../schema/doctors";
import { sendSuccess } from "../utils/response";
import { createAuditLog } from "../services/auditService";
import { AppError } from "../types";

const toMinutes = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

// Postgres returns "09:30:00"; the API exposes "09:30".
const shape = <T extends { startTime: string }>(row: T) => ({
  ...row,
  startTime: row.startTime.slice(0, 5),
});

const assertDoctor = async (clinicId: string, doctorId: string) => {
  const [doctor] = await db
    .select()
    .from(doctors)
    .where(and(eq(doctors.id, doctorId), eq(doctors.clinicId, clinicId)))
    .limit(1);
  if (!doctor) throw new AppError(404, "Doctor not found", "Not found");
  if (!doctor.isActive) {
    throw new AppError(400, "Doctor is inactive", "Cannot book an inactive doctor");
  }
};

const assertNoConflict = async (params: {
  clinicId: string;
  doctorId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  excludeId?: string;
}) => {
  let where = and(
    eq(appointments.clinicId, params.clinicId),
    eq(appointments.doctorId, params.doctorId),
    eq(appointments.appointmentDate, params.date),
    eq(appointments.isDeleted, false),
    ne(appointments.status, "cancelled")
  );
  if (params.excludeId) where = and(where, ne(appointments.id, params.excludeId));

  const sameDay = await db.select().from(appointments).where(where);
  const start = toMinutes(params.startTime);
  const end = start + params.durationMinutes;

  const clash = sameDay.find((a) => {
    const s = toMinutes(a.startTime);
    return start < s + a.durationMinutes && s < end;
  });
  if (clash) {
    throw new AppError(
      409,
      "Time slot unavailable",
      `Doctor already has an appointment at ${clash.startTime.slice(0, 5)} (${clash.patientName})`
    );
  }
};

export const createAppointment = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const body = req.body;

  await assertDoctor(clinicId, body.doctorId);
  await assertNoConflict({
    clinicId,
    doctorId: body.doctorId,
    date: body.appointmentDate,
    startTime: body.startTime,
    durationMinutes: body.durationMinutes,
  });

  const [appointment] = await db
    .insert(appointments)
    .values({ clinicId, createdBy: req.user!.id, ...body })
    .returning();

  await createAuditLog({
    clinicId,
    entity: "appointment",
    entityId: appointment.id,
    action: "create",
    newData: appointment,
    changedBy: req.user!.id,
  });

  return sendSuccess(res, shape(appointment), "Appointment booked", 201);
};

export const listAppointments = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { doctorId, from, to, status } = req.query as Record<string, string | undefined>;

  let where = and(eq(appointments.clinicId, clinicId), eq(appointments.isDeleted, false));
  if (doctorId) where = and(where, eq(appointments.doctorId, doctorId));
  if (from) where = and(where, gte(appointments.appointmentDate, from));
  if (to) where = and(where, lte(appointments.appointmentDate, to));
  if (status) where = and(where, eq(appointments.status, status as any));

  const rows = await db
    .select({
      appointment: appointments,
      doctorName: doctors.name,
    })
    .from(appointments)
    .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
    .where(where)
    .orderBy(asc(appointments.appointmentDate), asc(appointments.startTime))
    .limit(1000);

  const data = rows.map((r) => ({ ...shape(r.appointment), doctorName: r.doctorName }));
  return sendSuccess(res, data, "Appointments fetched");
};

export const updateAppointment = async (req: Request, res: Response) => {
  const clinicId = req.user!.clinicId;
  const id = req.params.id as string;

  const [existing] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, id), eq(appointments.clinicId, clinicId)))
    .limit(1);
  if (!existing) throw new AppError(404, "Appointment not found", "Not found");

  const merged = { ...existing, ...req.body };
  const rescheduled =
    merged.doctorId !== existing.doctorId ||
    merged.appointmentDate !== existing.appointmentDate ||
    merged.startTime.slice(0, 5) !== existing.startTime.slice(0, 5) ||
    merged.durationMinutes !== existing.durationMinutes;

  if (merged.doctorId !== existing.doctorId) {
    await assertDoctor(clinicId, merged.doctorId);
  }
  if (rescheduled && merged.status !== "cancelled") {
    await assertNoConflict({
      clinicId,
      doctorId: merged.doctorId,
      date: merged.appointmentDate,
      startTime: merged.startTime.slice(0, 5),
      durationMinutes: merged.durationMinutes,
      excludeId: id,
    });
  }

  const [updated] = await db
    .update(appointments)
    .set({ ...req.body, updatedAt: new Date() })
    .where(and(eq(appointments.id, id), eq(appointments.clinicId, clinicId)))
    .returning();

  await createAuditLog({
    clinicId,
    entity: "appointment",
    entityId: id,
    action: "update",
    oldData: existing,
    newData: updated,
    changedBy: req.user!.id,
  });

  return sendSuccess(res, shape(updated), "Appointment updated");
};
