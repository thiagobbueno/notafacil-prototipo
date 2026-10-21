export function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

export function stripAccents(valor: string): string {
  return valor.normalize("NFD").replace(/\p{M}/gu, "");
}

export function round2(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

export function formatarCnpj(digitos: string): string {
  const d = apenasDigitos(digitos).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function formatarCep(digitos: string): string {
  const d = apenasDigitos(digitos).slice(0, 8);
  return d.replace(/^(\d{5})(\d)/, "$1-$2");
}

export function cnpjValido(valor: string): boolean {
  const d = apenasDigitos(valor);
  if (d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  const calc = (base: string, pesos: number[]) => {
    const soma = base.split("").reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = calc(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(d.slice(0, 12) + String(d1), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d.endsWith(`${d1}${d2}`);
}

export function gerarCnpj(base12: string): string {
  const base = apenasDigitos(base12);
  if (base.length !== 12) throw new Error("Base do CNPJ precisa ter 12 dígitos.");
  const calc = (atual: string, pesos: number[]) => {
    const soma = atual.split("").reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = calc(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base + String(d1), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return base + String(d1) + String(d2);
}

export function parseValorBr(input: string): number | null {
  const texto = input.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!texto) return null;
  let normalizado = texto;
  if (texto.includes(",")) {
    normalizado = texto.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) {
    normalizado = texto.replace(/\./g, "");
  }
  const valor = Number(normalizado);
  if (!Number.isFinite(valor) || valor < 0) return null;
  return round2(valor);
}

export function formatarBrl(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatarBrlInput(valor: number): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function calcularIss(valor: number, aliquota: number, retido: boolean): { valorIss: number; liquido: number } {
  const valorIss = round2(valor * (aliquota / 100));
  const liquido = retido ? round2(valor - valorIss) : round2(valor);
  return { valorIss, liquido };
}

/** Item da LC 116 (07.10, 7.10, 0710 ou 071001) → código nacional de 6 dígitos. */
export function codigoNacionalIss(entrada: string): string {
  const digits = apenasDigitos(entrada);
  if (digits.length === 6) return digits;
  if (digits.length === 4) return `${digits}01`;
  if (digits.length === 3) return `${digits.padStart(4, "0")}01`;
  throw new Error("Código de serviço inválido. Use o item da LC 116, por exemplo 07.10.");
}

export function formatarLc116(codigo6: string): string {
  const digits = codigoNacionalIss(codigo6);
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}`;
}

export function formatarDataFocus(date = new Date()): { dataEmissao: string; dataCompetencia: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (tipo: string) => parts.find((parte) => parte.type === tipo)?.value ?? "00";
  const hora = get("hour") === "24" ? "00" : get("hour");
  const dataCompetencia = `${get("year")}-${get("month")}-${get("day")}`;
  return {
    dataCompetencia,
    dataEmissao: `${dataCompetencia}T${hora}:${get("minute")}:${get("second")}-0300`,
  };
}

export function quandoRelativo(iso: string, agora = new Date()): string {
  const data = new Date(iso);
  const inicio = (d: Date) => {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    return partes;
  };
  const a = inicio(agora);
  const b = inicio(data);
  if (a === b) return "hoje";
  const ontem = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
  if (inicio(ontem) === b) return "ontem";
  const [ano, mes, dia] = b.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function asciiPdf(valor: string): string {
  return stripAccents(valor).replace(/[^\x20-\x7E]/g, "");
}
