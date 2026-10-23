# Connect the clinic owner's Twilio account

The SMS sender runs in Supabase `sms-processor`, not in Flutter. Changing only
Vercel environment variables will not update the sender.

1. Create the owner's Twilio account and complete email and phone verification.
2. Follow Twilio's SMS trial onboarding to obtain an SMS-capable sender and verify
   the intended test recipient. Trial restrictions apply; enable India in SMS
   Geographic Permissions if available for the account. A production clinic needs
   an upgraded account and the applicable destination/sender registrations.
3. In the Supabase project's Edge Functions secrets, set `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE` (sender in international format).
   Never put the Auth Token into Flutter, source control, or chat.
4. Deploy the updated function using `npx supabase functions deploy sms-processor
   --project-ref YOUR_PROJECT_REF` from the backend directory, with JWT verification
   enabled. Set secrets through the dashboard or a gitignored local env file.
5. Deploy the updated backend and rebuild/restart Flutter. The backend now waits
   for a targeted processor invocation for the new notification. New payment
   requests default to no SMS unless `sendSms: true`; multipart visits also accept
   the strings `true` and `false`.
6. Review the existing queue before enabling any scheduled batch processor:
   diagnosis found 23 pending historical notifications and no recorded errors.
   Do not replay historical notifications as a connection test. Explicitly decide
   whether to retain or cancel them before enabling scheduled delivery.
7. Record an authorized test payment to a verified test recipient with the toggle
   on. Check the Supabase function logs and Twilio Messaging logs for acceptance
   and actual delivery. Repeat with the toggle off and verify no payment SMS is
   queued. Saving a payment does not mean the SMS was delivered.

The payment toggle controls payment receipts/updates only; existing visit,
prescription, follow-up and reminder notifications retain their own behavior.

The bundled `Nirmaya/assets/images/upi_sample.png` contains non-payment demo text.
It cannot initiate a UPI payment. Replace the image and demo labels in
`payment_options.dart` with the verified clinic QR before real use. Displaying a
QR does not verify receipt of money; staff must confirm it before recording.

References:
- https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account
- https://www.twilio.com/docs/messaging/guides/sms-geo-permissions
- https://supabase.com/docs/guides/functions/secrets

## Trial demo mode

Set `TWILIO_DEMO_MODE=true` and `TWILIO_DEMO_TO` to the owner's verified
recipient in Supabase secrets. All SMS events are routed exclusively to that
number using `sms_appointment_reminders`, the template from the trial console.
No patient information or payment amounts are sent. Payment opt-in still applies.
Batch processing is disabled in demo mode; an explicit notification ID is required.
After upgrading, set `TWILIO_DEMO_MODE=false` to restore patient receipts and
review historical pending notifications before restarting batch delivery.
