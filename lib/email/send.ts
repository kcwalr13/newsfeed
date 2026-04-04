import nodemailer from 'nodemailer';

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
  const link = `${process.env.NEXTAUTH_URL}/api/auth/verify-email?token=${token}`;
  await sendEmail({
    to,
    subject: 'Verify your Daily Digest email address',
    html: `<p>Click <a href="${link}">here</a> to verify your email address. This link expires in 24 hours.</p><p>If you did not register for Daily Digest, you can ignore this email.</p>`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${process.env.NEXTAUTH_URL}/auth?reset_token=${token}`;
  await sendEmail({
    to,
    subject: 'Reset your Daily Digest password',
    html: `<p>Click <a href="${link}">here</a> to reset your password. This link expires in 1 hour.</p><p>If you did not request a password reset, you can ignore this email.</p>`,
  });
}
