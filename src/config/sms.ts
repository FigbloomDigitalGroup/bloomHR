// SMS settings the browser may know. The Celcom API key and partner ID are NOT here on purpose: anything
// prefixed VITE_ is inlined into the public bundle. Sending and balance checks go through the backend
// (sms_routes.js, via src/lib/smsApi.ts), which holds CELCOM_API_KEY / CELCOM_PARTNER_ID / CELCOM_SHORTCODE.
export const CELCOM_AFRICA_CONFIG = {
  // Sender ID shown in the UI and passed as a preference; the server validates it and falls back to its own.
  defaultShortcode: import.meta.env.VITE_CELCOM_SHORTCODE || '',
};
