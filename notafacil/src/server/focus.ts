import { FOCUS_EMPRESAS, FOCUS_HOMOLOGACAO } from "../domain/emissao.js";

export type FocusResposta = {
  statusHttp: number;
  json: Record<string, unknown>;
};

export type FocusFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text: string }>;

const fetchPadrao: FocusFetch = async (url, init) => {
  const resposta = await fetch(url, init);
  return { status: resposta.status, text: await resposta.text() };
};

function autorizacao(token: string): string {
  return `Basic ${Buffer.from(`${token}:`).toString("base64")}`;
}

function hostPermitidoEmissao(url: string) {
  const host = new URL(url).hostname;
  if (host !== "homologacao.focusnfe.com.br") {
    throw new Error("A emissão fica travada em homologação (homologacao.focusnfe.com.br).");
  }
}

export async function chamarFocus(opcoes: {
  url: string;
  method: string;
  token: string;
  body?: unknown;
  fetchImpl?: FocusFetch;
  permitirProducaoEmpresas?: boolean;
}): Promise<FocusResposta> {
  if (opcoes.permitirProducaoEmpresas) {
    const host = new URL(opcoes.url).hostname;
    if (host !== new URL(FOCUS_EMPRESAS).hostname) {
      throw new Error("O cadastro de empresa usa apenas a API de empresas da Focus.");
    }
  } else {
    hostPermitidoEmissao(opcoes.url);
    if (!opcoes.url.startsWith(FOCUS_HOMOLOGACAO)) {
      throw new Error("A emissão fica travada em homologação.");
    }
  }
  const fetchImpl = opcoes.fetchImpl ?? fetchPadrao;
  const resposta = await fetchImpl(opcoes.url, {
    method: opcoes.method,
    headers: {
      Authorization: autorizacao(opcoes.token),
      Accept: "application/json",
      ...(opcoes.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: opcoes.body === undefined ? undefined : JSON.stringify(opcoes.body),
  });
  let json: Record<string, unknown> = {};
  if (resposta.text) {
    try {
      json = JSON.parse(resposta.text) as Record<string, unknown>;
    } catch {
      json = { mensagem: resposta.text.slice(0, 500) };
    }
  }
  return { statusHttp: resposta.status, json };
}

export function mensagemFocus(json: Record<string, unknown>): string {
  const erros = json.erros;
  if (Array.isArray(erros) && erros.length) {
    return erros
      .map((erro) => {
        if (!erro || typeof erro !== "object") return String(erro);
        const item = erro as { codigo?: string; mensagem?: string; correcao?: string };
        return [item.codigo, item.mensagem, item.correcao].filter(Boolean).join(" — ");
      })
      .join(" ");
  }
  if (typeof json.mensagem === "string" && json.mensagem) return json.mensagem;
  if (typeof json.codigo === "string" && json.codigo) return json.codigo;
  return "A Focus NFe não aceitou a requisição.";
}

const HOSTS_ARQUIVO = new Set([
  "homologacao.focusnfe.com.br",
  "focusnfe.s3.sa-east-1.amazonaws.com",
  "focusnfe.s3.amazonaws.com",
]);

export function urlArquivoFocus(caminhoOuUrl: string): string {
  if (caminhoOuUrl.startsWith("/")) {
    return `${FOCUS_HOMOLOGACAO}${caminhoOuUrl}`;
  }
  const url = new URL(caminhoOuUrl);
  if (url.protocol !== "https:" || !HOSTS_ARQUIVO.has(url.hostname)) {
    throw new Error("Endereço de arquivo fora dos servidores da Focus em homologação.");
  }
  return url.toString();
}
