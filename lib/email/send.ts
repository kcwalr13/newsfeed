import nodemailer from 'nodemailer';

/**
 * Returns the validated application origin for building email links (SEC-M1).
 *
 * Email links must never be built from an unvalidated env value — if
 * NEXTAUTH_URL drifts or is attacker-influenced, verification/reset links would
 * point at a phishing host. We parse it to a bare origin and require:
 *   - a well-formed absolute URL,
 *   - an https scheme (http allowed only for localhost in development),
 *   - membership in ALLOWED_BASE_URLS when that allowlist env is set.
 * Throws on any violation so a misconfiguration sends NO email rather than a
 * dangerous link.
 */
function getValidatedBaseUrl(): string {
  const raw = process.env.NEXTAUTH_URL;
  if (!raw) throw new Error('NEXTAUTH_URL is not set');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`NEXTAUTH_URL is not a valid absolute URL: ${raw}`);
  }

  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
    throw new Error(`NEXTAUTH_URL must use https (got ${url.protocol})`);
  }

  const allowlist = (process.env.ALLOWED_BASE_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlist.length > 0 && !allowlist.includes(url.origin)) {
    throw new Error(`NEXTAUTH_URL origin ${url.origin} is not in ALLOWED_BASE_URLS`);
  }

  return url.origin;
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const link = `${getValidatedBaseUrl()}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to,
    subject: 'Verify your Tangent email address',
    html: `<p>Click <a href="${link}">here</a> to verify your email address. This link expires in 24 hours.</p><p>If you did not register for Tangent, you can ignore this email.</p>`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${getValidatedBaseUrl()}/auth?reset_token=${encodeURIComponent(token)}`;
  await sendEmail({
    to,
    subject: 'Reset your Tangent password',
    html: `<p>Click <a href="${link}">here</a> to reset your password. This link expires in 1 hour.</p><p>If you did not request a password reset, you can ignore this email.</p>`,
  });
}
