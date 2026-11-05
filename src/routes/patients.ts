import { Router } from "express";
import {
  createPatient,
  deletePatient,
  getPatient,
  listPatients,
  updatePatient,
} from "../controllers/patients";
import { asyncHandler } from "../middlewares/errorHandler";
import { upload } from "../middlewares/upload";
import { requireRole } from "../middlewares/auth";
import exportHandlers from "../controllers/exportHandlers";
import { validateBody, validateQuery } from "../middlewares/validate";
import { createPatientSchema, updatePatientSchema, patientPaymentQuerySchema } from "../validators/patients";

const router = Router();

const proofUpload = upload.fields([
  { name: "idProofFile", maxCount: 1 },
  { name: "cghsFile", maxCount: 1 },
  { name: "echsFile", maxCount: 1 },
]);

// Export routes first so they are never captured by "/:id".
router.get("/export/cghs", requireRole("admin"), asyncHandler(exportHandlers.exportCghsZip));
router.get("/export/echs", requireRole("admin"), asyncHandler(exportHandlers.exportEchsZip));
router.get("/:id/export/pdf", asyncHandler(exportHandlers.exportPatientPdf));
router.get("/:id/export/excel", asyncHandler(exportHandlers.exportPatientExcel));

router.post("/", proofUpload, validateBody(createPatientSchema), asyncHandler(createPatient));
router.get("/", validateQuery(patientPaymentQuerySchema), asyncHandler(listPatients));
router.get("/:id", asyncHandler(getPatient));
router.patch("/:id", proofUpload, validateBody(updatePatientSchema), asyncHandler(updatePatient));
router.delete("/:id", asyncHandler(deletePatient));

export default router;
