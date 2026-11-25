import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface DocumentoSalvo {
  chave: string;
  sha256: string;
  tamanhoBytes: number;
}

/** Armazenamento de documentos pessoais. Fase 5 troca a implementação local pelo Cloudflare R2. */
export interface DocStore {
  salvar(prefixo: string, conteudo: Buffer): Promise<DocumentoSalvo>;
  ler(chave: string): Promise<Buffer>;
  apagar(chave: string): Promise<void>;
}

const CHAVE_VALIDA = /^[a-z0-9-]+\/[0-9a-f-]{36}\.bin$/;

/**
 * Disco local com AES-256-GCM. Formato do arquivo: iv(12) | tag(16) | ciphertext.
 * A chave de criptografia fica só no env, nunca junto dos arquivos.
 */
export function createLocalDocStore(dir: string, keyBase64: string): DocStore {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('Chave de documentos deve ter 32 bytes');
  const base = path.resolve(dir);

  const caminho = (chave: string) => {
    if (!CHAVE_VALIDA.test(chave)) throw new Error('Chave de documento inválida');
    return path.join(base, chave);
  };

  return {
    async salvar(prefixo, conteudo) {
      if (!/^[a-z0-9-]+$/.test(prefixo)) throw new Error('Prefixo inválido');
      const chave = `${prefixo}/${randomUUID()}.bin`;
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const cifrado = Buffer.concat([cipher.update(conteudo), cipher.final()]);
      const arquivo = caminho(chave);
      await mkdir(path.dirname(arquivo), { recursive: true });
      await writeFile(arquivo, Buffer.concat([iv, cipher.getAuthTag(), cifrado]), { mode: 0o600 });
      return {
        chave,
        sha256: createHash('sha256').update(conteudo).digest('hex'),
        tamanhoBytes: conteudo.length,
      };
    },

    async ler(chave) {
      const dados = await readFile(caminho(chave));
      const decipher = createDecipheriv('aes-256-gcm', key, dados.subarray(0, 12));
      decipher.setAuthTag(dados.subarray(12, 28));
      return Buffer.concat([decipher.update(dados.subarray(28)), decipher.final()]);
    },

    async apagar(chave) {
      await rm(caminho(chave), { force: true });
    },
  };
}
