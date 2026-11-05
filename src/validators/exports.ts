import { z } from "zod";

// Dates may be a plain YYYY-MM-DD (interpreted as an IST calendar day) or a full ISO timestamp.
const dateParam = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isNaN(new Date(v).getTime()), {
    message: "Expected YYYY-MM-DD or an ISO timestamp",
  });

export const transactionExportQuerySchema = z.object({
  dateFrom: dateParam.optional(),
  dateTo: dateParam.optional(),
  paymentMode: z.enum(["cash", "upi", "card", "bank"]).optional(),
  transactionType: z.enum(["payment", "refund", "adjustment"]).optional(),
  patientId: z.string().uuid().optional(),
});

export type TransactionExportQuery = z.infer<typeof transactionExportQuerySchema>;
