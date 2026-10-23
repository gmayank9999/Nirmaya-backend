import { z } from "zod";

export const createDoctorSchema = z.object({
  name: z.string().trim().min(1).max(200),
  specialization: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
});

export const updateDoctorSchema = createDoctorSchema.partial().extend({
  isActive: z.boolean().optional(),
});
