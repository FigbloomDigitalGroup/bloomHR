// Celcom Africa SMS gateway config. Values come from env vars rather than being
// hardcoded so a single rotation/edit here covers every call site.
// Note: VITE_* vars are inlined into the client bundle at build time, so this key
// is still visible to anyone inspecting the built JS. The durable fix is to proxy
// SMS sends through the backend (see backend/sms_routes.js) instead of calling
// Celcom directly from the browser — tracked as follow-up work.
export const CELCOM_AFRICA_CONFIG = {
  baseUrl: 'https://isms.celcomafrica.com/api/services/sendsms',
  apiKey: import.meta.env.VITE_CELCOM_API_KEY || '',
  partnerID: import.meta.env.VITE_CELCOM_PARTNER_ID || '',
  defaultShortcode: import.meta.env.VITE_CELCOM_SHORTCODE || '',
};
