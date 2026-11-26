import { Readable } from 'node:stream';
import yazl from 'yazl';
import type { Pool } from 'pg';
import type { DocStore } from '../docs/store';
import type { StatusHabilitacao, TipoDocumento } from '../arrematantes/repo';
import { buscarHabilitados, gerarCsv, type ArquivosPorArrematante } from './habilitados';

export const LIMITE_PACOTE = 300;

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const NOME_ARQ: Record<TipoDocumento, 'documento' | 'comprovante'> = {
  identidade: 'documento',
  comprovante_residencia: 'comprovante',
};

/** "Maria José da Silva" -> "maria-jose-da-silva" (nome de pasta seguro em qualquer sistema) */
export function slugNome(nome: string): string {
  return (
    nome
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'arrematante'
  );
}

/** Stream que só busca/decifra o documento quando o ZIP chega nele: memória de um arquivo por vez. */
function leituraTardia(carregar: () => Promise<Buffer>): Readable {
  let iniciado = false;
  return new Readable({
    read() {
      if (iniciado) return;
      iniciado = true;
      carregar()
        .then((buf) => {
          this.push(buf);
          this.push(null);
        })
        .catch((err) => {
          // Um documento indisponível não pode corromper o pacote inteiro
          console.error('[pacote] documento indisponível:', (err as Error).message);
          this.push(Buffer.from('Documento indisponível no momento da exportação. Abra-o pelo painel.'));
          this.push(null);
        });
    },
  });
}

export class PacoteGrandeDemaisError extends Error {}

/**
 * Pacote para a plataforma do leiloeiro: habilitados.csv + documentos/<id>-<nome>/documento.ext|comprovante.ext.
 * Os documentos são decifrados só durante a geração e saem pela conexão HTTPS do painel.
 */
export async function montarPacoteZip(pool: Pool, docs: DocStore, slug: string, status: StatusHabilitacao | 'todos') {
  const { leiloeiroId, linhas } = await buscarHabilitados(pool, slug, status);
  if (linhas.length > LIMITE_PACOTE) {
    throw new PacoteGrandeDemaisError(`Mais de ${LIMITE_PACOTE} cadastros; filtre por status.`);
  }

  const ids = linhas.map((l) => l.id);
  const { rows: documentos } = await pool.query<{ arrematante_id: number; tipo: TipoDocumento; r2_key: string; mime: string }>(
    `SELECT DISTINCT ON (arrematante_id, tipo) arrematante_id::int AS arrematante_id, tipo, r2_key, mime
       FROM documentos WHERE arrematante_id = ANY($1::bigint[])
      ORDER BY arrematante_id, tipo, criado_em DESC`,
    [ids],
  );

  const zip = new yazl.ZipFile();
  const arquivos: ArquivosPorArrematante = new Map();
  const nomes = new Map(linhas.map((l) => [l.id, `${l.id}-${slugNome(l.nome)}`]));

  for (const d of documentos) {
    const caminho = `documentos/${nomes.get(d.arrematante_id)}/${NOME_ARQ[d.tipo]}.${EXT[d.mime] ?? 'bin'}`;
    const atual = arquivos.get(d.arrematante_id) ?? {};
    if (d.tipo === 'identidade') atual.identidade = caminho;
    else atual.comprovante = caminho;
    arquivos.set(d.arrematante_id, atual);
    zip.addReadStream(leituraTardia(() => docs.ler(d.r2_key)), caminho, { compress: d.mime !== 'application/pdf' && d.mime !== 'image/jpeg' });
  }

  zip.addBuffer(Buffer.from(gerarCsv(linhas, arquivos), 'utf8'), 'habilitados.csv');
  zip.addBuffer(
    Buffer.from(
      'Pacote de habilitados gerado pelo painel.\r\n' +
        '- habilitados.csv: dados (abre no Excel; colunas "Arquivo documento/comprovante" apontam para a pasta documentos).\r\n' +
        '- documentos/: documento com foto e comprovante de residência de cada arrematante.\r\n\r\n' +
        'ATENÇÃO: contém dados pessoais e documentos (LGPD). Guarde em local restrito e apague após importar.\r\n',
      'utf8',
    ),
    'LEIA-ME.txt',
  );
  zip.end();

  return { leiloeiroId, quantidade: linhas.length, documentos: documentos.length, stream: zip.outputStream };
}
