import { z } from "zod";

export const phone10 = z
  .string()
  .trim()
  .regex(/^\d{10}$/, "Phone number must be exactly 10 digits");

const optionalNumber = z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) return undefined;
  return Number(value);
}, z.number().min(0).optional().nullable());

const optionalInteger = z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) return undefined;
  return Number(value);
}, z.number().int().min(0).optional().nullable());

const optionalBoolean = z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes", "on"].includes(value.toLowerCase());
  return value;
}, z.boolean().optional());

export const createPatientSchema = z.object({
  name: z.string().min(2),
  phone: phone10,
  email: z.string().email().optional().nullable(),
  age: optionalInteger,
  gender: z.enum(["male", "female", "other"]).optional().nullable(),
  heightCm: optionalNumber,
  weightKg: optionalNumber,
  bloodGroup: z.string().optional().nullable(),
  hasIdProof: optionalBoolean,
  idProofFileUrl: z.string().url().optional().nullable(),
  hasCghs: optionalBoolean,
  cghsFileUrl: z.string().url().optional().nullable(),
  hasEchs: optionalBoolean,
  echsFileUrl: z.string().url().optional().nullable(),
});

export const updatePatientSchema = createPatientSchema.partial();

// Keep existing patient query parameters; validate the new payment options.
// minPending is exclusive: 0 means any outstanding balance.
export const patientPaymentQuerySchema = z.object({
  minPending: z.string().trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter a non-negative amount with up to 2 decimal places")
    .optional(),
  sortBy: z.enum(["createdAt", "pending_desc"]).optional(),
}).passthrough();
