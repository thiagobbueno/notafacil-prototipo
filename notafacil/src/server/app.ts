import express, { type NextFunction, type Request, type Response } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { linhasPdf, pdfDemonstracao, xmlDemonstracao } from "../domain/documento.js";
import {
  LABEL_REGIME,
  flagsEmpresaFocus,
  montarEmissao,
  requisicaoCancelamento,
  requisicaoConsulta,
  requisicaoEmissao,
  resolverCaminho,
  type Regime,
} from "../domain/emissao.js";
import {
  apenasDigitos,
  calcularIss,
  cnpjValido,
  codigoNacionalIss,
  formatarCnpj,
  formatarLc116,
  quandoRelativo,
} from "../domain/format.js";
import { MUNICIPIOS_GO, nomeMunicipio } from "../domain/municipios.js";
import { interpretarNotaFalada } from "../domain/voz.js";
import {
  abrirBanco,
  verificaSenha,
  hashSenha,
  type EmpresaRow,
  type NotaRow,
  type ServicoRow,
  type TomadorRow,
} from "./db.js";
import { chamarFocus, mensagemFocus, urlArquivoFocus, type FocusFetch } from "./focus.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export type AppOptions = {
  dataDir: string;
  focusToken?: string;
  focusTokenPrincipal?: string;
  empresasEfetivar?: boolean;
  webhookSecret?: string;
  registroAberto?: boolean;
  client?: boolean;
  focusFetch?: FocusFetch;
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Sessao = { id: string; user_id: string; empresa_id: string | null; expires_at: string };
type Authed = Request & { userId: string; empresaId: string | null };

function cookie(req: Request, nome: string): string | undefined {
  const bruto = req.headers.cookie;
  if (!bruto) return;
  for (const parte of bruto.split(";")) {
    const [chave, ...resto] = parte.trim().split("=");
    if (chave === nome) return decodeURIComponent(resto.join("="));
  }
}

