import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "receptionist"]);

export const genderEnum = pgEnum("gender", ["male", "female", "other"]);

export const treatmentStatusEnum = pgEnum("treatment_status", [
  "planned",
  "ongoing",
  "paused",
  "completed",
  "cancelled",
]);

export const discountTypeEnum = pgEnum("discount_type", [
  "percentage",
  "fixed_amount",
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "payment",
  "refund",
  "adjustment",
]);

export const paymentModeEnum = pgEnum("payment_mode", [
  "cash",
  "upi",
  "card",
  "bank",
]);

export const installmentStatusEnum = pgEnum("installment_status", [
  "pending",
  "paid",
  "overdue",
]);

export const followupStatusEnum = pgEnum("followup_status", [
  "scheduled",
  "completed",
  "missed",
  "rescheduled",
]);

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
]);

export const documentCategoryEnum = pgEnum("document_category", [
  "prescription",
  "report",
  "cghs",
  "echs",
  "id_proof",
  "other",
]);

export const auditEntityEnum = pgEnum("audit_entity", [
  "patient",
  "treatment",
  "transaction",
  "visit",
  "installment",
  "document",
  "followup",
  "bill",
  "doctor",
  "appointment",
]);

export const auditActionEnum = pgEnum("audit_action", [
  "create",
  "update",
  "delete",
]);

export const smsEventEnum = pgEnum("sms_event", [
  "patient_created",
  "patient_updated",
  "treatment_created",
  "visit_added",
  "prescription_uploaded",
  "payment_added",
  "payment_updated",
  "followup_created",
  "payment_reminder",
]);

export const smsStatusEnum = pgEnum("sms_status", [
  "pending",
  "sent",
  "failed",
]);

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "sent",
  "failed",
  "bounced",
]);
