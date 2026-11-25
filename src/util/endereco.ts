export const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

export interface EnderecoCep {
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
}

export type BuscarCep = (cep: string) => Promise<EnderecoCep | null>;

/**
 * Consulta ViaCEP (serviço público gratuito). Só o CEP é enviado.
 * Falha/timeout retorna null e o bot pede o endereço manualmente.
 */
export function createViaCep(timeoutMs = 5_000): BuscarCep {
  return async (cep) => {
    if (!/^\d{8}$/.test(cep)) return null;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;
      const j = (await res.json()) as Record<string, string | boolean>;
      if (j.erro || typeof j.localidade !== 'string' || !UFS.has(String(j.uf))) return null;
      return {
        logradouro: String(j.logradouro ?? '').trim(),
        bairro: String(j.bairro ?? '').trim(),
        cidade: j.localidade.trim(),
        uf: String(j.uf),
      };
    } catch {
      return null;
    }
  };
}

/** "Vitória/ES", "Vila Velha - es" -> { cidade, uf } */
export function parseCidadeUf(texto: string): { cidade: string; uf: string } | null {
  const m = texto.trim().match(/^(.{2,60}?)\s*[/\-,]\s*([A-Za-z]{2})$/);
  if (!m) return null;
  const uf = m[2]!.toUpperCase();
  return UFS.has(uf) ? { cidade: m[1]!.replace(/\s+/g, ' ').trim(), uf } : null;
}

/** "412, apto 301" -> { numero: '412', complemento: 'apto 301' }; aceita "S/N". */
export function parseNumeroComplemento(texto: string): { numero: string; complemento: string | null } | null {
  const [numeroBruto, ...resto] = texto.split(',');
  const numero = (numeroBruto ?? '').trim().toUpperCase();
  if (!/^(\d{1,6}[A-Z]?|S\/?N)$/.test(numero)) return null;
  const complemento = resto.join(',').trim().slice(0, 60) || null;
  return { numero: numero.replace('SN', 'S/N'), complemento };
}

/** Celular BR para dígitos com DDI 55. Aceita "+55 27 99999-8888", "(27) 99999-8888". */
export function normalizarCelular(texto: string): string | null {
  let d = texto.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return /^55[1-9]\d9\d{8}$/.test(d) ? d : null;
}

export function formatarEndereco(e: {
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}): string {
  const compl = e.complemento ? ` - ${e.complemento}` : '';
  return `${e.logradouro}, ${e.numero}${compl}, ${e.bairro}, ${e.cidade}/${e.uf}, CEP ${e.cep.slice(0, 5)}-${e.cep.slice(5)}`;
}
