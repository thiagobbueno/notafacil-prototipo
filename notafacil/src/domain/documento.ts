import { asciiPdf, escaparXml, formatarBrl, formatarCnpj } from "./format.js";

export function xmlDemonstracao(dados: {
  numero: string;
  ref: string;
  prestador: string;
  cnpjPrestador: string;
  tomador: string;
  cnpjTomador: string;
  descricao: string;
  valor: number;
  caminho: string;
  codigoVerificacao: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe ambiente="demonstracao">
  <Numero>${escaparXml(dados.numero)}</Numero>
  <CodigoVerificacao>${escaparXml(dados.codigoVerificacao)}</CodigoVerificacao>
  <Referencia>${escaparXml(dados.ref)}</Referencia>
  <Caminho>${escaparXml(dados.caminho)}</Caminho>
  <Prestador>
    <CNPJ>${escaparXml(formatarCnpj(dados.cnpjPrestador))}</CNPJ>
    <RazaoSocial>${escaparXml(dados.prestador)}</RazaoSocial>
  </Prestador>
  <Tomador>
    <CNPJ>${escaparXml(dados.cnpjTomador ? formatarCnpj(dados.cnpjTomador) : "")}</CNPJ>
    <RazaoSocial>${escaparXml(dados.tomador)}</RazaoSocial>
  </Tomador>
  <Servico>
    <Discriminacao>${escaparXml(dados.descricao)}</Discriminacao>
    <ValorServicos>${dados.valor.toFixed(2)}</ValorServicos>
  </Servico>
  <Aviso>Documento fictício do modo demonstração. Não tem valor fiscal.</Aviso>
</NFSe>
`;
}

function escaparPdf(texto: string): string {
  return asciiPdf(texto).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function tamanhoUtf8(texto: string): number {
  return new TextEncoder().encode(texto).length;
}

export function bytesParaBase64(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario);
}

export function pdfDemonstracao(linhas: string[]): Uint8Array {
  const conteudo = linhas
    .map((linha, indice) => `BT /F1 12 Tf 48 ${780 - indice * 22} Td (${escaparPdf(linha)}) Tj ET`)
    .join("\n");
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${tamanhoUtf8(conteudo)} >> stream\n${conteudo}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objetos.forEach((objeto, indice) => {
    offsets.push(tamanhoUtf8(pdf));
    pdf += `${indice + 1} 0 obj ${objeto} endobj\n`;
  });
  const xref = tamanhoUtf8(pdf);
  pdf += `xref\n0 ${objetos.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export function linhasPdf(dados: {
  numero: string;
  prestador: string;
  tomador: string;
  descricao: string;
  valor: number;
  caminho: string;
  status: string;
}): string[] {
  return [
    "NotaFacil - NFS-e de demonstracao",
    "Sem valor fiscal. Nenhum envio a prefeitura.",
    `Numero: ${dados.numero}`,
    `Status: ${dados.status}`,
    `Caminho: ${dados.caminho}`,
    `Prestador: ${dados.prestador}`,
    `Tomador: ${dados.tomador}`,
    `Servico: ${dados.descricao}`,
    `Valor: ${formatarBrl(dados.valor)}`,
  ];
}
