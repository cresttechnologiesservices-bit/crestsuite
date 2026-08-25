import nodemailer from "nodemailer";
import env from "../config";

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth:
    env.SMTP_USER && env.SMTP_PASS
      ? {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      }
      : undefined,
});

export async function sendOtpEmail(to: string, code: string) {
  await transport.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: "Your ClockIT sign-in code",
    text: `Your one-time code is: ${code}. It expires in 10 minutes.`,
  });
}

export async function sendInviteEmail(to: string, token: string) {
  await transport.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: "You've been invited to join ClockIT",
    text: `You've been invited to join the workspace. Accept the invitation here: ${env.APP_URL}/clockit/login?invite=${token}`,
  });
}