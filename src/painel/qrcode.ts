import qrcode from 'qrcode-generator';

/**
 * QR code em SVG (vetorial: nítido em impressão de qualquer tamanho).
 * Correção de erro "M" (~15%): continua legível com o papel amassado ou um pouco sujo.
 * Margem de 4 módulos (zona de silêncio exigida pela norma para leitura confiável).
 */
export function gerarQrSvg(texto: string, celula = 8): string {
  if (!texto || texto.length > 500) throw new Error('Texto do QR code inválido');
  const qr = qrcode(0, 'M');
  qr.addData(texto, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: celula, margin: celula * 4, scalable: false });
}
