const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_EMAIL = 254;

export function isWaitlistEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  return email.length > 0 && email.length <= MAX_EMAIL && EMAIL.test(email);
}
