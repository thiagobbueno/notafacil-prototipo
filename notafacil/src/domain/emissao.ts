import { IBGE_APARECIDA, IBGE_GOIANIA, nomeMunicipio } from "./municipios.js";
import { apenasDigitos, formatarDataFocus, round2 } from "./format.js";

export const FOCUS_HOMOLOGACAO = "https://homologacao.focusnfe.com.br";
export const FOCUS_EMPRESAS = "https://api.focusnfe.com.br";

export type Regime = "mei" | "simples_nacional" | "lucro_presumido" | "lucro_real";
export type CaminhoEmissao = "emissor_nacional" | "municipal_goiania";

export type EmpresaFiscal = {
  cnpj: string;
  razaoSocial: string;
  inscricaoMunicipal: string;
  regime: Regime;
  codigoIbge: string;
  uf: string;
  municipio?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cep?: string;
  email?: string;
};

export type TomadorFiscal = {
  cnpj?: string | null;
  cpf?: string | null;
  razaoSocial: string;
  email?: string | null;
  telefone?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  codigoIbge?: string | null;
  uf?: string | null;
  cep?: string | null;
};

export type ServicoFiscal = {
  nome: string;
  descricao: string;
  codigoNacional: string;
  codigoMunicipal?: string | null;
  codigoNbs?: string | null;
  aliquotaIss: number;
};

export type NotaFiscalInput = {
  empresa: EmpresaFiscal;
  tomador: TomadorFiscal;
  servico: ServicoFiscal;
  valor: number;
  issRetido: boolean;
  descricao: string;
  emitidoEm?: Date;
};

export type EmissaoPronta = {
  caminho: CaminhoEmissao;
  titulo: string;
  detalhe: string;
  endpoint: "/v2/nfsen";
  provedor: "emissor_nacional" | "issnet";
  habilitarAmbienteNacional: boolean;
  body: Record<string, string | number>;
};

export type CaminhoResolvido =
  | { ok: true; caminho: CaminhoEmissao; titulo: string; detalhe: string; provedor: "emissor_nacional" | "issnet"; habilitarAmbienteNacional: boolean }
  | { ok: false; erro: string };

const REGIMES_NACIONAIS = new Set<Regime>(["mei", "simples_nacional"]);
const REGIMES_LUCRO = new Set<Regime>(["lucro_presumido", "lucro_real"]);

/**
 * opSimpNac do leiaute nacional da DPS (campo codigo_opcao_simples_nacional na Focus):
 * 1 Não optante, 2 MEI, 3 ME/EPP do Simples Nacional.
 */
export function codigoOpcaoSimples(regime: Regime): 1 | 2 | 3 {
  if (regime === "mei") return 2;
  if (regime === "simples_nacional") return 3;
  return 1;
}

export function regimeFocus(regime: Regime): 1 | 3 | 4 {
  if (regime === "mei") return 4;
  if (regime === "simples_nacional") return 1;
  return 3;
}

export function resolverCaminho(empresa: Pick<EmpresaFiscal, "regime" | "codigoIbge" | "uf">): CaminhoResolvido {
  if (empresa.uf.toUpperCase() !== "GO") {
    return { ok: false, erro: "NotaFácil neste MVP emite apenas para prestadores em Goiás." };
  }

  const simplesOuMei = REGIMES_NACIONAIS.has(empresa.regime);
  const aparecida = empresa.codigoIbge === IBGE_APARECIDA;
  const goiania = empresa.codigoIbge === IBGE_GOIANIA;

  if (simplesOuMei) {
    return {
      ok: true,
      caminho: "emissor_nacional",
      provedor: "emissor_nacional",
      habilitarAmbienteNacional: true,
      titulo: "Emissor Nacional",
      detalhe:
        "MEI e optantes pelo Simples Nacional emitem pelo Emissor Nacional (Focus POST /v2/nfsen, com NFS-e Nacional de homologação ligada na empresa). A Resolução CGSN nº 191/2026 torna isso obrigatório para ME e EPP a partir de 01/11/2026. A data de 01/09/2026 da Resolução CGSN nº 189/2026 foi revogada.",
    };
  }

  if (aparecida) {
    return {
      ok: true,
      caminho: "emissor_nacional",
      provedor: "emissor_nacional",
      habilitarAmbienteNacional: true,
      titulo: "Emissor Nacional",
      detalhe:
        "Aparecida de Goiânia (IBGE 5201405) passa a exigir o Portal Nacional da NFS-e para todos os contribuintes em 01/11/2026. A nota sai pelo Ambiente Nacional da Focus. O guia municipal da Focus ainda descreve IssNet sem homologação própria.",
    };
  }

  if (REGIMES_LUCRO.has(empresa.regime) && goiania) {
    return {
      ok: true,
      caminho: "municipal_goiania",
      provedor: "issnet",
      habilitarAmbienteNacional: false,
      titulo: "ISSNet / SGISS · Goiânia",
      detalhe:
        "Lucro presumido ou real em Goiânia (IBGE 5208707) usa a integração municipal da Focus com o provedor IssNet. O guia atual pede o layout nacional no POST /v2/nfsen e manda não ligar o Ambiente Nacional: a NFS-e municipal é que segue para o SGISS. O código tributário municipal do serviço é obrigatório.",
    };
  }

  if (REGIMES_LUCRO.has(empresa.regime)) {
    return {
      ok: false,
      erro: `Fora do escopo: lucro presumido ou real em ${nomeMunicipio(empresa.codigoIbge)} ainda não está integrado. Neste MVP esse regime só emite em Goiânia, pelo ISSNet/SGISS. Aparecida de Goiânia usa o Emissor Nacional.`,
    };
  }

  return { ok: false, erro: "Regime tributário não suportado." };
}

