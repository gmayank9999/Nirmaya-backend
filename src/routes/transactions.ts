import { Router } from "express";
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  updateTransaction,
} from "../controllers/transactions";
import { asyncHandler } from "../middlewares/errorHandler";
import { validateBody, validateQuery } from "../middlewares/validate";
import exportHandlers from "../controllers/exportHandlers";
import { transactionExportQuerySchema } from "../validators/exports";
import {
  createTransactionSchema,
  updateTransactionSchema,
} from "../validators/transactions";

const router = Router();

router.get(
  "/export/pdf",
  validateQuery(transactionExportQuerySchema),
  asyncHandler(exportHandlers.exportTransactionsPdf)
);
router.get(
  "/export/excel",
  validateQuery(transactionExportQuerySchema),
  asyncHandler(exportHandlers.exportTransactionsExcel)
);

router.post(
  "/",
  validateBody(createTransactionSchema),
  asyncHandler(createTransaction)
);
router.get("/", asyncHandler(listTransactions));
router.patch(
  "/:id",
  validateBody(updateTransactionSchema),
  asyncHandler(updateTransaction)
);
router.delete("/:id", asyncHandler(deleteTransaction));

export default router;
