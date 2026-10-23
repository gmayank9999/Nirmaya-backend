import db from "../config/db";
import { supabase } from "../config/supabase";
import { smsNotifications } from "../schema/smsNotifications";
import { smsDeliveryLogs } from "../schema/smsDeliveryLogs";
import { normalizeIndianPhoneForSms } from "../utils/phone";

const triggerSmsProcessor = async (notificationId: string) => {
  try {
    const { error } = await supabase.functions.invoke("sms-processor", {
      body: { notificationId },
    });
    if (error) {
      console.warn("SMS processor trigger failed:", error.message);
    }
  } catch (error) {
    console.warn("SMS processor trigger failed:", error);
  }
};

export const enqueueSms = async (params: {
  clinicId: string;
  patientId?: string | null;
  treatmentId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  scheduledAt?: Date;
}) => {
  const payload = { ...params.payload };
  const phone = normalizeIndianPhoneForSms(payload.phone as string | undefined);
  if (phone) {
    payload.phone = phone;
  }

  const [row] = await db
    .insert(smsNotifications)
    .values({
      clinicId: params.clinicId,
      patientId: params.patientId || null,
      treatmentId: params.treatmentId || null,
      eventType: params.eventType as any,
      payload,
      scheduledAt: params.scheduledAt || new Date(),
    })
    .returning();
  await triggerSmsProcessor(row.id);
  return row;
};

export const createSmsDeliveryLog = async (params: {
  clinicId: string;
  notificationId: string;
  recipient: string;
  messagePreview: string;
  status: "sent" | "failed" | "bounced";
  deliveryStatus?: string | null;
  deliveredAt?: Date | null;
  errorDetails?: string | null;
}) => {
  return db.insert(smsDeliveryLogs).values({
    clinicId: params.clinicId,
    notificationId: params.notificationId,
    recipient: params.recipient,
    messagePreview: params.messagePreview.slice(0, 255),
    status: params.status as any,
    deliveryStatus: params.deliveryStatus || null,
    deliveredAt: params.deliveredAt || null,
    errorDetails: params.errorDetails || null,
  });
};
