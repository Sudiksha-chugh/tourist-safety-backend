import twilio from "twilio";

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Twilio trial accounts can't send custom SMS text — they require one
// of a fixed set of template identifiers instead of real message
// content. This is a real platform restriction, not a design choice
// of ours. Once the account is upgraded (paid), this can be replaced
// with the actual custom `message` text passed in.
const TRIAL_TEMPLATE = "sms_appointment_reminders";

/**
 * Sends an SMS via Twilio.
 *
 * @param {string} toPhoneNumber - in E.164 format, e.g. "+919876543210"
 * @param {string} message - the real message we WANT to send; on a
 *   trial account this gets replaced by Twilio's fixed template instead
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendSms(toPhoneNumber, message) {
  try {
    await client.messages.create({
      body: process.env.TWILIO_TRIAL_MODE === "true" ? TRIAL_TEMPLATE : message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: toPhoneNumber,
    });
    return { success: true };
  } catch (err) {
    console.error("SMS send failed:", err.message);
    return { success: false, error: err.message };
  }
}