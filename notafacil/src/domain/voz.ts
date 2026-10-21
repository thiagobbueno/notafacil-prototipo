import { stripAccents } from "./format.js";

export type ItemVoz = { id: string; nome: string };

export type CatalogoVoz = {
  tomadores: ItemVoz[];
  servicos: ItemVoz[];
};

export type RascunhoVoz = {
  texto: string;
  valor: number | null;
  tomadorId: string | null;
  tomadorNome: string | null;
  tomadorTexto: string | null;
  servicoId: string | null;
  servicoNome: string | null;
  servicoTexto: string | null;
  avisos: string[];
};

const UNIDADES: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
  catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19,
};

const DEZENAS: Record<string, number> = {
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60,
  setenta: 70, oitenta: 80, noventa: 90,
};

const CENTENAS: Record<string, number> = {
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
  quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500,
  seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
  oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};

const PALAVRAS_NUMERO = new Set([...Object.keys(UNIDADES), ...Object.keys(DEZENAS), ...Object.keys(CENTENAS), "mil", "e"]);

const PARADA = new Set(["de", "da", "do", "das", "dos", "e", "ltda", "me", "epp", "eireli", "sa", "ss"]);

function dobrar(texto: string): string {
  return stripAccents(texto).toLowerCase();
}

function normalizar(texto: string): string {
  return dobrar(texto).replace(/[^a-z0-9.,$]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && !PARADA.has(token));
}

function parseNumeroPt(texto: string): number {
  if (texto.includes(",")) {
    return Number(texto.replace(/\./g, "").replace(",", "."));
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(texto)) return Number(texto.replace(/\./g, ""));
  return Number(texto);
}

function avaliarGrupo(partes: string[]): number | null {
  let total = 0;
  for (const parte of partes) {
    if (parte in CENTENAS) total += CENTENAS[parte];
    else if (parte in DEZENAS) total += DEZENAS[parte];
    else if (parte in UNIDADES) total += UNIDADES[parte];
    else return null;
  }
  return total;
}

function avaliarExtenso(sequencia: string[]): number | null {
  const partes = sequencia.filter((palavra) => palavra !== "e");
  if (!partes.length) return null;
  const mil = partes.indexOf("mil");
  if (mil >= 0) {
    const esquerda = partes.slice(0, mil);
    const direita = partes.slice(mil + 1);
    const multiplicador = esquerda.length ? avaliarGrupo(esquerda) : 1;
    const resto = direita.length ? avaliarGrupo(direita) : 0;
    if (multiplicador == null || resto == null) return null;
    return multiplicador * 1000 + resto;
  }
  return avaliarGrupo(partes);
}

function extrairValor(norm: string): number | null {
  const digitos = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)(\s+mil)?/g;
  let encontrado: RegExpExecArray | null;
  while ((encontrado = digitos.exec(norm))) {
    let valor = parseNumeroPt(encontrado[1]);
    if (encontrado[2]) valor *= 1000;
    const depois = norm.slice(encontrado.index + encontrado[0].length, encontrado.index + encontrado[0].length + 10);
    const antes = norm.slice(Math.max(0, encontrado.index - 16), encontrado.index);
    const contextual = /\breais\b|\breal\b/.test(depois) || /r\$\s*$/.test(antes) || /\bnota de\s*$/.test(antes) || /\bvalor de\s*$/.test(antes);
    if (contextual && Number.isFinite(valor)) return valor;
  }

  const palavras = norm.split(" ").filter(Boolean);
  let indice = palavras.lastIndexOf("reais");
  if (indice < 0) indice = palavras.lastIndexOf("real");
  if (indice > 0) {
    const sequencia: string[] = [];
    for (let i = indice - 1; i >= 0; i -= 1) {
      if (!PALAVRAS_NUMERO.has(palavras[i])) break;
      sequencia.unshift(palavras[i]);
    }
    const valor = avaliarExtenso(sequencia);
    if (valor != null) return valor;
  }
  return null;
}

