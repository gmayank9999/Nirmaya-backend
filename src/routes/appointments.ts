import { Router } from "express";
import {
  createAppointment,
  listAppointments,
  updateAppointment,
} from "../controllers/appointments";
import { asyncHandler } from "../middlewares/errorHandler";
import { validateBody } from "../middlewares/validate";
import {
  createAppointmentSchema,
  updateAppointmentSchema,
} from "../validators/appointments";

const router = Router();

router.get("/", asyncHandler(listAppointments));
router.post(
  "/",
  validateBody(createAppointmentSchema),
  asyncHandler(createAppointment)
);
router.patch(
  "/:id",
  validateBody(updateAppointmentSchema),
  asyncHandler(updateAppointment)
);

export default router;
