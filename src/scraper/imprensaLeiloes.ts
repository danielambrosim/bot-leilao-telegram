import * as cheerio from 'cheerio';
import type { NovaPublicacao, PublicacaoRepo } from '../publicacoes/repo';

/**
 * Coleta do Jornal Imprensa Leilões (https://imprensaleiloes.com.br).
 * robots.txt (nov/2026): "Allow: /". Coleta educada: poucas requisições, intervalo entre elas,
 * User-Agent identificado e só metadados (título, resumo, link) — o conteúdo fica no site do jornal.
 */
export const FONTE = 'imprensa-leiloes';
export const BASE_URL = 'https://imprensaleiloes.com.br';
export const USER_AGENT = 'SBL-Habilitacao/2.0 (+coleta de metadados; 1 req/s)';

export interface ItemNoticia {
  url: string;
  titulo: string;
  resumo: string | null;
}

const limpar = (s: string) => s.replace(/\s+/g, ' ').trim();

function urlInterna(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    return u.origin === new URL(base).origin && u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Página inicial: cartões de destaque (a.dh-card) e demais links /noticias/<slug>. */
export function parseHome(html: string, base = BASE_URL): ItemNoticia[] {
  const $ = cheerio.load(html);
  const itens = new Map<string, ItemNoticia>();

  $('a.dh-card').each((_, el) => {
    const url = urlInterna($(el).attr('href'), base);
    const titulo = limpar($(el).find('h3').first().text());
    if (!url || !titulo || !new URL(url).pathname.startsWith('/noticias/')) return;
    const resumo = limpar($(el).find('.resumo').first().text()) || null;
    itens.set(url, { url, titulo, resumo });
  });

  $('a[href^="/noticias/"]').each((_, el) => {
    const url = urlInterna($(el).attr('href'), base);
    if (!url || itens.has(url)) return;
    const titulo = limpar($(el).find('h2, h3, h4').first().text() || $(el).attr('title') || $(el).text());
    if (titulo.length >= 10) itens.set(url, { url, titulo, resumo: null });
  });

  return [...itens.values()];
}

/** Página da notícia: título (h1.titulo) e data (time[datetime]). */
export function parseArtigo(html: string): { titulo: string | null; publicadoEm: Date | null } {
  const $ = cheerio.load(html);
  const titulo = limpar($('h1.titulo').first().text() || $('h1').first().text()) || null;
  const dt = $('time[datetime]').first().attr('datetime');
  const data = dt ? new Date(dt.length === 19 ? `${dt}-03:00` : dt) : null; // site publica em horário de Brasília
  return { titulo, publicadoEm: data && !Number.isNaN(data.getTime()) ? data : null };
}

/** Página /edicoes: PDFs das edições do jornal (onde saem os editais publicados). */
export function parseEdicoes(html: string, base = BASE_URL): Array<{ url: string; titulo: string }> {
  const $ = cheerio.load(html);
  const out: Array<{ url: string; titulo: string }> = [];
  $('.edicoes a[href$=".pdf"]').each((_, el) => {
    const url = urlInterna($(el).attr('href'), base);
    const titulo = limpar($(el).text());
    if (url && titulo) out.push({ url, titulo: `Edição ${titulo}` });
  });
  return out;
}

export type Fetcher = (url: string) => Promise<string>;

export function createFetcher(timeoutMs = 15_000): Fetcher {
  return async (url) => {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    const tamanho = Number(res.headers.get('content-length') ?? 0);
    if (tamanho > 3_000_000) throw new Error(`Resposta grande demais em ${url}`);
    return res.text();
  };
}

export interface OpcoesColeta {
  fetcher?: Fetcher;
  intervaloMs?: number;
  maxArtigos?: number;
}

/** Coleta notícias + edições e grava só as novas. Busca a data apenas de artigos ainda não vistos. */
export async function coletarImprensaLeiloes(repo: PublicacaoRepo, opcoes: OpcoesColeta = {}) {
  const fetcher = opcoes.fetcher ?? createFetcher();
  const intervalo = opcoes.intervaloMs ?? 1_000;
  const espera = () => new Promise((r) => setTimeout(r, intervalo));

  const home = parseHome(await fetcher(`${BASE_URL}/`));
  const conhecidas = new Set((await repo.ultimas(FONTE, 'noticia', 200)).map((p) => p.url));
  const novas = home.filter((n) => !conhecidas.has(n.url)).slice(0, opcoes.maxArtigos ?? 20);

  const publicacoes: NovaPublicacao[] = [];
  const erros: string[] = [];
  for (const n of novas) {
    await espera();
    try {
      const artigo = parseArtigo(await fetcher(n.url));
      publicacoes.push({ fonte: FONTE, tipo: 'noticia', titulo: artigo.titulo ?? n.titulo, resumo: n.resumo, url: n.url, publicadoEm: artigo.publicadoEm });
    } catch (err) {
      erros.push((err as Error).message);
      publicacoes.push({ fonte: FONTE, tipo: 'noticia', titulo: n.titulo, resumo: n.resumo, url: n.url });
    }
  }

  await espera();
  for (const e of parseEdicoes(await fetcher(`${BASE_URL}/edicoes`))) {
    publicacoes.push({ fonte: FONTE, tipo: 'edicao', titulo: e.titulo, url: e.url });
  }

  const inseridas = await repo.inserirNovas(publicacoes);
  return { encontradas: home.length, inseridas, erros };
}
