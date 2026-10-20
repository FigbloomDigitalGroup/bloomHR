import { supabase } from '../lib/supabase';
import type { PayItemKind, TaxTreatment } from '../lib/kenyaTaxTreatment';
import type { SetupProposal } from '../lib/setupAssistant';

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

/** An earlier turn of the conversation, so follow-up questions make sense. */
export interface AIHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** POSTs to the AI API as the signed-in user; returns the JSON answer, or throws the server's error message. */
const post = async <T>(path: string, body: unknown): Promise<T> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You are not signed in');

  let response: Response;
  try {
    response = await fetch(`${API_URL}/ai/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Is the backend running?');
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `AI request failed (${response.status})`);
  return payload as T;
};

export const queryAI = (
  prompt: string,
  context: string,
  purpose: AIPurpose = 'hr-assistant',
  history: AIHistoryMessage[] = []
): Promise<AIResponse> => post<AIResponse>('chat', { purpose, prompt, context, history });

/** The AI's suggestion of how a pay item is treated for Kenyan PAYE (ai_routes.js, feature "tax_treatment"). */
export interface AITaxSuggestion {
  treatment: TaxTreatment;
  explanation: string;
  legal_basis: string;
  confidence: 'high' | 'medium' | 'low';
  caveats: string[];
  /** whether the employer can go ahead with it, and why (left out when the AI gave no valid answer) */
  go_ahead?: 'yes' | 'with_conditions' | 'no';
  go_ahead_reason?: string;
}

/** One turn of the set-up chat; the AI's own turns are sent back as the JSON it gave, with each proposal's status. */
export interface AISetupMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** The set-up chat's answer: what to say, and changes the person may apply (src/lib/setupAssistant.ts applies them). */
export interface AISetupAnswer {
  reply: string;
  proposals: SetupProposal[];
}

export const askSetup = (messages: AISetupMessage[], company: unknown): Promise<AISetupAnswer> =>
  post<AISetupAnswer>('setup', { messages, company });

/** A suggestion only: show it labelled as one, and never apply it without the user confirming. */
export const askTaxTreatment = (kind: PayItemKind, name: string, description?: string): Promise<AITaxSuggestion> =>
  post<AITaxSuggestion>('tax-treatment', { kind, name, ...(description ? { description } : {}) });
