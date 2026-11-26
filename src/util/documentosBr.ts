/** Remove tudo que não é dígito ("123.456.789-09" -> "12345678909"). */
export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

/** Valida CPF com dígitos verificadores. Rejeita sequências repetidas (111.111.111-11). */
export function validarCPF(valor: string): boolean {
  const cpf = somenteDigitos(valor);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = digito(cpf.slice(0, 9), 10);
  const d2 = digito(cpf.slice(0, 10), 11);
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

/** Valida CNPJ numérico com dígitos verificadores. */
export function validarCNPJ(valor: string): boolean {
  const cnpj = somenteDigitos(valor);
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digito = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, peso, i) => acc + Number(base[i]) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(cnpj.slice(0, 12)) === Number(cnpj[12]) && digito(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

export function validarEmail(valor: string): boolean {
  return valor.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor);
}

/**
 * "DD/MM/AAAA" -> "AAAA-MM-DD". Recusa data inexistente (31/02), futura, menor de 18 ou acima de 120 anos.
 * `hoje` injetável para teste.
 */
export function parseDataNascimento(
  texto: string,
  hoje = new Date(),
): { ok: true; iso: string } | { ok: false; motivo: 'formato' | 'menor' | 'invalida' } {
  const m = texto.trim().match(/^(\d{2})[/.-](\d{2})[/.-](\d{4})$/);
  if (!m) return { ok: false, motivo: 'formato' };
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const data = new Date(Date.UTC(a, mes - 1, d));
  if (data.getUTCFullYear() !== a || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== d) {
    return { ok: false, motivo: 'invalida' };
  }
  let idade = hoje.getUTCFullYear() - a;
  if (hoje.getUTCMonth() < mes - 1 || (hoje.getUTCMonth() === mes - 1 && hoje.getUTCDate() < d)) idade--;
  if (idade < 0 || idade > 120) return { ok: false, motivo: 'invalida' };
  if (idade < 18) return { ok: false, motivo: 'menor' };
  return { ok: true, iso: `${m[3]}-${m[2]}-${m[1]}` };
}

/** "52998224725" -> "***.982.247-**" (exibição sem expor o CPF completo). */
export function mascararCPF(cpf: string): string {
  const d = somenteDigitos(cpf);
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : '***';
}
