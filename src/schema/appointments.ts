import {
  pgTable,
  uuid,
  varchar,
  date,
  time,
  integer,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { clinics } from "../schema/clinics";
import { patients } from "../schema/patients";
import { doctors } from "../schema/doctors";
import { appointmentStatusEnum } from "../schema/enums";

// Date and time are stored as the clinic's local wall-clock values
// (no timezone conversion) since an appointment is a "9:30 on the 5th" thing.
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id),
    // Optional: callers may not be registered patients yet.
    patientId: uuid("patient_id").references(() => patients.id),
    patientName: varchar("patient_name", { length: 200 }).notNull(),
    patientPhone: varchar("patient_phone", { length: 20 }),
    appointmentDate: date("appointment_date").notNull(),
    startTime: time("start_time").notNull(),
    durationMinutes: integer("duration_minutes").default(30).notNull(),
    reason: text("reason"),
    status: appointmentStatusEnum("status").default("scheduled").notNull(),
    notes: text("notes"),
    isDeleted: boolean("is_deleted").default(false).notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    clinicDateIdx: index("appointments_clinic_date_idx").on(
      table.clinicId,
      table.appointmentDate
    ),
    doctorDateIdx: index("appointments_doctor_date_idx").on(
      table.doctorId,
      table.appointmentDate
    ),
  })
);
