import nodemailer from "nodemailer";

export interface SMTPConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

/** Create transporter with provided config (for database-stored credentials) */
function createTransporter(config: SMTPConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
  });
}

/** Send email with provided SMTP config */
export async function sendEmailWithConfig(
  config: SMTPConfig,
  options: EmailOptions,
): Promise<void> {
  const transporter = createTransporter(config);
  await transporter.sendMail({
    from: config.user,
    ...options,
  });
}

// Fallback for env-based config (legacy)
let envTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;

export function getEmailTransporter() {
  if (envTransporter) return envTransporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "Email configuration incomplete: SMTP_HOST, SMTP_USER, SMTP_PASS required",
    );
  }

  envTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return envTransporter;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  const transporter = getEmailTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    ...options,
  });
}
