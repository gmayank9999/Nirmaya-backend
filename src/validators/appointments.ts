import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM (24h)");

export const createAppointmentSchema = z.object({
  doctorId: z.string().uuid(),
  patientId: z.string().uuid().optional().nullable(),
  patientName: z.string().trim().min(1).max(200),
  patientPhone: z.string().trim().max(20).optional().nullable(),
  appointmentDate: dateOnly,
  startTime: timeOfDay,
  durationMinutes: z.number().int().min(5).max(480).default(30),
  reason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// No defaults on update, otherwise omitted fields would be overwritten.
export const updateAppointmentSchema = z.object({
  doctorId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional().nullable(),
  patientName: z.string().trim().min(1).max(200).optional(),
  patientPhone: z.string().trim().max(20).optional().nullable(),
  appointmentDate: dateOnly.optional(),
  startTime: timeOfDay.optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  reason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.enum(["scheduled", "completed", "cancelled", "no_show"]).optional(),
});
