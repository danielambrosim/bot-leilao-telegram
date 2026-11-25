const SLUG = /^[a-z0-9_-]{3,40}$/;

/**
 * Extrai o slug do leiloeiro do deep link t.me/Bot?start=<slug>.
 * Retorna null para payload ausente ou inválido (nunca confiar no que vem do cliente).
 */
export function parseStartPayload(payload: string | undefined | null): string | null {
  if (!payload) return null;
  const slug = payload.trim().toLowerCase();
  return SLUG.test(slug) ? slug : null;
}

/** Escapa texto para parse_mode HTML do Telegram (evita injeção de formatação). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
