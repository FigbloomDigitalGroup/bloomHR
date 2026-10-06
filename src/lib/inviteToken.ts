/** Pull the token out of a pasted invitation link, or accept the bare token. */
export function tokenFromInput(input: string): string {
  const text = input.trim();
  try {
    const t = new URL(text).searchParams.get('token');
    if (t) return t;
  } catch {
    /* not a URL: treat it as the token itself */
  }
  return text;
}