function envolver(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function empresaFiscal(row: EmpresaRow) {
  return {
    cnpj: row.cnpj,
    razaoSocial: row.razao_social,
    inscricaoMunicipal: row.inscricao_municipal,
    regime: row.regime as Regime,
    codigoIbge: row.codigo_ibge,
    uf: row.uf,
    municipio: row.municipio,
    logradouro: row.logradouro,
    numero: row.numero,
    bairro: row.bairro,
    cep: row.cep,
    email: row.email ?? undefined,
  };
}

function dtoEmpresa(row: EmpresaRow) {
  const caminho = resolverCaminho(empresaFiscal(row));
  return {
    id: row.id,
    cnpj: formatarCnpj(row.cnpj),
    cnpjDigitos: row.cnpj,
    razaoSocial: row.razao_social,
    nomeFantasia: row.nome_fantasia,
    inscricaoMunicipal: row.inscricao_municipal,
    regime: row.regime,
    regimeLabel: LABEL_REGIME[row.regime as Regime] ?? row.regime,
    codigoIbge: row.codigo_ibge,
    municipio: row.municipio,
    uf: row.uf,
    logradouro: row.logradouro,
    numero: row.numero,
    bairro: row.bairro,
    cep: row.cep,
    email: row.email,
    telefone: row.telefone,
    focusEmpresaId: row.focus_empresa_id,
    certificadoStatus: row.certificado_status,
    certificadoValidoAte: row.certificado_valido_ate,
    caminho: caminho.ok ? caminho : null,
  };
}

function dtoTomador(row: TomadorRow) {
  return {
    id: row.id,
    cnpj: row.cnpj ? formatarCnpj(row.cnpj) : null,
    cpf: row.cpf,
    razaoSocial: row.razao_social,
    email: row.email,
    telefone: row.telefone,
    logradouro: row.logradouro,
    numero: row.numero,
    complemento: row.complemento,
    bairro: row.bairro,
    codigoIbge: row.codigo_ibge,
    municipio: row.municipio,
    uf: row.uf,
    cep: row.cep,
    ultimaNotaEm: row.ultima_nota_em,
    ultimaLabel: row.ultima_nota_em ? `última: ${quandoRelativo(row.ultima_nota_em)}` : "novo",
  };
}

function dtoServico(row: ServicoRow) {
  return {
    id: row.id,
    nome: row.nome,
    descricao: row.descricao,
    codigoLc116: row.codigo_lc116,
    codigoNacional: row.codigo_nacional,
    codigoMunicipal: row.codigo_municipal,
    codigoNbs: row.codigo_nbs,
    aliquotaIss: row.aliquota_iss,
  };
}

function dtoNota(row: NotaRow, tomador?: TomadorRow, servico?: ServicoRow) {
  let erros: unknown = null;
  if (row.erros) {
    try { erros = JSON.parse(row.erros); } catch { erros = row.erros; }
  }
  return {
    id: row.id,
    ref: row.ref,
    caminho: row.caminho,
    status: row.status,
    valor: row.valor,
    aliquotaIss: row.aliquota_iss,
    valorIss: row.valor_iss,
    issRetido: row.iss_retido === 1,
    descricao: row.descricao,
    enviarEmail: row.enviar_email === 1,
    numero: row.numero,
    codigoVerificacao: row.codigo_verificacao,
    urlConsulta: row.url_consulta,
    temPdf: Boolean(row.pdf_base64 || row.url_pdf),
    temXml: Boolean(row.xml_local || row.caminho_xml),
    erros,
    payload: JSON.parse(row.payload) as unknown,
    tomadorId: row.tomador_id,
    servicoId: row.servico_id,
    tomadorNome: tomador?.razao_social ?? "",
    servicoNome: servico?.nome ?? "",
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

function lerEmpresaBody(body: Record<string, unknown>) {
  const cnpj = apenasDigitos(String(body.cnpj ?? ""));
  if (!cnpjValido(cnpj)) throw new HttpError(400, "CNPJ inválido.");
  const razaoSocial = String(body.razaoSocial ?? "").trim();
  const inscricaoMunicipal = String(body.inscricaoMunicipal ?? "").trim();
  const regime = String(body.regime ?? "") as Regime;
  const codigoIbge = apenasDigitos(String(body.codigoIbge ?? ""));
  if (!razaoSocial) throw new HttpError(400, "Informe a razão social.");
  if (!inscricaoMunicipal) throw new HttpError(400, "Informe a inscrição municipal.");
  if (!["mei", "simples_nacional", "lucro_presumido", "lucro_real"].includes(regime)) {
    throw new HttpError(400, "Regime tributário inválido.");
  }
  if (codigoIbge.length !== 7) throw new HttpError(400, "Informe o código IBGE do município com 7 dígitos.");
  const uf = "GO";
  const caminho = resolverCaminho({ regime, codigoIbge, uf });
  if (!caminho.ok) throw new HttpError(400, caminho.erro);
  const cep = apenasDigitos(String(body.cep ?? ""));
  const logradouro = String(body.logradouro ?? "").trim();
  const numero = String(body.numero ?? "").trim();
  const bairro = String(body.bairro ?? "").trim();
  if (cep.length !== 8 || !logradouro || !numero || !bairro) {
    throw new HttpError(400, "Preencha CEP, logradouro, número e bairro da empresa.");
  }
  return {
    cnpj,
    razaoSocial,
    nomeFantasia: String(body.nomeFantasia ?? "").trim() || null,
    inscricaoMunicipal,
    regime,
    codigoIbge,
    municipio: String(body.municipio ?? "").trim() || nomeMunicipio(codigoIbge),
    uf,
    logradouro,
    numero,
    bairro,
    cep,
    email: String(body.email ?? "").trim() || null,
    telefone: String(body.telefone ?? "").trim() || null,
  };
}

function lerTomadorBody(body: Record<string, unknown>) {
  const cnpj = apenasDigitos(String(body.cnpj ?? ""));
  const cpf = apenasDigitos(String(body.cpf ?? ""));
  if (cnpj && !cnpjValido(cnpj)) throw new HttpError(400, "CNPJ do tomador inválido.");
  if (!cnpj && cpf.length !== 11) throw new HttpError(400, "Informe o CNPJ ou o CPF do tomador.");
  const razaoSocial = String(body.razaoSocial ?? "").trim();
  if (razaoSocial.length < 2) throw new HttpError(400, "Informe a razão social do tomador.");
  const codigoIbge = apenasDigitos(String(body.codigoIbge ?? ""));
  if (codigoIbge.length !== 7) throw new HttpError(400, "Informe o município do tomador.");
  const cep = apenasDigitos(String(body.cep ?? ""));
  const logradouro = String(body.logradouro ?? "").trim();
  const numero = String(body.numero ?? "").trim();
  const bairro = String(body.bairro ?? "").trim();
  if (cep.length !== 8 || !logradouro || !numero || !bairro) {
    throw new HttpError(400, "Preencha CEP, logradouro, número e bairro do tomador.");
  }
  return {
    cnpj: cnpj || null,
    cpf: cnpj ? null : cpf,
    razaoSocial,
    email: String(body.email ?? "").trim() || null,
    telefone: String(body.telefone ?? "").trim() || null,
    logradouro,
    numero,
    complemento: String(body.complemento ?? "").trim() || null,
    bairro,
    codigoIbge,
    municipio: String(body.municipio ?? "").trim() || nomeMunicipio(codigoIbge),
    uf: String(body.uf ?? "GO").trim().toUpperCase() || "GO",
    cep,
  };
}

function lerServicoBody(body: Record<string, unknown>) {
  const nome = String(body.nome ?? "").trim();
  const descricao = String(body.descricao ?? "").trim();
  if (nome.length < 2 || descricao.length < 2) throw new HttpError(400, "Informe nome e descrição do serviço.");
  let codigoNacional: string;
  try {
    codigoNacional = codigoNacionalIss(String(body.codigoLc116 ?? body.codigoNacional ?? ""));
  } catch (erro) {
    throw new HttpError(400, erro instanceof Error ? erro.message : "Código de serviço inválido.");
  }
  const aliquota = Number(body.aliquotaIss);
  if (!Number.isFinite(aliquota) || aliquota < 0 || aliquota > 5) {
    throw new HttpError(400, "A alíquota de ISS precisa ficar entre 0 e 5%.");
  }
  return {
    nome,
    descricao,
    codigoLc116: formatarLc116(codigoNacional),
    codigoNacional,
    codigoMunicipal: String(body.codigoMunicipal ?? "").trim() || null,
    codigoNbs: String(body.codigoNbs ?? "").trim() || null,
    aliquotaIss: aliquota,
  };
}

function instrucoesCertificado(empresa: EmpresaRow, modo: "mock" | "homologacao"): string[] {
  const caminho = resolverCaminho(empresaFiscal(empresa));
  const passos = [
    "O certificado é o modelo A1 (arquivo .pfx) do CNPJ prestador. A NotaFácil não guarda o arquivo nem a senha.",
    "Na Focus, abra a empresa e envie o certificado. A API de empresas só existe em produção e usa o token principal, não o token de homologação.",
  ];
  if (caminho.ok && caminho.habilitarAmbienteNacional) {
    passos.push("Nesta empresa, ligue apenas “Ambiente da NFS-e Nacional — Homologação” (habilita_nfsen_homologacao). Deixe a NFS-e municipal desligada.");
  } else if (caminho.ok) {
    passos.push("Nesta empresa, ligue a NFS-e municipal (habilita_nfse) e deixe o Ambiente Nacional desligado. É assim que a Focus fala com o IssNet/SGISS de Goiânia.");
  }
  if (modo === "mock") {
    passos.push("Sem FOCUS_NFE_TOKEN a emissão fica no modo demonstração, mesmo com o certificado marcado.");
  }
  return passos;
}

export async function createApp(opcoes: AppOptions) {
  const db = abrirBanco(path.join(opcoes.dataDir, "notafacil.sqlite"));
  const token = opcoes.focusToken?.trim() || "";
  const tokenPrincipal = opcoes.focusTokenPrincipal?.trim() || "";
  const modo = token ? "homologacao" as const : "mock" as const;
  const registroAberto = opcoes.registroAberto !== false;

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "3mb" }));

  function exigirUsuario(req: Request): Authed {
    const sid = cookie(req, "nf_sessao");
    if (!sid) throw new HttpError(401, "Faça login para continuar.");
    const sessao = db.prepare("SELECT id, user_id, empresa_id, expires_at FROM sessions WHERE id = ?").get(sid) as Sessao | undefined;
    if (!sessao || sessao.expires_at < new Date().toISOString()) {
      throw new HttpError(401, "Sua sessão expirou. Entre de novo.");
    }
    (req as Authed).userId = sessao.user_id;
    (req as Authed).empresaId = sessao.empresa_id;
    return req as Authed;
  }

  function exigirEmpresa(req: Request): { userId: string; empresa: EmpresaRow } {
    const auth = exigirUsuario(req);
    if (!auth.empresaId) throw new HttpError(400, "Selecione uma empresa.");
    const empresa = db.prepare("SELECT * FROM empresas WHERE id = ? AND user_id = ?").get(auth.empresaId, auth.userId) as EmpresaRow | undefined;
    if (!empresa) throw new HttpError(400, "Selecione uma empresa.");
    return { userId: auth.userId, empresa };
  }

  function abrirSessao(res: Response, userId: string, empresaId: string | null) {
    const id = randomBytes(24).toString("hex");
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
    db.prepare("INSERT INTO sessions (id, user_id, empresa_id, expires_at) VALUES (?, ?, ?, ?)").run(id, userId, empresaId, expires);
    const seguro = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `nf_sessao=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 14}${seguro}`);
  }

  app.get("/api/meta", (_req, res) => {
    res.json({
      modo,
      registroAberto,
      empresasApi: Boolean(tokenPrincipal),
      webhookConfigurado: Boolean(opcoes.webhookSecret),
      municipios: MUNICIPIOS_GO,
    });
  });

  app.post("/api/auth/registrar", envolver(async (req, res) => {
    if (!registroAberto) throw new HttpError(403, "O cadastro de novos usuários está fechado.");
    const nome = String(req.body?.nome ?? "").trim();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const senha = String(req.body?.senha ?? "");
    if (nome.length < 2) throw new HttpError(400, "Informe o nome.");
    if (!email.includes("@")) throw new HttpError(400, "E-mail inválido.");
    if (senha.length < 6) throw new HttpError(400, "A senha precisa ter pelo menos 6 caracteres.");
    const duplicado = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (duplicado) throw new HttpError(409, "Já existe uma conta com esse e-mail.");
    const id = randomUUID();
    db.prepare("INSERT INTO users (id, nome, email, senha_hash, criado_em) VALUES (?, ?, ?, ?, ?)").run(id, nome, email, hashSenha(senha), new Date().toISOString());
    abrirSessao(res, id, null);
    res.status(201).json({ id, nome, email });
  }));

  app.post("/api/auth/login", envolver(async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const senha = String(req.body?.senha ?? "");
    const usuario = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as { id: string; nome: string; email: string; senha_hash: string } | undefined;
    if (!usuario || !verificaSenha(senha, usuario.senha_hash)) throw new HttpError(401, "E-mail ou senha incorretos.");
    const primeira = db.prepare("SELECT id FROM empresas WHERE user_id = ? ORDER BY criado_em LIMIT 1").get(usuario.id) as { id: string } | undefined;
    abrirSessao(res, usuario.id, primeira?.id ?? null);
    res.json({ id: usuario.id, nome: usuario.nome, email: usuario.email, empresaId: primeira?.id ?? null });
  }));

  app.post("/api/auth/logout", envolver(async (req, res) => {
    const sid = cookie(req, "nf_sessao");
    if (sid) db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
    res.setHeader("Set-Cookie", "nf_sessao=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    res.json({ ok: true });
  }));

  app.get("/api/auth/me", envolver(async (req, res) => {
    const auth = exigirUsuario(req);
    const usuario = db.prepare("SELECT id, nome, email FROM users WHERE id = ?").get(auth.userId) as { id: string; nome: string; email: string };
    res.json({ ...usuario, empresaId: auth.empresaId });
  }));

  app.get("/api/empresas", envolver(async (req, res) => {
    const auth = exigirUsuario(req);
    const rows = db.prepare("SELECT * FROM empresas WHERE user_id = ? ORDER BY razao_social").all(auth.userId) as EmpresaRow[];
    res.json({ ativaId: auth.empresaId, empresas: rows.map(dtoEmpresa) });
  }));

  app.post("/api/empresas", envolver(async (req, res) => {
    const auth = exigirUsuario(req);
    const dados = lerEmpresaBody(req.body ?? {});
    const id = randomUUID();
    try {
      db.prepare(`INSERT INTO empresas (
        id, user_id, cnpj, razao_social, nome_fantasia, inscricao_municipal, regime, codigo_ibge, municipio, uf,
        logradouro, numero, bairro, cep, email, telefone, focus_empresa_id, certificado_status, certificado_valido_ate, criado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pendente', NULL, ?)`).run(
        id, auth.userId, dados.cnpj, dados.razaoSocial, dados.nomeFantasia, dados.inscricaoMunicipal, dados.regime,
        dados.codigoIbge, dados.municipio, dados.uf, dados.logradouro, dados.numero, dados.bairro, dados.cep,
        dados.email, dados.telefone, new Date().toISOString(),
      );
    } catch {
      throw new HttpError(409, "Esse CNPJ já está neste escritório.");
    }
    const sid = cookie(req, "nf_sessao");
    if (!auth.empresaId && sid) db.prepare("UPDATE sessions SET empresa_id = ? WHERE id = ?").run(id, sid);
    const row = db.prepare("SELECT * FROM empresas WHERE id = ?").get(id) as EmpresaRow;
    res.status(201).json(dtoEmpresa(row));
  }));

  app.patch("/api/empresas/:id", envolver(async (req, res) => {
    const auth = exigirUsuario(req);
    const atual = db.prepare("SELECT * FROM empresas WHERE id = ? AND user_id = ?").get(req.params.id, auth.userId) as EmpresaRow | undefined;
    if (!atual) throw new HttpError(404, "Empresa não encontrada.");
    const dados = lerEmpresaBody({ ...dtoParaBody(atual), ...req.body });
    db.prepare(`UPDATE empresas SET cnpj=?, razao_social=?, nome_fantasia=?, inscricao_municipal=?, regime=?, codigo_ibge=?, municipio=?, logradouro=?, numero=?, bairro=?, cep=?, email=?, telefone=? WHERE id=?`).run(
      dados.cnpj, dados.razaoSocial, dados.nomeFantasia, dados.inscricaoMunicipal, dados.regime, dados.codigoIbge, dados.municipio,
      dados.logradouro, dados.numero, dados.bairro, dados.cep, dados.email, dados.telefone, atual.id,
    );
    res.json(dtoEmpresa(db.prepare("SELECT * FROM empresas WHERE id = ?").get(atual.id) as EmpresaRow));
  }));

  app.post("/api/sessao/empresa", envolver(async (req, res) => {
    const auth = exigirUsuario(req);
    const id = String(req.body?.id ?? "");
    const empresa = db.prepare("SELECT id FROM empresas WHERE id = ? AND user_id = ?").get(id, auth.userId);
    if (!empresa) throw new HttpError(404, "Empresa não encontrada.");
    const sid = cookie(req, "nf_sessao");
    if (!sid) throw new HttpError(401, "Faça login para continuar.");
    db.prepare("UPDATE sessions SET empresa_id = ? WHERE id = ?").run(id, sid);
    res.json({ empresaId: id });
  }));

  app.get("/api/empresas/:id/certificado", envolver(async (req, res) => {
    const auth = exigirUsuario(req);
    const empresa = db.prepare("SELECT * FROM empresas WHERE id = ? AND user_id = ?").get(req.params.id, auth.userId) as EmpresaRow | undefined;
    if (!empresa) throw new HttpError(404, "Empresa não encontrada.");
    res.json({
      certificadoStatus: empresa.certificado_status,
      instrucoes: instrucoesCertificado(empresa, modo),
      empresasApi: Boolean(tokenPrincipal),
    });
  }));

  app.post("/api/empresas/:id/certificado", envolver(async (req, res) => {
    const auth = exigirUsuario(req);
    const empresa = db.prepare("SELECT * FROM empresas WHERE id = ? AND user_id = ?").get(req.params.id, auth.userId) as EmpresaRow | undefined;
    if (!empresa) throw new HttpError(404, "Empresa não encontrada.");
    const manual = req.body?.manual === true;
    if (manual) {
      db.prepare("UPDATE empresas SET certificado_status = 'manual' WHERE id = ?").run(empresa.id);
      res.json({ certificadoStatus: "manual", instrucoes: instrucoesCertificado(empresa, modo) });
      return;
    }
    const arquivo = String(req.body?.arquivoBase64 ?? "");
    const senha = String(req.body?.senha ?? "");
    if (!arquivo || !senha) throw new HttpError(400, "Envie o arquivo .pfx e a senha. Eles não ficam gravados.");
    if (!tokenPrincipal) {
      db.prepare("UPDATE empresas SET certificado_status = 'simulado' WHERE id = ?").run(empresa.id);
      res.json({
        certificadoStatus: "simulado",
        instrucoes: [
          ...instrucoesCertificado(empresa, modo),
          "FOCUS_NFE_TOKEN_PRINCIPAL não está definido, então o arquivo foi descartado e nada foi enviado à Focus.",
        ],
      });
      return;
    }
    const fiscal = empresaFiscal(empresa);
    const flags = flagsEmpresaFocus(fiscal);
    const efetivar = opcoes.empresasEfetivar === true;
    const corpo = {
      nome: empresa.razao_social,
      nome_fantasia: empresa.nome_fantasia,
      cnpj: empresa.cnpj,
      inscricao_municipal: empresa.inscricao_municipal,
      regime_tributario: flags.regime_tributario,
      email: empresa.email,
      logradouro: empresa.logradouro,
      numero: empresa.numero,
      bairro: empresa.bairro,
      cep: empresa.cep,
      municipio: empresa.municipio,
      uf: empresa.uf,
      codigo_municipio: empresa.codigo_ibge,
      habilita_nfse: flags.habilita_nfse,
      habilita_nfsen_homologacao: flags.habilita_nfsen_homologacao,
      habilita_nfsen_producao: false,
      arquivo_certificado_base64: arquivo.replace(/^data:.*?;base64,/, ""),
      senha_certificado: senha,
      certificado_especifico: true,
    };
    const dry = efetivar ? "" : "?dry_run=1";
    const url = empresa.focus_empresa_id
      ? `https://api.focusnfe.com.br/v2/empresas/${encodeURIComponent(empresa.focus_empresa_id)}${dry}`
      : `https://api.focusnfe.com.br/v2/empresas${dry}`;
    const resposta = await chamarFocus({
      url,
      method: empresa.focus_empresa_id ? "PUT" : "POST",
      token: tokenPrincipal,
      body: corpo,
      fetchImpl: opcoes.focusFetch,
      permitirProducaoEmpresas: true,
    });
    if (resposta.statusHttp >= 400) throw new HttpError(422, mensagemFocus(resposta.json));
    const focusId = typeof resposta.json.id === "string" || typeof resposta.json.id === "number" ? String(resposta.json.id) : empresa.focus_empresa_id;
    const validoAte = typeof resposta.json.certificado_valido_ate === "string" ? resposta.json.certificado_valido_ate : null;
    const status = efetivar ? "cadastrado" : "dry_run";
    db.prepare("UPDATE empresas SET certificado_status = ?, focus_empresa_id = ?, certificado_valido_ate = ? WHERE id = ?").run(status, focusId, validoAte, empresa.id);
    res.json({
      certificadoStatus: status,
      focusEmpresaId: focusId,
      validoAte,
      instrucoes: instrucoesCertificado(empresa, modo),
    });
  }));

  app.get("/api/tomadores", envolver(async (req, res) => {
    const { empresa } = exigirEmpresa(req);
    const rows = db.prepare("SELECT * FROM tomadores WHERE empresa_id = ? ORDER BY COALESCE(ultima_nota_em, '') DESC, razao_social").all(empresa.id) as TomadorRow[];
    res.json(rows.map(dtoTomador));
  }));

  app.post("/api/tomadores", envolver(async (req, res) => {
    const { empresa } = exigirEmpresa(req);
    const dados = lerTomadorBody(req.body ?? {});
    const id = randomUUID();
    db.prepare(`INSERT INTO tomadores (
      id, empresa_id, cnpj, cpf, razao_social, email, telefone, logradouro, numero, complemento, bairro, codigo_ibge, municipio, uf, cep, ultima_nota_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
      id, empresa.id, dados.cnpj, dados.cpf, dados.razaoSocial, dados.email, dados.telefone, dados.logradouro, dados.numero,
      dados.complemento, dados.bairro, dados.codigoIbge, dados.municipio, dados.uf, dados.cep,
    );
    res.status(201).json(dtoTomador(db.prepare("SELECT * FROM tomadores WHERE id = ?").get(id) as TomadorRow));
  }));

  app.get("/api/cnpj/:cnpj", envolver(async (req, res) => {
    exigirUsuario(req);
    const cnpj = apenasDigitos(req.params.cnpj);
    if (!cnpjValido(cnpj)) throw new HttpError(400, "CNPJ inválido.");
    let resposta: globalThis.Response;
    try {
      resposta = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal: AbortSignal.timeout(8000) });
    } catch {
      throw new HttpError(502, "Não foi possível consultar o CNPJ agora. Preencha os dados à mão.");
    }
    if (!resposta.ok) throw new HttpError(404, "CNPJ não encontrado na Receita. Preencha os dados à mão.");
    const json = await resposta.json() as Record<string, unknown>;
    res.json({
      cnpj: formatarCnpj(cnpj),
      razaoSocial: json.razao_social ?? "",
      email: json.email ?? "",
      telefone: json.ddd_telefone_1 ?? "",
      logradouro: json.logradouro ?? "",
      numero: json.numero ?? "",
      complemento: json.complemento ?? "",
      bairro: json.bairro ?? "",
      municipio: json.municipio ?? "",
      uf: json.uf ?? "",
      cep: json.cep ?? "",
      codigoIbge: json.codigo_municipio_ibge ? String(json.codigo_municipio_ibge) : "",
    });
  }));

  app.get("/api/servicos", envolver(async (req, res) => {
    const { empresa } = exigirEmpresa(req);
    const rows = db.prepare("SELECT * FROM servicos WHERE empresa_id = ? ORDER BY nome").all(empresa.id) as ServicoRow[];
    res.json(rows.map(dtoServico));
  }));

  app.post("/api/servicos", envolver(async (req, res) => {
    const { empresa } = exigirEmpresa(req);
    const dados = lerServicoBody(req.body ?? {});
    const id = randomUUID();
    db.prepare(`INSERT INTO servicos (
      id, empresa_id, nome, descricao, codigo_lc116, codigo_nacional, codigo_municipal, codigo_nbs, aliquota_iss
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, empresa.id, dados.nome, dados.descricao, dados.codigoLc116, dados.codigoNacional, dados.codigoMunicipal, dados.codigoNbs, dados.aliquotaIss,
    );
    res.status(201).json(dtoServico(db.prepare("SELECT * FROM servicos WHERE id = ?").get(id) as ServicoRow));
  }));

  app.patch("/api/servicos/:id", envolver(async (req, res) => {
    const { empresa } = exigirEmpresa(req);
    const atual = db.prepare("SELECT * FROM servicos WHERE id = ? AND empresa_id = ?").get(req.params.id, empresa.id) as ServicoRow | undefined;
    if (!atual) throw new HttpError(404, "Serviço não encontrado.");
    const dados = lerServicoBody({
      nome: atual.nome,
      descricao: atual.descricao,
      codigoLc116: atual.codigo_lc116,
      codigoMunicipal: atual.codigo_municipal,
      codigoNbs: atual.codigo_nbs,
      aliquotaIss: atual.aliquota_iss,
      ...req.body,
    });
    db.prepare("UPDATE servicos SET nome=?, descricao=?, codigo_lc116=?, codigo_nacional=?, codigo_municipal=?, codigo_nbs=?, aliquota_iss=? WHERE id=?").run(
      dados.nome, dados.descricao, dados.codigoLc116, dados.codigoNacional, dados.codigoMunicipal, dados.codigoNbs, dados.aliquotaIss, atual.id,
    );
    res.json(dtoServico(db.prepare("SELECT * FROM servicos WHERE id = ?").get(atual.id) as ServicoRow));
  }));

  app.post("/api/voz/interpretar", envolver(async (req, res) => {
    const { empresa } = exigirEmpresa(req);
    const texto = String(req.body?.texto ?? "");
    if (!texto.trim()) throw new HttpError(400, "Nada foi dito.");
    const tomadores = db.prepare("SELECT id, razao_social FROM tomadores WHERE empresa_id = ?").all(empresa.id) as { id: string; razao_social: string }[];
    const servicos = db.prepare("SELECT id, nome FROM servicos WHERE empresa_id = ?").all(empresa.id) as { id: string; nome: string }[];
    const rascunho = interpretarNotaFalada(texto, {
      tomadores: tomadores.map((item) => ({ id: item.id, nome: item.razao_social })),
      servicos: servicos.map((item) => ({ id: item.id, nome: item.nome })),
    });
    res.json(rascunho);
  }));

  app.get("/api/notas", envolver(async (req, res) => {
    const { empresa } = exigirEmpresa(req);
    const rows = db.prepare("SELECT * FROM notas WHERE empresa_id = ? ORDER BY criado_em DESC LIMIT 100").all(empresa.id) as NotaRow[];
    res.json(rows.map((nota) => dtoNota(
      nota,
      db.prepare("SELECT * FROM tomadores WHERE id = ?").get(nota.tomador_id) as TomadorRow,
      db.prepare("SELECT * FROM servicos WHERE id = ?").get(nota.servico_id) as ServicoRow,
    )));
  }));

  app.post("/api/notas", envolver(async (req, res) => {
    const { empresa } = exigirEmpresa(req);
    const tomador = db.prepare("SELECT * FROM tomadores WHERE id = ? AND empresa_id = ?").get(String(req.body?.tomadorId ?? ""), empresa.id) as TomadorRow | undefined;
    const servico = db.prepare("SELECT * FROM servicos WHERE id = ? AND empresa_id = ?").get(String(req.body?.servicoId ?? ""), empresa.id) as ServicoRow | undefined;
    if (!tomador || !servico) throw new HttpError(400, "Escolha o cliente e o serviço.");
    const valor = Number(req.body?.valor);
    if (!Number.isFinite(valor) || valor <= 0) throw new HttpError(400, "Informe um valor maior que zero.");
    const issRetido = req.body?.issRetido === true;
    const enviarEmail = req.body?.enviarEmail !== false;
    const descricao = String(req.body?.descricao ?? servico.descricao).trim() || servico.descricao;
    let emissao;
    try {
      emissao = montarEmissao({
        empresa: empresaFiscal(empresa),
        tomador: {
          cnpj: tomador.cnpj,
          cpf: tomador.cpf,
          razaoSocial: tomador.razao_social,
          email: enviarEmail ? tomador.email : null,
          telefone: tomador.telefone,
          logradouro: tomador.logradouro,
          numero: tomador.numero,
          complemento: tomador.complemento,
          bairro: tomador.bairro,
          codigoIbge: tomador.codigo_ibge,
          uf: tomador.uf,
          cep: tomador.cep,
        },
        servico: {
          nome: servico.nome,
          descricao: servico.descricao,
          codigoNacional: servico.codigo_nacional,
          codigoMunicipal: servico.codigo_municipal,
          codigoNbs: servico.codigo_nbs,
          aliquotaIss: servico.aliquota_iss,
        },
        valor,
        issRetido,
        descricao,
      });
    } catch (erro) {
      throw new HttpError(400, erro instanceof Error ? erro.message : "Não foi possível montar a nota.");
    }
    const { valorIss } = calcularIss(valor, servico.aliquota_iss, issRetido);
    const id = randomUUID();
    const ref = `nf${randomBytes(6).toString("hex")}`;
    const agora = new Date().toISOString();
    const payload = {
      caminho: emissao.caminho,
      endpoint: emissao.endpoint,
      provedor: emissao.provedor,
      habilitarAmbienteNacional: emissao.habilitarAmbienteNacional,
      body: emissao.body,
    };
    db.prepare(`INSERT INTO notas (
      id, empresa_id, tomador_id, servico_id, ref, caminho, status, valor, aliquota_iss, valor_iss, iss_retido,
      descricao, enviar_email, numero, codigo_verificacao, url_consulta, url_pdf, caminho_xml, xml_local, pdf_base64,
      erros, payload, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, 'processando_autorizacao', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`).run(
      id, empresa.id, tomador.id, servico.id, ref, emissao.caminho, valor, servico.aliquota_iss, valorIss, issRetido ? 1 : 0,
      descricao, enviarEmail ? 1 : 0, JSON.stringify(payload), agora, agora,
    );

    if (modo === "mock") {
      res.status(201).json(dtoNota(db.prepare("SELECT * FROM notas WHERE id = ?").get(id) as NotaRow, tomador, servico));
      return;
    }

    const pedido = requisicaoEmissao(ref, emissao.body);
    try {
      const resposta = await chamarFocus({ url: pedido.url, method: pedido.method, token, body: pedido.body, fetchImpl: opcoes.focusFetch });
      aplicarRetorno(id, resposta.json, resposta.statusHttp < 400 ? String(resposta.json.status ?? "processando_autorizacao") : "erro_autorizacao");
      if (resposta.statusHttp >= 400) {
        db.prepare("UPDATE notas SET erros = ?, status = 'erro_autorizacao', atualizado_em = ? WHERE id = ?").run(
          JSON.stringify(resposta.json), new Date().toISOString(), id,
        );
      }
    } catch (erro) {
      db.prepare("UPDATE notas SET status = 'erro_autorizacao', erros = ?, atualizado_em = ? WHERE id = ?").run(
        JSON.stringify({ mensagem: erro instanceof Error ? erro.message : "Falha ao falar com a Focus." }),
        new Date().toISOString(),
        id,
      );
    }
    res.status(201).json(dtoNota(
      db.prepare("SELECT * FROM notas WHERE id = ?").get(id) as NotaRow,
      tomador,
      servico,
    ));
  }));

  app.get("/api/notas/:id", envolver(async (req, res) => {
    const { empresa } = exigirEmpresa(req);
    const nota = db.prepare("SELECT * FROM notas WHERE id = ? AND empresa_id = ?").get(req.params.id, empresa.id) as NotaRow | undefined;
    if (!nota) throw new HttpError(404, "Nota não encontrada.");
    if (nota.status === "processando_autorizacao") {
      if (modo === "mock") autorizarMock(nota.id);
      else {
        const pedido = requisicaoConsulta(nota.ref);
        const resposta = await chamarFocus({ url: pedido.url, method: "GET", token, fetchImpl: opcoes.focusFetch });
        if (resposta.statusHttp < 400 && typeof resposta.json.status === "string") aplicarRetorno(nota.id, resposta.json, resposta.json.status);
      }
    }
    const atual = db.prepare("SELECT * FROM notas WHERE id = ?").get(nota.id) as NotaRow;
    res.json(dtoNota(
      atual,
      db.prepare("SELECT * FROM tomadores WHERE id = ?").get(atual.tomador_id) as TomadorRow,
      db.prepare("SELECT * FROM servicos WHERE id = ?").get(atual.servico_id) as ServicoRow,
    ));
  }));

  app.post("/api/notas/:id/cancelar", envolver(async (req, res) => {
    const { empresa } = exigirEmpresa(req);
    const nota = db.prepare("SELECT * FROM notas WHERE id = ? AND empresa_id = ?").get(req.params.id, empresa.id) as NotaRow | undefined;
    if (!nota) throw new HttpError(404, "Nota não encontrada.");
    if (nota.status !== "autorizado") throw new HttpError(400, "Só uma nota autorizada pode ser cancelada.");
    const justificativa = String(req.body?.justificativa ?? "").trim();
    if (justificativa.length < 15 || justificativa.length > 255) {
      throw new HttpError(400, "A justificativa precisa ter entre 15 e 255 caracteres.");
    }
    if (modo === "mock") {
      db.prepare("UPDATE notas SET status = 'cancelado', atualizado_em = ? WHERE id = ?").run(new Date().toISOString(), nota.id);
    } else {
      const pedido = requisicaoCancelamento(nota.ref, justificativa);
      const resposta = await chamarFocus({ url: pedido.url, method: "DELETE", token, body: pedido.body, fetchImpl: opcoes.focusFetch });
      if (resposta.statusHttp >= 400) throw new HttpError(422, mensagemFocus(resposta.json));
      aplicarRetorno(nota.id, resposta.json, String(resposta.json.status ?? "cancelado"));
    }
    const atual = db.prepare("SELECT * FROM notas WHERE id = ?").get(nota.id) as NotaRow;
    res.json(dtoNota(atual, db.prepare("SELECT * FROM tomadores WHERE id = ?").get(atual.tomador_id) as TomadorRow, db.prepare("SELECT * FROM servicos WHERE id = ?").get(atual.servico_id) as ServicoRow));
  }));

  app.get("/api/notas/:id/pdf", envolver(async (req, res) => {
    const arquivo = await baixar(req, "pdf");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="nfse-${arquivo.nome}.pdf"`);
    res.send(arquivo.buffer);
  }));

  app.get("/api/notas/:id/xml", envolver(async (req, res) => {
    const arquivo = await baixar(req, "xml");
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="nfse-${arquivo.nome}.xml"`);
    res.send(arquivo.buffer);
  }));

  app.post("/api/webhooks/focus", envolver(async (req, res) => {
    if (!opcoes.webhookSecret) throw new HttpError(401, "Defina FOCUS_WEBHOOK_SECRET para receber o webhook.");
    const recebido = String(req.header("authorization") ?? "");
    if (recebido !== opcoes.webhookSecret && recebido !== `Bearer ${opcoes.webhookSecret}`) {
      throw new HttpError(401, "Webhook não autorizado.");
    }
    const ref = String(req.body?.ref ?? "");
    const nota = db.prepare("SELECT * FROM notas WHERE ref = ?").get(ref) as NotaRow | undefined;
    if (!nota) throw new HttpError(404, "Nota não encontrada para essa referência.");
    const status = typeof req.body?.status === "string" ? req.body.status : nota.status;
    aplicarRetorno(nota.id, req.body ?? {}, status);
    res.json({ ok: true });
  }));

  async function baixar(req: Request, tipo: "pdf" | "xml"): Promise<{ buffer: Buffer; nome: string }> {
    const { empresa } = exigirEmpresa(req);
    let nota = db.prepare("SELECT * FROM notas WHERE id = ? AND empresa_id = ?").get(req.params.id, empresa.id) as NotaRow | undefined;
    if (!nota) throw new HttpError(404, "Nota não encontrada.");
    if (nota.status === "processando_autorizacao" && modo === "mock") {
      autorizarMock(nota.id);
      nota = db.prepare("SELECT * FROM notas WHERE id = ?").get(nota.id) as NotaRow;
    }
    const nome = nota.numero ?? nota.ref;
    if (tipo === "pdf" && nota.pdf_base64) return { buffer: Buffer.from(nota.pdf_base64, "base64"), nome };
    if (tipo === "xml" && nota.xml_local) return { buffer: Buffer.from(nota.xml_local, "utf8"), nome };
    const remoto = tipo === "pdf" ? nota.url_pdf : nota.caminho_xml;
    if (!remoto || modo === "mock") throw new HttpError(404, tipo === "pdf" ? "PDF ainda não está disponível." : "XML ainda não está disponível.");
    const url = urlArquivoFocus(remoto);
    const fetchImpl = opcoes.focusFetch;
    const resposta = fetchImpl
      ? await fetchImpl(url, { method: "GET", headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}` } })
      : await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}` } }).then(async (item) => ({ status: item.status, text: Buffer.from(await item.arrayBuffer()).toString("binary") }));
    if (resposta.status >= 400) throw new HttpError(502, "A Focus não devolveu o arquivo.");
    return { buffer: Buffer.from(resposta.text, "binary"), nome };
  }

  function autorizarMock(id: string) {
    const nota = db.prepare("SELECT * FROM notas WHERE id = ?").get(id) as NotaRow;
    if (nota.status !== "processando_autorizacao") return;
    const empresa = db.prepare("SELECT * FROM empresas WHERE id = ?").get(nota.empresa_id) as EmpresaRow;
    const tomador = db.prepare("SELECT * FROM tomadores WHERE id = ?").get(nota.tomador_id) as TomadorRow;
    const sequencia = (db.prepare("SELECT COUNT(*) AS n FROM notas WHERE empresa_id = ?").get(empresa.id) as { n: number }).n + 1042;
    const numero = String(sequencia).padStart(6, "0");
    const codigo = randomBytes(4).toString("hex").toUpperCase();
    const xml = xmlDemonstracao({
      numero,
      ref: nota.ref,
      prestador: empresa.razao_social,
      cnpjPrestador: empresa.cnpj,
      tomador: tomador.razao_social,
      cnpjTomador: tomador.cnpj ?? "",
      descricao: nota.descricao,
      valor: nota.valor,
      caminho: nota.caminho,
      codigoVerificacao: codigo,
    });
    const pdf = pdfDemonstracao(linhasPdf({
      numero,
      prestador: empresa.razao_social,
      tomador: tomador.razao_social,
      descricao: nota.descricao,
      valor: nota.valor,
      caminho: nota.caminho,
      status: "autorizado",
    }));
    const agora = new Date().toISOString();
    db.prepare(`UPDATE notas SET status='autorizado', numero=?, codigo_verificacao=?, xml_local=?, pdf_base64=?, atualizado_em=? WHERE id=?`).run(
      numero, codigo, xml, pdf.toString("base64"), agora, id,
    );
    db.prepare("UPDATE tomadores SET ultima_nota_em = ? WHERE id = ?").run(agora, tomador.id);
  }

  function aplicarRetorno(id: string, json: Record<string, unknown>, status: string) {
    const agora = new Date().toISOString();
    db.prepare(`UPDATE notas SET status=?, numero=COALESCE(?, numero), codigo_verificacao=COALESCE(?, codigo_verificacao),
      url_consulta=COALESCE(?, url_consulta), url_pdf=COALESCE(?, url_pdf), caminho_xml=COALESCE(?, caminho_xml),
      erros=?, atualizado_em=? WHERE id=?`).run(
      status,
      typeof json.numero === "string" ? json.numero : null,
      typeof json.codigo_verificacao === "string" ? json.codigo_verificacao : null,
      typeof json.url === "string" ? json.url : null,
      typeof json.url_danfse === "string" ? json.url_danfse : null,
      typeof json.caminho_xml_nota_fiscal === "string" ? json.caminho_xml_nota_fiscal : null,
      json.erros ? JSON.stringify(json.erros) : null,
      agora,
      id,
    );
    if (status === "autorizado") {
      const nota = db.prepare("SELECT tomador_id FROM notas WHERE id = ?").get(id) as { tomador_id: string };
      db.prepare("UPDATE tomadores SET ultima_nota_em = ? WHERE id = ?").run(agora, nota.tomador_id);
    }
  }

  app.use("/api", (_req, res) => {
    res.status(404).json({ erro: "Recurso não encontrado." });
  });

  app.use((erro: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (erro instanceof HttpError) {
      res.status(erro.status).json({ erro: erro.message });
      return;
    }
    console.error(erro);
    res.status(500).json({ erro: "Erro interno." });
  });

  if (opcoes.client !== false) {
    if (process.env.NODE_ENV === "production") {
      const pasta = path.join(RAIZ, "dist/client");
      app.use(express.static(pasta));
      app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api")) return next();
        res.sendFile(path.join(pasta, "index.html"));
      });
    } else {
      const { createServer } = await import("vite");
      const vite = await createServer({
        configFile: path.join(RAIZ, "vite.config.ts"),
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    }
  }

  return app;
}

function dtoParaBody(empresa: EmpresaRow) {
  return {
    cnpj: empresa.cnpj,
    razaoSocial: empresa.razao_social,
    nomeFantasia: empresa.nome_fantasia,
    inscricaoMunicipal: empresa.inscricao_municipal,
    regime: empresa.regime,
    codigoIbge: empresa.codigo_ibge,
    municipio: empresa.municipio,
    logradouro: empresa.logradouro,
    numero: empresa.numero,
    bairro: empresa.bairro,
    cep: empresa.cep,
    email: empresa.email,
    telefone: empresa.telefone,
  };
}

export function carregarEnv(arquivo: string) {
  if (!existsSync(arquivo)) return;
  for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
    const texto = linha.trim();
    if (!texto || texto.startsWith("#")) continue;
    const indice = texto.indexOf("=");
    if (indice < 0) continue;
    const chave = texto.slice(0, indice).trim();
    let valor = texto.slice(indice + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (process.env[chave] === undefined) process.env[chave] = valor;
  }
}
