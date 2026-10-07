import { supabase } from '../lib/supabase';

// Client for the backend AI API (ai_routes.js). The model API key lives on the server; the browser authenticates
// with the caller's own session token, and the server checks the caller may use this feature.
const API_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : 'http://localhost:3001/api');

interface AIResponse {
  response: string;
  metadata?: any;
}

/** Which feature is asking. The server ties each purpose to a permission and a fixed instruction for the model. */
export type AIPurpose = 'hr-assistant' | 'warning' | 'meeting-summary';

export const queryAI = async (
  prompt: string,
  context: string,
  purpose: AIPurpose = 'hr-assistant'
): Promise<AIResponse> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You are not signed in');

  let response: Response;
  try {
    response = await fetch(`${API_URL}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ purpose, prompt, context }),
    });
  } catch {
    throw new Error('Could not reach the server. Is the backend running?');
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `AI request failed (${response.status})`);
  return payload as AIResponse;
};