function semVazios(body: Record<string, string | number | null | undefined>): Record<string, string | number> {
  const limpo: Record<string, string | number> = {};
  for (const [chave, valor] of Object.entries(body)) {
    if (valor === null || valor === undefined || valor === "") continue;
    limpo[chave] = valor;
  }
  return limpo;
}

function camposComuns(input: NotaFiscalInput, data: { dataEmissao: string; dataCompetencia: string }) {
  const cnpjTomador = input.tomador.cnpj ? apenasDigitos(input.tomador.cnpj) : "";
  const cpfTomador = input.tomador.cpf ? apenasDigitos(input.tomador.cpf) : "";
  if (!cnpjTomador && !cpfTomador) {
    throw new Error("Informe o CNPJ ou o CPF do tomador.");
  }
  if (!input.tomador.codigoIbge) throw new Error("Informe o município do tomador.");
  if (!input.tomador.logradouro || !input.tomador.numero || !input.tomador.bairro || !input.tomador.cep) {
    throw new Error("Preencha logradouro, número, bairro e CEP do tomador.");
  }
  if (!(input.valor > 0)) throw new Error("Informe um valor maior que zero.");

  return semVazios({
    data_emissao: data.dataEmissao,
    data_competencia: data.dataCompetencia,
    codigo_municipio_emissora: Number(input.empresa.codigoIbge),
    cnpj_prestador: apenasDigitos(input.empresa.cnpj),
    inscricao_municipal_prestador: input.empresa.inscricaoMunicipal.trim(),
    codigo_opcao_simples_nacional: codigoOpcaoSimples(input.empresa.regime),
    regime_especial_tributacao: 0,
    cnpj_tomador: cnpjTomador || null,
    cpf_tomador: cnpjTomador ? null : cpfTomador,
    razao_social_tomador: input.tomador.razaoSocial.trim(),
    codigo_municipio_tomador: Number(input.tomador.codigoIbge),
    cep_tomador: apenasDigitos(input.tomador.cep),
    logradouro_tomador: input.tomador.logradouro.trim(),
    numero_tomador: input.tomador.numero.trim(),
    complemento_tomador: input.tomador.complemento?.trim() || null,
    bairro_tomador: input.tomador.bairro.trim(),
    telefone_tomador: input.tomador.telefone?.trim() || null,
    email_tomador: input.tomador.email?.trim() || null,
    codigo_municipio_prestacao: Number(input.empresa.codigoIbge),
    codigo_tributacao_nacional_iss: input.servico.codigoNacional,
    descricao_servico: input.descricao.trim(),
    valor_servico: round2(input.valor),
    tributacao_iss: 1,
    tipo_retencao_iss: input.issRetido ? 2 : 1,
  });
}

export function montarEmissao(input: NotaFiscalInput): EmissaoPronta {
  const caminho = resolverCaminho(input.empresa);
  if (!caminho.ok) throw new Error(caminho.erro);
  const data = formatarDataFocus(input.emitidoEm ?? new Date());
  const body = camposComuns(input, data);

  if (caminho.caminho === "municipal_goiania") {
    const municipal = input.servico.codigoMunicipal?.trim();
    if (!municipal) {
      throw new Error("Goiânia no lucro presumido ou real exige o código tributário municipal no serviço (ISSNet/SGISS).");
    }
    body.codigo_tributacao_municipal_iss = municipal;
    const nbs = input.servico.codigoNbs?.trim();
    if (nbs) body.codigo_nbs = nbs;
  }

  return {
    caminho: caminho.caminho,
    titulo: caminho.titulo,
    detalhe: caminho.detalhe,
    endpoint: "/v2/nfsen",
    provedor: caminho.provedor,
    habilitarAmbienteNacional: caminho.habilitarAmbienteNacional,
    body,
  };
}

export function flagsEmpresaFocus(empresa: EmpresaFiscal): {
  regime_tributario: 1 | 3 | 4;
  habilita_nfse: boolean;
  habilita_nfsen_homologacao: boolean;
  habilita_nfsen_producao: false;
} {
  const caminho = resolverCaminho(empresa);
  if (!caminho.ok) throw new Error(caminho.erro);
  return {
    regime_tributario: regimeFocus(empresa.regime),
    habilita_nfse: caminho.caminho === "municipal_goiania",
    habilita_nfsen_homologacao: caminho.habilitarAmbienteNacional,
    habilita_nfsen_producao: false,
  };
}

export function requisicaoEmissao(ref: string, body: Record<string, string | number>): {
  method: "POST";
  url: string;
  body: Record<string, string | number>;
} {
  return {
    method: "POST",
    url: `${FOCUS_HOMOLOGACAO}/v2/nfsen?ref=${encodeURIComponent(ref)}`,
    body,
  };
}

export function requisicaoConsulta(ref: string): { method: "GET"; url: string } {
  return { method: "GET", url: `${FOCUS_HOMOLOGACAO}/v2/nfsen/${encodeURIComponent(ref)}` };
}

export function requisicaoCancelamento(ref: string, justificativa: string): {
  method: "DELETE";
  url: string;
  body: { justificativa: string };
} {
  return {
    method: "DELETE",
    url: `${FOCUS_HOMOLOGACAO}/v2/nfsen/${encodeURIComponent(ref)}`,
    body: { justificativa },
  };
}

export const LABEL_REGIME: Record<Regime, string> = {
  mei: "MEI",
  simples_nacional: "Simples Nacional",
  lucro_presumido: "Lucro presumido",
  lucro_real: "Lucro real",
};
