import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bytesParaBase64, linhasPdf, pdfDemonstracao, xmlDemonstracao } from "../domain/documento.js";
import { codigoNacionalIss, gerarCnpj } from "../domain/format.js";

export type Usuario = { id: string; nome: string; email: string; senha_hash: string };
export type EmpresaRow = {
  id: string;
  user_id: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  inscricao_municipal: string;
  regime: string;
  codigo_ibge: string;
  municipio: string;
  uf: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cep: string;
  email: string | null;
  telefone: string | null;
  focus_empresa_id: string | null;
  certificado_status: string;
  certificado_valido_ate: string | null;
  criado_em: string;
};
export type TomadorRow = {
  id: string;
  empresa_id: string;
  cnpj: string | null;
  cpf: string | null;
  razao_social: string;
  email: string | null;
  telefone: string | null;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  codigo_ibge: string;
  municipio: string;
  uf: string;
  cep: string;
  ultima_nota_em: string | null;
};
export type ServicoRow = {
  id: string;
  empresa_id: string;
  nome: string;
  descricao: string;
  codigo_lc116: string;
  codigo_nacional: string;
  codigo_municipal: string | null;
  codigo_nbs: string | null;
  aliquota_iss: number;
};
export type NotaRow = {
  id: string;
  empresa_id: string;
  tomador_id: string;
  servico_id: string;
  ref: string;
  caminho: string;
  status: string;
  valor: number;
  aliquota_iss: number;
  valor_iss: number;
  iss_retido: number;
  descricao: string;
  enviar_email: number;
  numero: string | null;
  codigo_verificacao: string | null;
  url_consulta: string | null;
  url_pdf: string | null;
  caminho_xml: string | null;
  xml_local: string | null;
  pdf_base64: string | null;
  erros: string | null;
  payload: string;
  criado_em: string;
  atualizado_em: string;
};

export function hashSenha(senha: string): string {
  const sal = randomBytes(16).toString("hex");
  const hash = scryptSync(senha, sal, 32).toString("hex");
  return `scrypt$${sal}$${hash}`;
}

export function verificaSenha(senha: string, armazenada: string): boolean {
  const [algo, sal, hash] = armazenada.split("$");
  if (algo !== "scrypt" || !sal || !hash) return false;
  const calculado = scryptSync(senha, sal, 32);
  const esperado = Buffer.from(hash, "hex");
  if (calculado.length !== esperado.length) return false;
  return timingSafeEqual(calculado, esperado);
}

