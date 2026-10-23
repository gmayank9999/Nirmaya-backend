import { Router } from "express";
import authRoutes from "../routes/auth";
import healthRoutes from "../routes/health";
import patientRoutes from "../routes/patients";
import treatmentRoutes from "../routes/treatments";
import visitRoutes from "../routes/visits";
import transactionRoutes from "../routes/transactions";
import installmentRoutes from "../routes/installments";
import documentRoutes from "../routes/documents";
import followupRoutes from "../routes/followups";
import doctorRoutes from "../routes/doctors";
import appointmentRoutes from "../routes/appointments";
import billRoutes from "../routes/bills";
import auditRoutes from "../routes/auditLogs";
import dashboardRoutes from "../routes/dashboard";
import { requireAuth, requireClinicScope } from "../middlewares/auth";

const router = Router();

const normalizeRouter = <T>(mod: T): T => {
	const anyMod = mod as any;
	return (anyMod?.default ?? anyMod) as T;
};

router.use("/auth", normalizeRouter(authRoutes));
router.use("/health", normalizeRouter(healthRoutes));

// Protected routes
router.use(requireAuth, requireClinicScope);
router.use("/dashboard", normalizeRouter(dashboardRoutes));
router.use("/patients", normalizeRouter(patientRoutes));
router.use("/treatments", normalizeRouter(treatmentRoutes));
router.use("/visits", normalizeRouter(visitRoutes));
router.use("/transactions", normalizeRouter(transactionRoutes));
router.use("/installments", normalizeRouter(installmentRoutes));
router.use("/documents", normalizeRouter(documentRoutes));
router.use("/followups", normalizeRouter(followupRoutes));
router.use("/doctors", normalizeRouter(doctorRoutes));
router.use("/appointments", normalizeRouter(appointmentRoutes));
router.use("/bills", normalizeRouter(billRoutes));
router.use("/audit-logs", normalizeRouter(auditRoutes));

export default router;
