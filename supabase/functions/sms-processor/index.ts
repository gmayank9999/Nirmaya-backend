import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const twilioPhone = Deno.env.get("TWILIO_PHONE") || "";
const demoMode = Deno.env.get("TWILIO_DEMO_MODE") === "true";
const demoTo = Deno.env.get("TWILIO_DEMO_TO") || "";
const demoTemplate = "sms_appointment_reminders";

const supabase = createClient(supabaseUrl, serviceKey);

const normalizeIndianPhoneForSms = (phone: string | null | undefined) => {
  if (!phone) return null;

  const trimmed = phone.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) {
    return `+91${digits}`;
  }
  if (/^91[6-9]\d{9}$/.test(digits)) {
    return `+${digits}`;
  }
  if (/^\+91[6-9]\d{9}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
};

const buildSmsMessage = (eventType: string, payload: any) => {
  switch (eventType) {
    case "patient_created":
      return `Welcome ${payload.patientName || ""}. Your patient profile is created.`;
    case "patient_updated":
      return `Hello ${payload.patientName || ""}. Your patient profile was updated.`;
    case "treatment_created":
      return `Treatment ${payload.treatmentTitle || ""} created. Total: INR ${payload.totalFee || ""}.`;
    case "visit_added":
      return `Visit recorded on ${payload.visitDate || ""} for ${payload.treatmentTitle || ""}.` +
        (payload.paymentAmount ? ` Payment: INR ${payload.paymentAmount}.` : "");
    case "prescription_uploaded":
      return `Prescription uploaded for ${payload.patientName || ""}.`;
    case "payment_added":
      return `Payment received INR ${payload.amount || ""} via ${payload.paymentMode || ""}.`;
    case "payment_updated":
      return `Payment updated. Old INR ${payload.oldAmount || ""}, New INR ${payload.newAmount || ""}.`;
    case "followup_created":
      return `Follow-up scheduled on ${payload.scheduledDate || ""}.`;
    case "payment_reminder":
      return `Payment reminder: balance INR ${payload.balance || ""} for ${payload.treatmentTitle || ""}.`;
    default:
      return "Notification from clinic.";
  }
};

const sendTwilioSms = async (to: string, body: string) => {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
  const auth = btoa(`${twilioSid}:${twilioToken}`);
  const form = new URLSearchParams({
    To: to,
    From: twilioPhone,
    Body: body,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Twilio ${data?.code || res.status}: ${data?.message || "SMS failed"}`);
  }

  return data;
};

Deno.serve(async (request) => {
  if (!supabaseUrl || !serviceKey || !twilioSid || !twilioToken || !twilioPhone) {
    return new Response("Missing SMS configuration", { status: 500 });
  }

  if (demoMode && !normalizeIndianPhoneForSms(demoTo)) {
    return new Response("Invalid demo recipient configuration", { status: 500 });
  }
  const body = await request.json().catch(() => ({}));
  // Demo only processes explicit new/test notifications, never a historical batch.
  if (demoMode && typeof body.notificationId !== "string") {
    return new Response("Demo mode requires a notificationId", { status: 400 });
  }
  let query = supabase
    .from("sms_notifications")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .limit(50);
  if (typeof body.notificationId === "string") {
    query = query.eq("id", body.notificationId);
  }
  const { data: notifications, error } = await query;

  if (error) {
    return new Response(error.message, { status: 500 });
  }

  for (const notification of notifications || []) {
    try {
      let recipient = demoMode ? demoTo : notification.payload?.phone;
      if (!recipient && notification.patient_id) {
        const { data: patient } = await supabase
          .from("patients")
          .select("phone")
          .eq("id", notification.patient_id)
          .single();
        recipient = patient?.phone;
      }

      recipient = normalizeIndianPhoneForSms(recipient);

      if (!recipient) {
        throw new Error("INVALID_RECIPIENT_PHONE");
      }

      const message = demoMode ? demoTemplate : buildSmsMessage(notification.event_type, notification.payload);
      const twilioRes = await sendTwilioSms(recipient, message);

      await supabase.from("sms_delivery_logs").insert({
        clinic_id: notification.clinic_id,
        notification_id: notification.id,
        recipient,
        message_preview: message.slice(0, 255),
        status: "sent",
        delivery_status: twilioRes.status,
        delivered_at: twilioRes.status === "delivered" ? new Date().toISOString() : null,
      });

      await supabase
        .from("sms_notifications")
        .update({ status: "sent", sent_at: new Date().toISOString(), error_message: null })
        .eq("id", notification.id);
    } catch (err) {
      const errorMessage = String(err?.message || err);
      const retryCount = (notification.retry_count || 0) + 1;
      const shouldRetry = errorMessage !== "INVALID_RECIPIENT_PHONE" && retryCount < 3;

      await supabase.from("sms_delivery_logs").insert({
        clinic_id: notification.clinic_id,
        notification_id: notification.id,
        recipient: demoMode ? demoTo : notification.payload?.phone || "unknown",
        message_preview: "SMS failed",
        status: "failed",
        error_details:
          errorMessage === "INVALID_RECIPIENT_PHONE"
            ? "Recipient phone not found or invalid"
            : errorMessage,
      });

      await supabase
        .from("sms_notifications")
        .update({
          status: shouldRetry ? "pending" : "failed",
          retry_count: retryCount,
          scheduled_at: shouldRetry
            ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
            : new Date().toISOString(),
          error_message:
            errorMessage === "INVALID_RECIPIENT_PHONE"
              ? "Recipient phone not found or invalid"
              : errorMessage,
        })
        .eq("id", notification.id);
    }
  }

  return new Response("OK", { status: 200 });
});
