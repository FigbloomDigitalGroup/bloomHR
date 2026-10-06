// "Welcome" the first time someone signs in on this browser, "Welcome back" after that.
const key = (userId: string) => `welcomed_${userId}`;

export function welcomeMessage(userId: string | undefined, email: string): string {
  if (!userId) return `Welcome back, ${email}!`;
  try {
    if (localStorage.getItem(key(userId))) return `Welcome back, ${email}!`;
    localStorage.setItem(key(userId), '1');
    return `Welcome to Figbloom HR, ${email}!`;
  } catch {
    return `Welcome back, ${email}!`; // storage unavailable: the safe wording
  }
}