export function abrirBanco(arquivo: string): DatabaseSync {
  mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      criado_em TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      empresa_id TEXT,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS empresas (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      cnpj TEXT NOT NULL,
      razao_social TEXT NOT NULL,
      nome_fantasia TEXT,
      inscricao_municipal TEXT NOT NULL,
      regime TEXT NOT NULL,
      codigo_ibge TEXT NOT NULL,
      municipio TEXT NOT NULL,
      uf TEXT NOT NULL,
      logradouro TEXT NOT NULL,
      numero TEXT NOT NULL,
      bairro TEXT NOT NULL,
      cep TEXT NOT NULL,
      email TEXT,
      telefone TEXT,
      focus_empresa_id TEXT,
      certificado_status TEXT NOT NULL DEFAULT 'pendente',
      certificado_valido_ate TEXT,
      criado_em TEXT NOT NULL,
      UNIQUE (user_id, cnpj)
    );
    CREATE TABLE IF NOT EXISTS tomadores (
      id TEXT PRIMARY KEY,
      empresa_id TEXT NOT NULL,
      cnpj TEXT,
      cpf TEXT,
      razao_social TEXT NOT NULL,
      email TEXT,
      telefone TEXT,
      logradouro TEXT NOT NULL,
      numero TEXT NOT NULL,
      complemento TEXT,
      bairro TEXT NOT NULL,
      codigo_ibge TEXT NOT NULL,
      municipio TEXT NOT NULL,
      uf TEXT NOT NULL,
      cep TEXT NOT NULL,
      ultima_nota_em TEXT
    );
    CREATE TABLE IF NOT EXISTS servicos (
      id TEXT PRIMARY KEY,
      empresa_id TEXT NOT NULL,
      nome TEXT NOT NULL,
      descricao TEXT NOT NULL,
      codigo_lc116 TEXT NOT NULL,
      codigo_nacional TEXT NOT NULL,
      codigo_municipal TEXT,
      codigo_nbs TEXT,
      aliquota_iss REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notas (
      id TEXT PRIMARY KEY,
      empresa_id TEXT NOT NULL,
      tomador_id TEXT NOT NULL,
      servico_id TEXT NOT NULL,
      ref TEXT NOT NULL UNIQUE,
      caminho TEXT NOT NULL,
      status TEXT NOT NULL,
      valor REAL NOT NULL,
      aliquota_iss REAL NOT NULL,
      valor_iss REAL NOT NULL,
      iss_retido INTEGER NOT NULL,
      descricao TEXT NOT NULL,
      enviar_email INTEGER NOT NULL,
      numero TEXT,
      codigo_verificacao TEXT,
      url_consulta TEXT,
      url_pdf TEXT,
      caminho_xml TEXT,
      xml_local TEXT,
      pdf_base64 TEXT,
      erros TEXT,
      payload TEXT NOT NULL,
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );
  `);
  semear(db);
  return db;
}

function semear(db: DatabaseSync) {
  const existe = db.prepare("SELECT id FROM users WHERE email = ?").get("contador@notafacil.local") as { id: string } | undefined;
  if (existe) return;

  const agora = new Date();
  const ontem = new Date(agora.getTime() - 26 * 60 * 60 * 1000).toISOString();
  const userId = "user-demo";
  db.prepare("INSERT INTO users (id, nome, email, senha_hash, criado_em) VALUES (?, ?, ?, ?, ?)").run(
    userId,
    "Escritório Contábil",
    "contador@notafacil.local",
    hashSenha("notafacil"),
    agora.toISOString(),
  );

  const empresas = [
    empresaSeed({
      id: "emp-simples",
      cnpj: gerarCnpj("111111110001"),
      razao: "Limpeza Fácil Serviços ME",
      fantasia: "Limpeza Fácil",
      im: "100200",
      regime: "simples_nacional",
      ibge: "5201108",
      municipio: "Anápolis",
      logradouro: "Rua Exemplo",
      numero: "100",
      bairro: "Centro",
      cep: "75000010",
    }),
    empresaSeed({
      id: "emp-goiania",
      cnpj: gerarCnpj("222222220001"),
      razao: "Alfa Engenharia Ltda",
      fantasia: "Alfa Engenharia",
      im: "304050",
      regime: "lucro_presumido",
      ibge: "5208707",
      municipio: "Goiânia",
      logradouro: "Avenida Exemplo",
      numero: "500",
      bairro: "Setor Central",
      cep: "74000010",
    }),
    empresaSeed({
      id: "emp-mei",
      cnpj: gerarCnpj("333333330001"),
      razao: "João Reparos MEI",
      fantasia: "João Reparos",
      im: "908070",
      regime: "mei",
      ibge: "5201405",
      municipio: "Aparecida de Goiânia",
      logradouro: "Rua das Palmeiras",
      numero: "20",
      bairro: "Setor Garavelo",
      cep: "74900010",
    }),
  ];

  const nascida = (offset: number) => new Date(agora.getTime() + offset * 1000).toISOString();
  const inserirEmpresa = db.prepare(`INSERT INTO empresas (
    id, user_id, cnpj, razao_social, nome_fantasia, inscricao_municipal, regime, codigo_ibge, municipio, uf,
    logradouro, numero, bairro, cep, email, telefone, focus_empresa_id, certificado_status, certificado_valido_ate, criado_em
  ) VALUES (
    @id, @user_id, @cnpj, @razao_social, @nome_fantasia, @inscricao_municipal, @regime, @codigo_ibge, @municipio, 'GO',
    @logradouro, @numero, @bairro, @cep, @email, NULL, NULL, 'pendente', NULL, @criado_em
  )`);

  empresas.forEach((empresa, indice) => {
    inserirEmpresa.run({ ...empresa, user_id: userId, criado_em: nascida(indice) });
    semearCatalogo(db, empresa.id, ontem);
  });

  const tomador = db.prepare("SELECT id FROM tomadores WHERE empresa_id = ? AND razao_social LIKE 'Empresa Exemplo%'").get("emp-simples") as { id: string };
  const servico = db.prepare("SELECT id, aliquota_iss, descricao, codigo_nacional FROM servicos WHERE empresa_id = ? AND nome LIKE 'Consultoria%'").get("emp-simples") as {
    id: string;
    aliquota_iss: number;
    descricao: string;
    codigo_nacional: string;
  };
  const empresaDemo = db.prepare("SELECT razao_social, cnpj FROM empresas WHERE id = 'emp-simples'").get() as { razao_social: string; cnpj: string };
  const tomadorDemo = db.prepare("SELECT razao_social, cnpj FROM tomadores WHERE id = ?").get(tomador.id) as { razao_social: string; cnpj: string };
  const xmlDemo = xmlDemonstracao({
    numero: "0001042",
    ref: "nfdemo000001",
    prestador: empresaDemo.razao_social,
    cnpjPrestador: empresaDemo.cnpj,
    tomador: tomadorDemo.razao_social,
    cnpjTomador: tomadorDemo.cnpj,
    descricao: servico.descricao,
    valor: 2000,
    caminho: "emissor_nacional",
    codigoVerificacao: "DEMO1042",
  });
  const pdfDemo = pdfDemonstracao(linhasPdf({
    numero: "0001042",
    prestador: empresaDemo.razao_social,
    tomador: tomadorDemo.razao_social,
    descricao: servico.descricao,
    valor: 2000,
    caminho: "emissor_nacional",
    status: "autorizado",
  }));
  const pdfDemo64 = bytesParaBase64(pdfDemo);
  db.prepare(`INSERT INTO notas (
    id, empresa_id, tomador_id, servico_id, ref, caminho, status, valor, aliquota_iss, valor_iss, iss_retido,
    descricao, enviar_email, numero, codigo_verificacao, url_consulta, url_pdf, caminho_xml, xml_local, pdf_base64,
    erros, payload, criado_em, atualizado_em
  ) VALUES (
    'nota-demo', 'emp-simples', ?, ?, 'nfdemo000001', 'emissor_nacional', 'autorizado', 2000, ?, 100, 0,
    ?, 1, '0001042', 'DEMO1042', NULL, NULL, NULL, ?, ?,
    NULL, ?, ?, ?
  )`).run(tomador.id, servico.id, servico.aliquota_iss, servico.descricao, xmlDemo, pdfDemo64, JSON.stringify({ demonstracao: true, codigo_tributacao_nacional_iss: servico.codigo_nacional }), ontem, ontem);
  db.prepare("UPDATE tomadores SET ultima_nota_em = ? WHERE id = ?").run(ontem, tomador.id);
}

function empresaSeed(dados: {
  id: string;
  cnpj: string;
  razao: string;
  fantasia: string;
  im: string;
  regime: string;
  ibge: string;
  municipio: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cep: string;
}) {
  return {
    id: dados.id,
    cnpj: dados.cnpj,
    razao_social: dados.razao,
    nome_fantasia: dados.fantasia,
    inscricao_municipal: dados.im,
    regime: dados.regime,
    codigo_ibge: dados.ibge,
    municipio: dados.municipio,
    logradouro: dados.logradouro,
    numero: dados.numero,
    bairro: dados.bairro,
    cep: dados.cep,
    email: "fiscal@escritorio.example",
  };
}

function semearCatalogo(db: DatabaseSync, empresaId: string, ontem: string) {
  const tomadores = [
    {
      id: `${empresaId}-tom-x`,
      cnpj: gerarCnpj("444444440001"),
      razao_social: "Construtora X Ltda",
      email: "financeiro@construtorax.example",
      logradouro: "Rua da Obra",
      numero: "1500",
      bairro: "Setor Bueno",
      codigo_ibge: "5208707",
      municipio: "Goiânia",
      cep: "74210010",
      ultima_nota_em: null as string | null,
    },
    {
      id: `${empresaId}-tom-ex`,
      cnpj: gerarCnpj("555555550001"),
      razao_social: "Empresa Exemplo Ltda",
      email: "financeiro@exemplo.example",
      logradouro: "Rua do Comércio",
      numero: "40",
      bairro: "Centro",
      codigo_ibge: "5201108",
      municipio: "Anápolis",
      cep: "75010010",
      ultima_nota_em: empresaId === "emp-simples" ? ontem : null,
    },
  ];
  const inserirTomador = db.prepare(`INSERT INTO tomadores (
    id, empresa_id, cnpj, cpf, razao_social, email, telefone, logradouro, numero, complemento, bairro,
    codigo_ibge, municipio, uf, cep, ultima_nota_em
  ) VALUES (
    @id, @empresa_id, @cnpj, NULL, @razao_social, @email, '6230000000', @logradouro, @numero, NULL, @bairro,
    @codigo_ibge, @municipio, 'GO', @cep, @ultima_nota_em
  )`);
  for (const tomador of tomadores) inserirTomador.run({ ...tomador, empresa_id: empresaId });

  const servicos = [
    servico("limpeza", "Limpeza pós-obra", "Limpeza e conservação do imóvel depois da obra.", "07.10", "710", 5),
    servico("consultoria", "Consultoria empresarial", "Consultoria em gestão e processos.", "17.01", "1701", 5),
    servico("suporte", "Suporte técnico mensal", "Suporte e manutenção de sistemas.", "01.07", "107", 2),
  ];
  const inserirServico = db.prepare(`INSERT INTO servicos (
    id, empresa_id, nome, descricao, codigo_lc116, codigo_nacional, codigo_municipal, codigo_nbs, aliquota_iss
  ) VALUES (
    @id, @empresa_id, @nome, @descricao, @codigo_lc116, @codigo_nacional, @codigo_municipal, NULL, @aliquota_iss
  )`);
  for (const item of servicos) {
    inserirServico.run({
      id: `${empresaId}-srv-${item.slug}`,
      empresa_id: empresaId,
      nome: item.nome,
      descricao: item.descricao,
      codigo_lc116: item.codigo_lc116,
      codigo_nacional: codigoNacionalIss(item.codigo_lc116),
      codigo_municipal: item.codigo_municipal,
      aliquota_iss: item.aliquota_iss,
    });
  }
}

function servico(slug: string, nome: string, descricao: string, codigo_lc116: string, codigo_municipal: string, aliquota_iss: number) {
  return { slug, nome, descricao, codigo_lc116, codigo_municipal, aliquota_iss };
}
