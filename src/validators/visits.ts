import { z } from "zod";
import { utcDateString } from "../utils/dateTime";

const optionalNumber = z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) return undefined;
  return Number(value);
}, z.number().positive().optional());

export const createVisitSchema = z.object({
  treatmentId: z.string().uuid(),
  visitDate: utcDateString,
  notes: z.string().optional().nullable(),
});

export const updateVisitSchema = createVisitSchema.partial();

export const createVisitWithDetailsSchema = createVisitSchema.extend({
  sendSms: z.preprocess(
    (value) => value === "true" ? true : value === "false" ? false : value,
    z.boolean().optional().default(false)
  ),
  paymentAmount: optionalNumber,
  paymentMode: z.enum(["cash", "upi", "card", "bank"]).optional().nullable(),
  paymentReferenceId: z.string().optional().nullable(),
  paymentNotes: z.string().optional().nullable(),
  reportNames: z.string().optional().nullable(),
  prescriptionNames: z.string().optional().nullable(),
});