function melhorItem(consulta: string, itens: ItemVoz[]): ItemVoz | null {
  const consultaTokens = tokens(consulta);
  if (!consultaTokens.some((token) => token.length >= 3)) return null;
  let melhor: ItemVoz | null = null;
  let melhorNota = -1;
  let menorFolga = Number.POSITIVE_INFINITY;
  for (const item of itens) {
    const nomeTokens = tokens(item.nome);
    const compartilhados = consultaTokens.filter((token) => nomeTokens.includes(token));
    if (compartilhados.length < consultaTokens.length) continue;
    const folga = Math.abs(nomeTokens.length - consultaTokens.length);
    if (compartilhados.length > melhorNota || (compartilhados.length === melhorNota && folga < menorFolga)) {
      melhor = item;
      melhorNota = compartilhados.length;
      menorFolga = folga;
    }
  }
  return melhor;
}

function acharServicoNoTrecho(trecho: string, servicos: ItemVoz[]): { item: ItemVoz; cliente: string } | null {
  const dobrado = dobrar(trecho);
  let escolhido: ItemVoz | null = null;
  let tamanho = 0;
  let posicao = -1;
  for (const servico of servicos) {
    const nome = dobrar(servico.nome);
    const pos = dobrado.indexOf(nome);
    if (nome.length > 3 && pos >= 0 && nome.length > tamanho) {
      escolhido = servico;
      tamanho = nome.length;
      posicao = pos;
    }
  }
  if (escolhido && posicao >= 0) {
    const cliente = `${trecho.slice(0, posicao)} ${trecho.slice(posicao + dobrar(escolhido.nome).length)}`
      .replace(/\s+/g, " ")
      .replace(/^[\s,]+|[\s,]+$/g, "");
    return { item: escolhido, cliente };
  }
  return null;
}

/**
 * Lê uma frase falada e devolve os campos da nota.
 * Não emite nada: a confirmação fica com quem chama.
 */
export function interpretarNotaFalada(texto: string, catalogo: CatalogoVoz): RascunhoVoz {
  const original = texto.replace(/\s+/g, " ").trim();
  const dobrado = dobrar(original);
  const norm = normalizar(original);
  const valor = extrairValor(norm);
  const marcador = dobrado.match(/\b(?:para|pra|pro)\s+/);
  let tomadorTexto: string | null = null;
  let servicoTexto: string | null = null;
  let servico = null as ItemVoz | null;

  if (marcador && marcador.index != null) {
    const inicio = marcador.index + marcador[0].length;
    const trecho = original.slice(inicio).trim();
    const virgula = trecho.indexOf(",");
    if (virgula >= 0) {
      tomadorTexto = trecho.slice(0, virgula).trim();
      servicoTexto = trecho.slice(virgula + 1).trim();
      servico = melhorItem(servicoTexto, catalogo.servicos);
    } else {
      const achado = acharServicoNoTrecho(trecho, catalogo.servicos);
      if (achado) {
        servico = achado.item;
        servicoTexto = achado.item.nome;
        tomadorTexto = achado.cliente || null;
      } else {
        tomadorTexto = trecho;
      }
    }
  }

  const tomador = tomadorTexto ? melhorItem(tomadorTexto, catalogo.tomadores) : null;
  if (!servico && servicoTexto) servico = melhorItem(servicoTexto, catalogo.servicos);

  const avisos: string[] = [];
  if (valor == null) avisos.push("Não entendi o valor. Fale como “1500 reais” ou “dois mil reais”.");
  if (!tomador) avisos.push(tomadorTexto ? `Não encontrei o cliente “${tomadorTexto}”.` : "Não entendi o cliente. Use “para” e o nome.");
  if (!servico) avisos.push(servicoTexto ? `Não encontrei o serviço “${servicoTexto}”.` : "Não entendi o serviço.");

  return {
    texto: original,
    valor,
    tomadorId: tomador?.id ?? null,
    tomadorNome: tomador?.nome ?? null,
    tomadorTexto,
    servicoId: servico?.id ?? null,
    servicoNome: servico?.nome ?? null,
    servicoTexto,
    avisos,
  };
}
