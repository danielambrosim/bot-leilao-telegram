import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface DocumentoSalvo {
  chave: string;
  sha256: string;
  tamanhoBytes: number;
}

/** Armazenamento de documentos pessoais. Sempre cifrado no cliente (AES-256-GCM) antes de sair do processo. */
export interface DocStore {
  salvar(prefixo: string, conteudo: Buffer): Promise<DocumentoSalvo>;
  ler(chave: string): Promise<Buffer>;
  apagar(chave: string): Promise<void>;
}

const CHAVE_VALIDA = /^[a-z0-9-]+\/[0-9a-f-]{36}\.bin$/;
const PREFIXO_VALIDO = /^[a-z0-9-]+$/;

function validarChave(chave: string) {
  if (!CHAVE_VALIDA.test(chave)) throw new Error('Chave de documento inválida');
}

function novaChave(prefixo: string) {
  if (!PREFIXO_VALIDO.test(prefixo)) throw new Error('Prefixo inválido');
  return `${prefixo}/${randomUUID()}.bin`;
}

function chaveCripto(keyBase64: string) {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('Chave de documentos deve ter 32 bytes');
  return key;
}

/** Formato: iv(12) | tag(16) | ciphertext */
function cifrar(key: Buffer, conteudo: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const cifrado = Buffer.concat([cipher.update(conteudo), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), cifrado]);
}

function decifrar(key: Buffer, dados: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, dados.subarray(0, 12));
  decipher.setAuthTag(dados.subarray(12, 28));
  return Buffer.concat([decipher.update(dados.subarray(28)), decipher.final()]);
}

const metadados = (conteudo: Buffer) => ({
  sha256: createHash('sha256').update(conteudo).digest('hex'),
  tamanhoBytes: conteudo.length,
});

/** Disco local (desenvolvimento / VPS com volume). */
export function createLocalDocStore(dir: string, keyBase64: string): DocStore {
  const key = chaveCripto(keyBase64);
  const base = path.resolve(dir);
  const caminho = (chave: string) => (validarChave(chave), path.join(base, chave));

  return {
    async salvar(prefixo, conteudo) {
      const chave = novaChave(prefixo);
      const arquivo = caminho(chave);
      await mkdir(path.dirname(arquivo), { recursive: true });
      await writeFile(arquivo, cifrar(key, conteudo), { mode: 0o600 });
      return { chave, ...metadados(conteudo) };
    },
    async ler(chave) {
      return decifrar(key, await readFile(caminho(chave)));
    },
    async apagar(chave) {
      await rm(caminho(chave), { force: true });
    },
  };
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

/**
 * Bucket S3-compatível (Cloudflare R2, Supabase Storage, Backblaze B2, MinIO).
 * Necessário em hospedagem sem disco persistente (ex.: Render grátis).
 * O provedor só recebe o arquivo já cifrado; a chave fica no env do app.
 */
export function createS3DocStore(cfg: S3Config, keyBase64: string): DocStore {
  const key = chaveCripto(keyBase64);
  const s3 = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle ?? true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });

  return {
    async salvar(prefixo, conteudo) {
      const chave = novaChave(prefixo);
      await s3.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: chave,
          Body: cifrar(key, conteudo),
          ContentType: 'application/octet-stream',
        }),
      );
      return { chave, ...metadados(conteudo) };
    },
    async ler(chave) {
      validarChave(chave);
      const r = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: chave }));
      if (!r.Body) throw new Error('Documento vazio no storage');
      return decifrar(key, Buffer.from(await r.Body.transformToByteArray()));
    },
    async apagar(chave) {
      validarChave(chave);
      await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: chave }));
    },
  };
}
