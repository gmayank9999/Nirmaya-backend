import { Router } from "express";
import { createDoctor, listDoctors, updateDoctor } from "../controllers/doctors";
import { asyncHandler } from "../middlewares/errorHandler";
import { validateBody } from "../middlewares/validate";
import { createDoctorSchema, updateDoctorSchema } from "../validators/doctors";

const router = Router();

router.get("/", asyncHandler(listDoctors));
router.post("/", validateBody(createDoctorSchema), asyncHandler(createDoctor));
router.patch("/:id", validateBody(updateDoctorSchema), asyncHandler(updateDoctor));

export default router;
