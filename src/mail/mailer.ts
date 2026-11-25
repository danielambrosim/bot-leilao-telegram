import nodemailer from 'nodemailer';
import type { Env } from '../config/env';

export interface Mailer {
  enviarCodigo(email: string, codigo: string): Promise<void>;
}

export function createMailer(env: Env): Mailer {
  if (!env.SMTP_HOST) {
    // Somente desenvolvimento (produção exige SMTP na validação do env)
    return {
      async enviarCodigo(email, codigo) {
        console.warn(`[mail:dev] SMTP não configurado. Código para ${email}: ${codigo}`);
      },
    };
  }
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return {
    async enviarCodigo(email, codigo) {
      await transporter.sendMail({
        from: env.MAIL_FROM,
        to: email,
        subject: `Seu código de verificação: ${codigo}`,
        text:
          `Seu código de verificação é ${codigo}.\n` +
          'Ele vale por 10 minutos. Se você não solicitou, ignore este e-mail.',
      });
    },
  };
}
