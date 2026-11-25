import { describe, expect, it } from 'vitest';
import { formatarEndereco, normalizarCelular, parseCidadeUf, parseNumeroComplemento } from '../src/util/endereco';
import { celula, COLUNAS, gerarCsv, type LinhaExportacao } from '../src/exportacao/habilitados';

describe('endereço e celular', () => {
  it.each([
    ['+55 27 99988-7766', '5527999887766'],
    ['(27) 99988-7766', '5527999887766'],
    ['5511987654321', '5511987654321'],
  ])('celular %s', (i, o) => expect(normalizarCelular(i)).toBe(o));
  it.each(['27 3222-1111', '1234', '00 99988-7766', ''])('celular inválido %j', (i) => expect(normalizarCelular(i)).toBeNull());

  it('cidade/UF', () => {
    expect(parseCidadeUf('Vila Velha/es')).toEqual({ cidade: 'Vila Velha', uf: 'ES' });
    expect(parseCidadeUf('Cachoeiro de Itapemirim - ES')).toEqual({ cidade: 'Cachoeiro de Itapemirim', uf: 'ES' });
    expect(parseCidadeUf('Vitória/XX')).toBeNull();
    expect(parseCidadeUf('Vitória')).toBeNull();
  });

  it('número e complemento', () => {
    expect(parseNumeroComplemento('412, apto 301')).toEqual({ numero: '412', complemento: 'apto 301' });
    expect(parseNumeroComplemento('s/n')).toEqual({ numero: 'S/N', complemento: null });
    expect(parseNumeroComplemento('15b')).toEqual({ numero: '15B', complemento: null });
    expect(parseNumeroComplemento('rua x')).toBeNull();
  });

  it('formata endereço', () => {
    expect(
      formatarEndereco({ logradouro: 'Rua A', numero: '1', complemento: null, bairro: 'Centro', cidade: 'Serra', uf: 'ES', cep: '29160000' }),
    ).toBe('Rua A, 1, Centro, Serra/ES, CEP 29160-000');
  });
});

describe('CSV de exportação', () => {
  it('ADM-09: neutraliza fórmulas e escapa separador/aspas', () => {
    expect(celula('=HYPERLINK("http://x","clique")')).toBe(`"'=HYPERLINK(""http://x"",""clique"")"`);
    expect(celula('+5511')).toBe(`"'+5511"`);
    expect(celula('-1')).toBe(`"'-1"`);
    expect(celula('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(celula('Rua A; casa 2')).toBe('"Rua A; casa 2"');
    expect(celula('linha1\nlinha2')).toBe('linha1 linha2');
    expect(celula('Normal')).toBe('Normal');
  });

  it('BOM, cabeçalho, ";" e CRLF (abre certo no Excel BR)', () => {
    const linha: LinhaExportacao = {
      id: 7, nome: '=cmd|calc', cpf: '52998224725', cnpj: '11222333000181', rg_ie: 'ISENTO', email: 'a@b.com',
      celular: '5527999887766', cep: '29015000', logradouro: 'Rua A', numero: '1', complemento: null, bairro: 'Centro',
      cidade: 'Vitória', uf: 'ES', status: 'aprovado', consentido_em: new Date('2026-11-20T15:00:00Z'), decidido_em: null,
    };
    const csv = gerarCsv([linha]);
    expect(csv.startsWith('﻿' + COLUNAS.join(';'))).toBe(true);
    const [, dados] = csv.slice(1).split('\r\n');
    expect(dados).toContain(`7;"'=cmd|calc";Jurídica;11.222.333/0001-81;ISENTO;a@b.com;(27) 99988-7766;29015-000`);
    expect(dados).toContain(';Aprovado;20/11/2026, 12:00;');
  });
});
