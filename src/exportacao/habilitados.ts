import type { Pool } from 'pg';
import type { StatusHabilitacao } from '../arrematantes/repo';

/**
 * Exportação de habilitados para importar na plataforma do leiloeiro.
 * LAYOUT PROVISÓRIO: colunas espelham os filtros da tela "Arrematantes" da Colodete.
 * Ajustar ordem/nomes quando recebermos o modelo de importação oficial.
 */
export const COLUNAS = [
  'ID',
  'Nome',
  'Pessoa',
  'CPF/CNPJ',
  'RG/IE',
  'E-mail',
  'Celular',
  'CEP',
  'Logradouro',
  'Número',
  'Complemento',
  'Bairro',
  'Cidade',
  'UF',
  'Status',
  'Criado em',
  'Concluído em',
] as const;

export interface LinhaExportacao {
  id: number;
  nome: string;
  cpf: string;
  cnpj: string | null;
  rg_ie: string | null;
  email: string;
  celular: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  status: StatusHabilitacao;
  consentido_em: Date;
  decidido_em: Date | null;
}

const fmtCpf = (c: string) => c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtCel = (c: string | null) => (c ? c.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : '');
const fmtCep = (c: string | null) => (c ? `${c.slice(0, 5)}-${c.slice(5)}` : '');
const fmtData = (d: Date | null) =>
  d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '';
const STATUS: Record<StatusHabilitacao, string> = { pendente: 'Pendente', aprovado: 'Aprovado', recusado: 'Recusado', revogado: 'Revogado' };

/**
 * Célula segura para Excel/LibreOffice: neutraliza fórmulas (CSV injection: = + - @ tab CR)
 * e escapa aspas/separador.
 */
export function celula(valor: string): string {
  let v = valor.replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[;"']/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Caminhos dos documentos dentro do ZIP, por id do arrematante (colunas extras no CSV do pacote). */
export type ArquivosPorArrematante = Map<number, { identidade?: string; comprovante?: string }>;

/** CSV no padrão do Excel brasileiro: separador ';', BOM UTF-8, CRLF. */
export function gerarCsv(linhas: LinhaExportacao[], arquivos?: ArquivosPorArrematante): string {
  const cabecalho = arquivos ? [...COLUNAS, 'Arquivo documento', 'Arquivo comprovante'] : [...COLUNAS];
  const corpo = linhas.map((l) =>
    [
      String(l.id),
      l.nome,
      l.cnpj ? 'Jurídica' : 'Física',
      l.cnpj ? fmtCnpj(l.cnpj) : fmtCpf(l.cpf),
      l.rg_ie ?? '',
      l.email,
      fmtCel(l.celular),
      fmtCep(l.cep),
      l.logradouro ?? '',
      l.numero ?? '',
      l.complemento ?? '',
      l.bairro ?? '',
      l.cidade ?? '',
      l.uf ?? '',
      STATUS[l.status],
      fmtData(l.consentido_em),
      fmtData(l.decidido_em),
      ...(arquivos ? [arquivos.get(l.id)?.identidade ?? '', arquivos.get(l.id)?.comprovante ?? ''] : []),
    ]
      .map(celula)
      .join(';'),
  );
  return '﻿' + [cabecalho.join(';'), ...corpo].join('\r\n') + '\r\n';
}

export async function buscarHabilitados(
  pool: Pool,
  leiloeiroSlug: string,
  status: StatusHabilitacao | 'todos',
): Promise<{ leiloeiroId: number; linhas: LinhaExportacao[] }> {
  const { rows: lei } = await pool.query<{ id: number }>('SELECT id::int AS id FROM leiloeiros WHERE slug = $1', [leiloeiroSlug]);
  if (!lei[0]) throw new Error(`Leiloeiro "${leiloeiroSlug}" não encontrado`);
  const { rows } = await pool.query<LinhaExportacao>(
    `SELECT a.id::int AS id, a.nome, a.cpf, a.cnpj, a.rg_ie, a.email, a.celular, a.cep, a.logradouro, a.numero,
            a.complemento, a.bairro, a.cidade, a.uf, h.status, h.consentido_em, h.decidido_em
       FROM habilitacoes h JOIN arrematantes a ON a.id = h.arrematante_id
      WHERE h.leiloeiro_id = $1 AND ($2 = 'todos' OR h.status = $2)
      ORDER BY h.consentido_em DESC`,
    [lei[0].id, status],
  );
  return { leiloeiroId: lei[0].id, linhas: rows };
}
