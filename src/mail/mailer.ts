import nodemailer from 'nodemailer';
import type { Env } from '../config/env';

export interface Mailer {
  enviarCodigo(email: string, codigo: string): Promise<void>;
}

type Fetch = typeof fetch;

const assunto = (codigo: string) => `Seu código de verificação: ${codigo}`;
const corpo = (codigo: string) =>
  `Seu código de verificação é ${codigo}.\n` + 'Ele vale por 10 minutos. Se você não solicitou, ignore este e-mail.';

/**
 * Resend pela API HTTPS (porta 443). Necessário em hosts que bloqueiam SMTP de saída
 * (ex.: Render grátis bloqueia 25/465/587 — a conexão SMTP fica pendurada até o timeout).
 */
export function createResendApiMailer(apiKey: string, from: string, fetcher: Fetch = fetch): Mailer {
  return {
    async enviarCodigo(email, codigo) {
      const res = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [email], subject: assunto(codigo), text: corpo(codigo) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        // Ex.: 403 "You can only send testing emails to your own email address" (domínio não verificado)
        const detalhe = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`Resend API HTTP ${res.status}: ${detalhe}`);
      }
    },
  };
}

export function createMailer(env: Env): Mailer {
  // API do Resend: chave explícita, ou a mesma chave usada no SMTP do Resend (SMTP_PASS)
  const resendKey = env.RESEND_API_KEY ?? (env.SMTP_HOST === 'smtp.resend.com' ? env.SMTP_PASS : undefined);
  if (resendKey && env.MAIL_FROM) return createResendApiMailer(resendKey, env.MAIL_FROM);

  if (!env.SMTP_HOST) {
    // Somente desenvolvimento (produção exige e-mail configurado na validação do env)
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
    // Falhar rápido: o arrematante não pode esperar minutos por uma porta bloqueada
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return {
    async enviarCodigo(email, codigo) {
      await transporter.sendMail({ from: env.MAIL_FROM, to: email, subject: assunto(codigo), text: corpo(codigo) });
    },
  };
}
