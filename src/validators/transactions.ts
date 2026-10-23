import { z } from "zod";

export const createTransactionSchema = z.object({
  treatmentId: z.string().uuid(),
  patientId: z.string().uuid(),
  visitId: z.string().uuid().optional().nullable(),
  type: z.enum(["payment", "refund", "adjustment"]),
  sendSms: z.boolean().optional().default(false),
  amount: z.number().positive(),
  paymentMode: z.enum(["cash", "upi", "card", "bank"]).optional().nullable(),
  referenceId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const updateTransactionSchema = z.object({
  sendSms: z.boolean().optional().default(false),
  amount: z.number().positive().optional(),
  paymentMode: z.enum(["cash", "upi", "card", "bank"]).optional().nullable(),
  referenceId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
