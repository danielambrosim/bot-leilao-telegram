import express, { Router, type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { rateLimit } from 'express-rate-limit';
import type { Api } from 'grammy';
import type { DocStore } from '../docs/store';
import type { StatusHabilitacao, TipoDocumento } from '../arrematantes/repo';
import { gerarCsv, buscarHabilitados } from '../exportacao/habilitados';
import type { Pool } from 'pg';
import { SESSAO_HORAS, type AuthPainel, type Operador } from './auth';
import type { Decisao, PainelRepo } from './repo';

export const PAINEL_PATH = '/painel';
const COOKIE = 'sbl_sessao';
const STATUS: Array<StatusHabilitacao | 'todos'> = ['pendente', 'aprovado', 'recusado', 'revogado', 'todos'];
const DECISOES: Decisao[] = ['aprovado', 'recusado', 'revogado'];
const TIPOS: TipoDocumento[] = ['identidade', 'comprovante_residencia'];

export interface PainelDeps {
  pool: Pool;
  auth: AuthPainel;
  repo: PainelRepo;
  docs: DocStore;
  /** API do Telegram para avisar o arrematante da decisão */
  telegram?: Pick<Api, 'sendMessage'>;
  producao: boolean;
  /** Pasta com index.html/app.js/app.css */
  webDir?: string;
}

type ReqOp = Request & { operador?: Operador };

function lerCookie(req: Request, nome: string): string | undefined {
  for (const parte of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function mensagemDecisao(decisao: Decisao, leiloeiro: string, motivo: string | null): string {
  if (decisao === 'aprovado') return `✅ Sua habilitação com ${leiloeiro} foi APROVADA. Você já pode participar dos leilões.`;
  if (decisao === 'recusado') {
    return `❌ Sua habilitação com ${leiloeiro} foi recusada.\nMotivo: ${motivo}\n\nCorrija e solicite novamente com o leiloeiro.`;
  }
  return `🚫 Sua habilitação com ${leiloeiro} foi revogada.\nMotivo: ${motivo}`;
}

export function createPainelRouter(deps: PainelDeps): Router {
  const r = Router();
  const webDir = deps.webDir ?? path.resolve(process.cwd(), 'painel-web');

  // CSP estrita só no painel: nada de script/estilo de fora, nada inline
  r.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' blob: data:; object-src 'self' blob:; frame-src 'self' blob:; " +
        "style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  r.use('/static', express.static(webDir, { index: false, fallthrough: false, maxAge: 0 }));
  r.get('/', (_req, res) => res.sendFile(path.join(webDir, 'index.html')));

  const api = Router();
  api.use(express.json({ limit: '20kb' }));

  // CSRF: cookie SameSite=Strict + header customizado obrigatório em qualquer escrita
  api.use((req, res, next) => {
    if (req.method !== 'GET' && req.get('x-sbl-painel') !== '1') {
      res.status(403).json({ erro: 'requisicao_invalida' });
      return;
    }
    next();
  });

  api.post(
    '/login',
    rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }),
    async (req, res) => {
      const { email, senha } = req.body ?? {};
      if (typeof email !== 'string' || typeof senha !== 'string' || email.length > 254 || senha.length > 200) {
        res.status(400).json({ erro: 'dados_invalidos' });
        return;
      }
      const r1 = await deps.auth.login(email, senha, req.ip);
      if (!r1.ok) {
        res.status(r1.motivo === 'bloqueado' ? 429 : 401).json({ erro: r1.motivo });
        return;
      }
      res.cookie(COOKIE, r1.token, {
        httpOnly: true,
        secure: deps.producao,
        sameSite: 'strict',
        path: PAINEL_PATH,
        maxAge: SESSAO_HORAS * 3_600_000,
      });
      res.json({ operador: r1.operador });
    },
  );

  const exigirLogin = async (req: ReqOp, res: Response, next: NextFunction) => {
    const op = await deps.auth.operadorDaSessao(lerCookie(req, COOKIE));
    if (!op) {
      res.status(401).json({ erro: 'nao_autenticado' });
      return;
    }
    req.operador = op;
    next();
  };

  api.post('/logout', async (req, res) => {
    await deps.auth.logout(lerCookie(req, COOKIE));
    res.clearCookie(COOKIE, { path: PAINEL_PATH });
    res.json({ ok: true });
  });

  api.get('/me', exigirLogin, async (req: ReqOp, res) => {
    res.json({ operador: req.operador, contagem: await deps.repo.contagem(req.operador!.leiloeiro_id) });
  });

  api.get('/habilitacoes', exigirLogin, async (req: ReqOp, res) => {
    const status = STATUS.includes(req.query.status as never) ? (req.query.status as StatusHabilitacao) : 'pendente';
    const busca = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({
      itens: await deps.repo.fila(req.operador!.leiloeiro_id, status, busca),
      contagem: await deps.repo.contagem(req.operador!.leiloeiro_id),
    });
  });

  api.get('/habilitacoes/:id', exigirLogin, async (req: ReqOp, res) => {
    const id = Number(req.params.id);
    const ficha = Number.isInteger(id) ? await deps.repo.ficha(req.operador!.leiloeiro_id, id) : null;
    if (!ficha) {
      res.status(404).json({ erro: 'nao_encontrado' });
      return;
    }
    await deps.auth.auditar(req.operador!.id, req.operador!.leiloeiro_id, 'painel.ficha_visualizada', { habilitacao: id });
    res.json(ficha);
  });

  api.get('/habilitacoes/:id/documentos/:tipo', exigirLogin, async (req: ReqOp, res) => {
    const id = Number(req.params.id);
    const tipo = req.params.tipo as TipoDocumento;
    if (!Number.isInteger(id) || !TIPOS.includes(tipo)) {
      res.status(404).end();
      return;
    }
    const doc = await deps.repo.documento(req.operador!.leiloeiro_id, id, tipo);
    if (!doc) {
      res.status(404).end();
      return;
    }
    const conteudo = await deps.docs.ler(doc.r2_key);
    await deps.auth.auditar(req.operador!.id, req.operador!.leiloeiro_id, 'painel.documento_aberto', { habilitacao: id, tipo });
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Content-Disposition', `inline; filename="${tipo}-${id}.${doc.mime === 'application/pdf' ? 'pdf' : 'jpg'}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(conteudo);
  });

  api.post('/habilitacoes/:id/decisao', exigirLogin, async (req: ReqOp, res) => {
    const id = Number(req.params.id);
    const { decisao, motivo } = req.body ?? {};
    const motivoLimpo = typeof motivo === 'string' ? motivo.trim().slice(0, 500) : '';
    if (!Number.isInteger(id) || !DECISOES.includes(decisao)) {
      res.status(400).json({ erro: 'decisao_invalida' });
      return;
    }
    if (decisao !== 'aprovado' && motivoLimpo.length < 10) {
      res.status(400).json({ erro: 'motivo_obrigatorio' });
      return;
    }
    const op = req.operador!;
    const r2 = await deps.repo.decidir(op.leiloeiro_id, id, op.id, decisao, decisao === 'aprovado' ? null : motivoLimpo);
    if (!r2) {
      res.status(409).json({ erro: 'status_mudou_ou_nao_encontrado' });
      return;
    }
    let avisado = false;
    try {
      await deps.telegram?.sendMessage(r2.chatId, mensagemDecisao(decisao, r2.leiloeiro, motivoLimpo || null));
      avisado = !!deps.telegram;
    } catch (e) {
      console.error('[painel] falha ao avisar arrematante:', (e as Error).message);
    }
    res.json({ ok: true, avisado });
  });

  api.get('/exportar', exigirLogin, async (req: ReqOp, res) => {
    const status = STATUS.includes(req.query.status as never) ? (req.query.status as StatusHabilitacao) : 'aprovado';
    const op = req.operador!;
    const { linhas } = await buscarHabilitados(deps.pool, op.leiloeiro_slug, status);
    await deps.auth.auditar(op.id, op.leiloeiro_id, 'exportacao.habilitados', { status, quantidade: linhas.length, via: 'painel' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${op.leiloeiro_slug}-${status}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(gerarCsv(linhas));
  });

  api.use((_req, res) => {
    res.status(404).json({ erro: 'nao_encontrado' });
  });

  r.use('/api', api);
  return r;
}
