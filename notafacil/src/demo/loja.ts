import { bytesParaBase64, linhasPdf, pdfDemonstracao, xmlDemonstracao } from "../domain/documento.js";
import { LABEL_REGIME, montarEmissao, resolverCaminho, type Regime } from "../domain/emissao.js";
import {
  apenasDigitos,
  calcularIss,
  cnpjValido,
  codigoNacionalIss,
  formatarCnpj,
  formatarLc116,
  gerarCnpj,
  quandoRelativo,
} from "../domain/format.js";
import { MUNICIPIOS_GO, nomeMunicipio } from "../domain/municipios.js";
import { interpretarNotaFalada } from "../domain/voz.js";

const CHAVE = "notafacil-demo-v1";

export type Kv = {
  get(chave: string): string | null;
  set(chave: string, valor: string): void;
};

export type RespostaDemo = {
  status: number;
  json: unknown;
  arquivo?: { nome: string; contentType: string; bytes: Uint8Array };
};

type Usuario = { id: string; nome: string; email: string; senhaHash: string; criadoEm: string };
type Empresa = {
  id: string;
  userId: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  inscricaoMunicipal: string;
  regime: Regime;
  codigoIbge: string;
  municipio: string;
  uf: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cep: string;
  email: string | null;
  telefone: string | null;
  certificadoStatus: string;
  criadoEm: string;
};
type Tomador = {
  id: string;
  empresaId: string;
  cnpj: string | null;
  cpf: string | null;
  razaoSocial: string;
  email: string | null;
  telefone: string | null;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  codigoIbge: string;
  municipio: string;
  uf: string;
  cep: string;
  ultimaNotaEm: string | null;
};
type Servico = {
  id: string;
  empresaId: string;
  nome: string;
  descricao: string;
  codigoLc116: string;
  codigoNacional: string;
  codigoMunicipal: string | null;
  codigoNbs: string | null;
  aliquotaIss: number;
};
type Nota = {
  id: string;
  empresaId: string;
  tomadorId: string;
  servicoId: string;
  ref: string;
  caminho: string;
  status: string;
  valor: number;
  aliquotaIss: number;
  valorIss: number;
  issRetido: boolean;
  descricao: string;
  enviarEmail: boolean;
  numero: string | null;
  codigoVerificacao: string | null;
  xml: string | null;
  pdfBase64: string | null;
  erros: string | null;
  payload: string;
  criadoEm: string;
  atualizadoEm: string;
};
type Sessao = { userId: string; empresaId: string | null; expiresAt: string };
type Estado = {
  usuarios: Usuario[];
  sessao: Sessao | null;
  empresas: Empresa[];
  tomadores: Tomador[];
  servicos: Servico[];
  notas: Nota[];
};

class DemoErro extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function memoriaKv(inicial: Record<string, string> = {}): Kv {
  const dados = new Map(Object.entries(inicial));
  return {
    get: (chave) => dados.get(chave) ?? null,
    set: (chave, valor) => { dados.set(chave, valor); },
  };
}

export function kvNavegador(): Kv {
  return {
    get: (chave) => localStorage.getItem(chave),
    set: (chave, valor) => localStorage.setItem(chave, valor),
  };
}

let lojaNavegador: ReturnType<typeof criarLoja> | null = null;

export function despacharDemo(method: string, caminho: string, body?: unknown): Promise<RespostaDemo> {
  if (!lojaNavegador) lojaNavegador = criarLoja(kvNavegador());
  return lojaNavegador.despachar({ method, caminho, body });
}

export function criarLoja(kv: Kv, opcoes: { fetchCnpj?: typeof fetch } = {}) {
  let semente: Promise<void> | null = null;

  function carregar(): Estado {
    const bruto = kv.get(CHAVE);
    if (!bruto) return vazio();
    try {
      const estado = JSON.parse(bruto) as Estado;
      return {
        usuarios: estado.usuarios ?? [],
        sessao: estado.sessao ?? null,
        empresas: estado.empresas ?? [],
        tomadores: estado.tomadores ?? [],
        servicos: estado.servicos ?? [],
        notas: estado.notas ?? [],
      };
    } catch {
      return vazio();
    }
  }

  function gravar(estado: Estado) {
    kv.set(CHAVE, JSON.stringify(estado));
  }

  async function garantir(): Promise<Estado> {
    if (!semente) semente = semearSePreciso().catch((erro) => { semente = null; throw erro; });
    await semente;
    if (!carregar().usuarios.some((usuario) => usuario.email === "contador@notafacil.local")) {
      semente = semearSePreciso().catch((erro) => { semente = null; throw erro; });
      await semente;
    }
    return carregar();
  }

  async function semearSePreciso() {
    const estado = carregar();
    if (estado.usuarios.some((usuario) => usuario.email === "contador@notafacil.local")) return;
    const agora = new Date();
    const ontem = new Date(agora.getTime() - 26 * 60 * 60 * 1000).toISOString();
    estado.usuarios.push({
      id: "user-demo",
      nome: "Escritório Contábil",
      email: "contador@notafacil.local",
      senhaHash: await hashSenha("notafacil"),
      criadoEm: agora.toISOString(),
    });
    const empresasSeed: Array<Omit<Empresa, "userId" | "uf" | "email" | "telefone" | "certificadoStatus" | "criadoEm">> = [
      {
        id: "emp-simples", cnpj: gerarCnpj("111111110001"), razaoSocial: "Limpeza Fácil Serviços ME", nomeFantasia: "Limpeza Fácil",
        inscricaoMunicipal: "100200", regime: "simples_nacional", codigoIbge: "5201108", municipio: "Anápolis",
        logradouro: "Rua Exemplo", numero: "100", bairro: "Centro", cep: "75000010",
      },
      {
        id: "emp-goiania", cnpj: gerarCnpj("222222220001"), razaoSocial: "Alfa Engenharia Ltda", nomeFantasia: "Alfa Engenharia",
        inscricaoMunicipal: "304050", regime: "lucro_presumido", codigoIbge: "5208707", municipio: "Goiânia",
        logradouro: "Avenida Exemplo", numero: "500", bairro: "Setor Central", cep: "74000010",
      },
      {
        id: "emp-mei", cnpj: gerarCnpj("333333330001"), razaoSocial: "João Reparos MEI", nomeFantasia: "João Reparos",
        inscricaoMunicipal: "908070", regime: "mei", codigoIbge: "5201405", municipio: "Aparecida de Goiânia",
        logradouro: "Rua das Palmeiras", numero: "20", bairro: "Setor Garavelo", cep: "74900010",
      },
    ];
    empresasSeed.forEach((empresa, indice) => {
      estado.empresas.push({
        ...empresa,
        userId: "user-demo",
        uf: "GO",
        email: "fiscal@escritorio.example",
        telefone: null,
        certificadoStatus: "pendente",
        criadoEm: new Date(agora.getTime() + indice * 1000).toISOString(),
      });
      semearCatalogo(estado, empresa.id, ontem);
    });
    const tomador = estado.tomadores.find((item) => item.empresaId === "emp-simples" && item.razaoSocial.startsWith("Empresa Exemplo"));
    const servico = estado.servicos.find((item) => item.empresaId === "emp-simples" && item.nome.startsWith("Consultoria"));
    const empresa = estado.empresas.find((item) => item.id === "emp-simples");
    if (tomador && servico && empresa) {
      const xml = xmlDemonstracao({
        numero: "0001042",
        ref: "nfdemo000001",
        prestador: empresa.razaoSocial,
        cnpjPrestador: empresa.cnpj,
        tomador: tomador.razaoSocial,
        cnpjTomador: tomador.cnpj ?? "",
        descricao: servico.descricao,
        valor: 2000,
        caminho: "emissor_nacional",
        codigoVerificacao: "DEMO1042",
      });
      const pdf = bytesParaBase64(pdfDemonstracao(linhasPdf({
        numero: "0001042",
        prestador: empresa.razaoSocial,
        tomador: tomador.razaoSocial,
        descricao: servico.descricao,
        valor: 2000,
        caminho: "emissor_nacional",
        status: "autorizado",
      })));
      estado.notas.push({
        id: "nota-demo",
        empresaId: empresa.id,
        tomadorId: tomador.id,
        servicoId: servico.id,
        ref: "nfdemo000001",
        caminho: "emissor_nacional",
        status: "autorizado",
        valor: 2000,
        aliquotaIss: servico.aliquotaIss,
        valorIss: 100,
        issRetido: false,
        descricao: servico.descricao,
        enviarEmail: true,
        numero: "0001042",
        codigoVerificacao: "DEMO1042",
        xml,
        pdfBase64: pdf,
        erros: null,
        payload: JSON.stringify({ demonstracao: true, codigo_tributacao_nacional_iss: servico.codigoNacional }),
        criadoEm: ontem,
        atualizadoEm: ontem,
      });
      tomador.ultimaNotaEm = ontem;
    }
    gravar(estado);
  }

  async function despachar(pedido: { method: string; caminho: string; body?: unknown }): Promise<RespostaDemo> {
    const estado = await garantir();
    const method = pedido.method.toUpperCase();
    const pathname = (pedido.caminho.split("?")[0] || "/").replace(/\/+$/, "") || "/";
    const body = (pedido.body ?? {}) as Record<string, unknown>;
    try {
      const resultado = await atender(estado, method, pathname, body);
      return resultado;
    } catch (erro) {
      if (erro instanceof DemoErro) return { status: erro.status, json: { erro: erro.message } };
      return { status: 500, json: { erro: "Erro interno." } };
    }
  }

  async function atender(estado: Estado, method: string, pathname: string, body: Record<string, unknown>): Promise<RespostaDemo> {
    if (method === "GET" && pathname === "/api/meta") {
      return ok({
        modo: "mock",
        estatico: true,
        registroAberto: true,
        empresasApi: false,
        webhookConfigurado: false,
        municipios: MUNICIPIOS_GO,
      });
    }
    if (method === "POST" && pathname === "/api/auth/registrar") return registrar(estado, body);
    if (method === "POST" && pathname === "/api/auth/login") return login(estado, body);
    if (method === "POST" && pathname === "/api/auth/logout") {
      estado.sessao = null;
      gravar(estado);
      return ok({ ok: true });
    }
    if (method === "GET" && pathname === "/api/auth/me") {
      const auth = exigirUsuario(estado);
      const usuario = estado.usuarios.find((item) => item.id === auth.userId);
      if (!usuario) throw new DemoErro(401, "Faça login para continuar.");
      return ok({ id: usuario.id, nome: usuario.nome, email: usuario.email, empresaId: auth.empresaId });
    }
    if (method === "GET" && pathname === "/api/empresas") {
      const auth = exigirUsuario(estado);
      const empresas = estado.empresas.filter((item) => item.userId === auth.userId).sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial, "pt-BR"));
      return ok({ ativaId: auth.empresaId, empresas: empresas.map(dtoEmpresa) });
    }
    if (method === "POST" && pathname === "/api/empresas") return criarEmpresa(estado, body);
    const empresaId = casar(pathname, "/api/empresas/:id");
    if (empresaId && method === "PATCH") return atualizarEmpresa(estado, empresaId.id, body);
    if (method === "POST" && pathname === "/api/sessao/empresa") return trocarEmpresa(estado, body);
    const certGet = casar(pathname, "/api/empresas/:id/certificado");
    if (certGet && method === "GET") return verCertificado(estado, certGet.id);
    if (certGet && method === "POST") return enviarCertificado(estado, certGet.id, body);
    if (method === "GET" && pathname === "/api/tomadores") {
      const empresa = exigirEmpresa(estado);
      const rows = estado.tomadores
        .filter((item) => item.empresaId === empresa.id)
        .sort((a, b) => (b.ultimaNotaEm ?? "").localeCompare(a.ultimaNotaEm ?? "") || a.razaoSocial.localeCompare(b.razaoSocial, "pt-BR"));
      return ok(rows.map(dtoTomador));
    }
    if (method === "POST" && pathname === "/api/tomadores") return criarTomador(estado, body);
    const cnpj = casar(pathname, "/api/cnpj/:cnpj");
    if (cnpj && method === "GET") return consultarCnpj(estado, cnpj.cnpj);
    if (method === "GET" && pathname === "/api/servicos") {
      const empresa = exigirEmpresa(estado);
      const rows = estado.servicos.filter((item) => item.empresaId === empresa.id).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      return ok(rows.map(dtoServico));
    }
    if (method === "POST" && pathname === "/api/servicos") return criarServico(estado, body);
    const servicoId = casar(pathname, "/api/servicos/:id");
    if (servicoId && method === "PATCH") return atualizarServico(estado, servicoId.id, body);
    if (method === "POST" && pathname === "/api/voz/interpretar") return interpretar(estado, body);
    if (method === "GET" && pathname === "/api/notas") {
      const empresa = exigirEmpresa(estado);
      const rows = estado.notas.filter((item) => item.empresaId === empresa.id).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)).slice(0, 100);
      return ok(rows.map((nota) => dtoNota(estado, nota)));
    }
    if (method === "POST" && pathname === "/api/notas") return emitir(estado, body);
    const pdf = casar(pathname, "/api/notas/:id/pdf");
    if (pdf && method === "GET") return baixar(estado, pdf.id, "pdf");
    const xml = casar(pathname, "/api/notas/:id/xml");
    if (xml && method === "GET") return baixar(estado, xml.id, "xml");
    const cancelar = casar(pathname, "/api/notas/:id/cancelar");
    if (cancelar && method === "POST") return cancelarNota(estado, cancelar.id, body);
    const notaId = casar(pathname, "/api/notas/:id");
    if (notaId && method === "GET") return lerNota(estado, notaId.id);
    return { status: 404, json: { erro: "Recurso não encontrado." } };
  }

  async function registrar(estado: Estado, body: Record<string, unknown>): Promise<RespostaDemo> {
    const nome = String(body.nome ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const senha = String(body.senha ?? "");
    if (nome.length < 2) throw new DemoErro(400, "Informe o nome.");
    if (!email.includes("@")) throw new DemoErro(400, "E-mail inválido.");
    if (senha.length < 6) throw new DemoErro(400, "A senha precisa ter pelo menos 6 caracteres.");
    if (estado.usuarios.some((item) => item.email === email)) throw new DemoErro(409, "Já existe uma conta com esse e-mail.");
    const usuario: Usuario = { id: crypto.randomUUID(), nome, email, senhaHash: await hashSenha(senha), criadoEm: new Date().toISOString() };
    estado.usuarios.push(usuario);
    estado.sessao = abrirSessao(usuario.id, null);
    gravar(estado);
    return { status: 201, json: { id: usuario.id, nome, email } };
  }

  async function login(estado: Estado, body: Record<string, unknown>): Promise<RespostaDemo> {
    const email = String(body.email ?? "").trim().toLowerCase();
    const senha = String(body.senha ?? "");
    const usuario = estado.usuarios.find((item) => item.email === email);
    if (!usuario || usuario.senhaHash !== await hashSenha(senha)) throw new DemoErro(401, "E-mail ou senha incorretos.");
    const primeira = estado.empresas.filter((item) => item.userId === usuario.id).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))[0];
    estado.sessao = abrirSessao(usuario.id, primeira?.id ?? null);
    gravar(estado);
    return ok({ id: usuario.id, nome: usuario.nome, email: usuario.email, empresaId: primeira?.id ?? null });
  }

  function criarEmpresa(estado: Estado, body: Record<string, unknown>): RespostaDemo {
    const auth = exigirUsuario(estado);
    const dados = lerEmpresa(body);
    if (estado.empresas.some((item) => item.userId === auth.userId && item.cnpj === dados.cnpj)) {
      throw new DemoErro(409, "Esse CNPJ já está neste escritório.");
    }
    const empresa: Empresa = {
      ...dados,
      id: crypto.randomUUID(),
      userId: auth.userId,
      certificadoStatus: "pendente",
      criadoEm: new Date().toISOString(),
    };
    estado.empresas.push(empresa);
    if (!auth.empresaId && estado.sessao) estado.sessao.empresaId = empresa.id;
    gravar(estado);
    return { status: 201, json: dtoEmpresa(empresa) };
  }

  function atualizarEmpresa(estado: Estado, id: string, body: Record<string, unknown>): RespostaDemo {
    const auth = exigirUsuario(estado);
    const atual = estado.empresas.find((item) => item.id === id && item.userId === auth.userId);
    if (!atual) throw new DemoErro(404, "Empresa não encontrada.");
    const dados = lerEmpresa({ ...empresaParaBody(atual), ...body });
    if (estado.empresas.some((item) => item.userId === auth.userId && item.cnpj === dados.cnpj && item.id !== atual.id)) {
      throw new DemoErro(409, "Esse CNPJ já está neste escritório.");
    }
    Object.assign(atual, dados);
    gravar(estado);
    return ok(dtoEmpresa(atual));
  }

  function trocarEmpresa(estado: Estado, body: Record<string, unknown>): RespostaDemo {
    const auth = exigirUsuario(estado);
    const id = String(body.id ?? "");
    const empresa = estado.empresas.find((item) => item.id === id && item.userId === auth.userId);
    if (!empresa || !estado.sessao) throw new DemoErro(404, "Empresa não encontrada.");
    estado.sessao.empresaId = id;
    gravar(estado);
    return ok({ empresaId: id });
  }

  function verCertificado(estado: Estado, id: string): RespostaDemo {
    const empresa = acharEmpresa(estado, id);
    return ok({ certificadoStatus: empresa.certificadoStatus, instrucoes: instrucoes(empresa), empresasApi: false });
  }

  function enviarCertificado(estado: Estado, id: string, body: Record<string, unknown>): RespostaDemo {
    const empresa = acharEmpresa(estado, id);
    if (body.manual === true) {
      empresa.certificadoStatus = "manual";
      gravar(estado);
      return ok({ certificadoStatus: "manual", instrucoes: instrucoes(empresa) });
    }
    const arquivo = String(body.arquivoBase64 ?? "");
    const senha = String(body.senha ?? "");
    if (!arquivo || !senha) throw new DemoErro(400, "Envie o arquivo .pfx e a senha. Eles não ficam gravados.");
    empresa.certificadoStatus = "simulado";
    gravar(estado);
    return ok({
      certificadoStatus: "simulado",
      instrucoes: [
        ...instrucoes(empresa),
        "Esta demonstração roda só no navegador. O arquivo foi descartado e nada foi enviado à Focus.",
      ],
    });
  }

  function criarTomador(estado: Estado, body: Record<string, unknown>): RespostaDemo {
    const empresa = exigirEmpresa(estado);
    const dados = lerTomador(body);
    const tomador: Tomador = { ...dados, id: crypto.randomUUID(), empresaId: empresa.id, ultimaNotaEm: null };
    estado.tomadores.push(tomador);
    gravar(estado);
    return { status: 201, json: dtoTomador(tomador) };
  }

  async function consultarCnpj(estado: Estado, bruto: string): Promise<RespostaDemo> {
    exigirUsuario(estado);
    const cnpj = apenasDigitos(bruto);
    if (!cnpjValido(cnpj)) throw new DemoErro(400, "CNPJ inválido.");
    const buscar = opcoes.fetchCnpj ?? fetch;
    let resposta: Response;
    try {
      resposta = await buscar(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal: AbortSignal.timeout(8000) });
    } catch {
      throw new DemoErro(502, "Não foi possível consultar o CNPJ agora. Preencha os dados à mão.");
    }
    if (!resposta.ok) throw new DemoErro(404, "CNPJ não encontrado na Receita. Preencha os dados à mão.");
    const json = await resposta.json() as Record<string, unknown>;
    return ok({
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
  }

  function criarServico(estado: Estado, body: Record<string, unknown>): RespostaDemo {
    const empresa = exigirEmpresa(estado);
    const dados = lerServico(body);
    const servico: Servico = { ...dados, id: crypto.randomUUID(), empresaId: empresa.id };
    estado.servicos.push(servico);
    gravar(estado);
    return { status: 201, json: dtoServico(servico) };
  }

  function atualizarServico(estado: Estado, id: string, body: Record<string, unknown>): RespostaDemo {
    const empresa = exigirEmpresa(estado);
    const atual = estado.servicos.find((item) => item.id === id && item.empresaId === empresa.id);
    if (!atual) throw new DemoErro(404, "Serviço não encontrado.");
    const dados = lerServico({
      nome: atual.nome,
      descricao: atual.descricao,
      codigoLc116: atual.codigoLc116,
      codigoMunicipal: atual.codigoMunicipal,
      codigoNbs: atual.codigoNbs,
      aliquotaIss: atual.aliquotaIss,
      ...body,
    });
    Object.assign(atual, dados);
    gravar(estado);
    return ok(dtoServico(atual));
  }

  function interpretar(estado: Estado, body: Record<string, unknown>): RespostaDemo {
    const empresa = exigirEmpresa(estado);
    const texto = String(body.texto ?? "");
    if (!texto.trim()) throw new DemoErro(400, "Nada foi dito.");
    const rascunho = interpretarNotaFalada(texto, {
      tomadores: estado.tomadores.filter((item) => item.empresaId === empresa.id).map((item) => ({ id: item.id, nome: item.razaoSocial })),
      servicos: estado.servicos.filter((item) => item.empresaId === empresa.id).map((item) => ({ id: item.id, nome: item.nome })),
    });
    return ok(rascunho);
  }

  function emitir(estado: Estado, body: Record<string, unknown>): RespostaDemo {
    const empresa = exigirEmpresa(estado);
    const tomador = estado.tomadores.find((item) => item.id === String(body.tomadorId ?? "") && item.empresaId === empresa.id);
    const servico = estado.servicos.find((item) => item.id === String(body.servicoId ?? "") && item.empresaId === empresa.id);
    if (!tomador || !servico) throw new DemoErro(400, "Escolha o cliente e o serviço.");
    const valor = Number(body.valor);
    if (!Number.isFinite(valor) || valor <= 0) throw new DemoErro(400, "Informe um valor maior que zero.");
    const issRetido = body.issRetido === true;
    const enviarEmail = body.enviarEmail !== false;
    const descricao = String(body.descricao ?? servico.descricao).trim() || servico.descricao;
    let emissao;
    try {
      emissao = montarEmissao({
        empresa: {
          cnpj: empresa.cnpj,
          razaoSocial: empresa.razaoSocial,
          inscricaoMunicipal: empresa.inscricaoMunicipal,
          regime: empresa.regime,
          codigoIbge: empresa.codigoIbge,
          uf: empresa.uf,
          municipio: empresa.municipio,
          logradouro: empresa.logradouro,
          numero: empresa.numero,
          bairro: empresa.bairro,
          cep: empresa.cep,
          email: empresa.email ?? undefined,
        },
        tomador: {
          cnpj: tomador.cnpj,
          cpf: tomador.cpf,
          razaoSocial: tomador.razaoSocial,
          email: enviarEmail ? tomador.email : null,
          telefone: tomador.telefone,
          logradouro: tomador.logradouro,
          numero: tomador.numero,
          complemento: tomador.complemento,
          bairro: tomador.bairro,
          codigoIbge: tomador.codigoIbge,
          uf: tomador.uf,
          cep: tomador.cep,
        },
        servico: {
          nome: servico.nome,
          descricao: servico.descricao,
          codigoNacional: servico.codigoNacional,
          codigoMunicipal: servico.codigoMunicipal,
          codigoNbs: servico.codigoNbs,
          aliquotaIss: servico.aliquotaIss,
        },
        valor,
        issRetido,
        descricao,
      });
    } catch (erro) {
      throw new DemoErro(400, erro instanceof Error ? erro.message : "Não foi possível montar a nota.");
    }
    const { valorIss } = calcularIss(valor, servico.aliquotaIss, issRetido);
    const agora = new Date().toISOString();
    const nota: Nota = {
      id: crypto.randomUUID(),
      empresaId: empresa.id,
      tomadorId: tomador.id,
      servicoId: servico.id,
      ref: `nf${hex(6)}`,
      caminho: emissao.caminho,
      status: "processando_autorizacao",
      valor,
      aliquotaIss: servico.aliquotaIss,
      valorIss,
      issRetido,
      descricao,
      enviarEmail,
      numero: null,
      codigoVerificacao: null,
      xml: null,
      pdfBase64: null,
      erros: null,
      payload: JSON.stringify({
        caminho: emissao.caminho,
        endpoint: emissao.endpoint,
        provedor: emissao.provedor,
        habilitarAmbienteNacional: emissao.habilitarAmbienteNacional,
        body: emissao.body,
      }),
      criadoEm: agora,
      atualizadoEm: agora,
    };
    estado.notas.push(nota);
    gravar(estado);
    return { status: 201, json: dtoNota(estado, nota) };
  }

  function lerNota(estado: Estado, id: string): RespostaDemo {
    const empresa = exigirEmpresa(estado);
    const nota = estado.notas.find((item) => item.id === id && item.empresaId === empresa.id);
    if (!nota) throw new DemoErro(404, "Nota não encontrada.");
    if (nota.status === "processando_autorizacao") {
      autorizar(estado, nota);
      gravar(estado);
    }
    return ok(dtoNota(estado, nota));
  }

  function cancelarNota(estado: Estado, id: string, body: Record<string, unknown>): RespostaDemo {
    const empresa = exigirEmpresa(estado);
    const nota = estado.notas.find((item) => item.id === id && item.empresaId === empresa.id);
    if (!nota) throw new DemoErro(404, "Nota não encontrada.");
    if (nota.status !== "autorizado") throw new DemoErro(400, "Só uma nota autorizada pode ser cancelada.");
    const justificativa = String(body.justificativa ?? "").trim();
    if (justificativa.length < 15 || justificativa.length > 255) {
      throw new DemoErro(400, "A justificativa precisa ter entre 15 e 255 caracteres.");
    }
    nota.status = "cancelado";
    nota.atualizadoEm = new Date().toISOString();
    gravar(estado);
    return ok(dtoNota(estado, nota));
  }

  function baixar(estado: Estado, id: string, tipo: "pdf" | "xml"): RespostaDemo {
    const empresa = exigirEmpresa(estado);
    const nota = estado.notas.find((item) => item.id === id && item.empresaId === empresa.id);
    if (!nota) throw new DemoErro(404, "Nota não encontrada.");
    if (nota.status === "processando_autorizacao") {
      autorizar(estado, nota);
      gravar(estado);
    }
    const nome = nota.numero ?? nota.ref;
    if (tipo === "pdf" && nota.pdfBase64) {
      return {
        status: 200,
        json: { ok: true },
        arquivo: { nome: `nfse-${nome}.pdf`, contentType: "application/pdf", bytes: base64ParaBytes(nota.pdfBase64) },
      };
    }
    if (tipo === "xml" && nota.xml) {
      return {
        status: 200,
        json: { ok: true },
        arquivo: { nome: `nfse-${nome}.xml`, contentType: "application/xml; charset=utf-8", bytes: new TextEncoder().encode(nota.xml) },
      };
    }
    throw new DemoErro(404, tipo === "pdf" ? "PDF ainda não está disponível." : "XML ainda não está disponível.");
  }

  return { despachar };
}

function vazio(): Estado {
  return { usuarios: [], sessao: null, empresas: [], tomadores: [], servicos: [], notas: [] };
}

function abrirSessao(userId: string, empresaId: string | null): Sessao {
  return { userId, empresaId, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString() };
}

function exigirUsuario(estado: Estado): Sessao {
  const sessao = estado.sessao;
  if (!sessao || sessao.expiresAt < new Date().toISOString()) throw new DemoErro(401, "Faça login para continuar.");
  return sessao;
}

function exigirEmpresa(estado: Estado): Empresa {
  const auth = exigirUsuario(estado);
  const empresa = estado.empresas.find((item) => item.id === auth.empresaId && item.userId === auth.userId);
  if (!empresa) throw new DemoErro(400, "Selecione uma empresa.");
  return empresa;
}

function acharEmpresa(estado: Estado, id: string): Empresa {
  const auth = exigirUsuario(estado);
  const empresa = estado.empresas.find((item) => item.id === id && item.userId === auth.userId);
  if (!empresa) throw new DemoErro(404, "Empresa não encontrada.");
  return empresa;
}

function ok(json: unknown): RespostaDemo {
  return { status: 200, json };
}

function casar(pathname: string, modelo: string): Record<string, string> | null {
  const atual = pathname.split("/").filter(Boolean);
  const esperado = modelo.split("/").filter(Boolean);
  if (atual.length !== esperado.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < esperado.length; i++) {
    if (esperado[i].startsWith(":")) params[esperado[i].slice(1)] = decodeURIComponent(atual[i]);
    else if (atual[i] !== esperado[i]) return null;
  }
  return params;
}

function lerEmpresa(body: Record<string, unknown>) {
  const cnpj = apenasDigitos(String(body.cnpj ?? ""));
  if (!cnpjValido(cnpj)) throw new DemoErro(400, "CNPJ inválido.");
  const razaoSocial = String(body.razaoSocial ?? "").trim();
  const inscricaoMunicipal = String(body.inscricaoMunicipal ?? "").trim();
  const regime = String(body.regime ?? "") as Regime;
  const codigoIbge = apenasDigitos(String(body.codigoIbge ?? ""));
  if (!razaoSocial) throw new DemoErro(400, "Informe a razão social.");
  if (!inscricaoMunicipal) throw new DemoErro(400, "Informe a inscrição municipal.");
  if (!["mei", "simples_nacional", "lucro_presumido", "lucro_real"].includes(regime)) {
    throw new DemoErro(400, "Regime tributário inválido.");
  }
  if (codigoIbge.length !== 7) throw new DemoErro(400, "Informe o código IBGE do município com 7 dígitos.");
  const caminho = resolverCaminho({ regime, codigoIbge, uf: "GO" });
  if (!caminho.ok) throw new DemoErro(400, caminho.erro);
  const cep = apenasDigitos(String(body.cep ?? ""));
  const logradouro = String(body.logradouro ?? "").trim();
  const numero = String(body.numero ?? "").trim();
  const bairro = String(body.bairro ?? "").trim();
  if (cep.length !== 8 || !logradouro || !numero || !bairro) {
    throw new DemoErro(400, "Preencha CEP, logradouro, número e bairro da empresa.");
  }
  return {
    cnpj,
    razaoSocial,
    nomeFantasia: String(body.nomeFantasia ?? "").trim() || null,
    inscricaoMunicipal,
    regime,
    codigoIbge,
    municipio: String(body.municipio ?? "").trim() || nomeMunicipio(codigoIbge),
    uf: "GO",
    logradouro,
    numero,
    bairro,
    cep,
    email: String(body.email ?? "").trim() || null,
    telefone: String(body.telefone ?? "").trim() || null,
  };
}

function lerTomador(body: Record<string, unknown>) {
  const cnpj = apenasDigitos(String(body.cnpj ?? ""));
  const cpf = apenasDigitos(String(body.cpf ?? ""));
  if (cnpj && !cnpjValido(cnpj)) throw new DemoErro(400, "CNPJ do tomador inválido.");
  if (!cnpj && cpf.length !== 11) throw new DemoErro(400, "Informe o CNPJ ou o CPF do tomador.");
  const razaoSocial = String(body.razaoSocial ?? "").trim();
  if (razaoSocial.length < 2) throw new DemoErro(400, "Informe a razão social do tomador.");
  const codigoIbge = apenasDigitos(String(body.codigoIbge ?? ""));
  if (codigoIbge.length !== 7) throw new DemoErro(400, "Informe o município do tomador.");
  const cep = apenasDigitos(String(body.cep ?? ""));
  const logradouro = String(body.logradouro ?? "").trim();
  const numero = String(body.numero ?? "").trim();
  const bairro = String(body.bairro ?? "").trim();
  if (cep.length !== 8 || !logradouro || !numero || !bairro) {
    throw new DemoErro(400, "Preencha CEP, logradouro, número e bairro do tomador.");
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

function lerServico(body: Record<string, unknown>) {
  const nome = String(body.nome ?? "").trim();
  const descricao = String(body.descricao ?? "").trim();
  if (nome.length < 2 || descricao.length < 2) throw new DemoErro(400, "Informe nome e descrição do serviço.");
  let codigoNacional: string;
  try {
    codigoNacional = codigoNacionalIss(String(body.codigoLc116 ?? body.codigoNacional ?? ""));
  } catch (erro) {
    throw new DemoErro(400, erro instanceof Error ? erro.message : "Código de serviço inválido.");
  }
  const aliquota = Number(body.aliquotaIss);
  if (!Number.isFinite(aliquota) || aliquota < 0 || aliquota > 5) {
    throw new DemoErro(400, "A alíquota de ISS precisa ficar entre 0 e 5%.");
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

function empresaParaBody(empresa: Empresa) {
  return {
    cnpj: empresa.cnpj,
    razaoSocial: empresa.razaoSocial,
    nomeFantasia: empresa.nomeFantasia,
    inscricaoMunicipal: empresa.inscricaoMunicipal,
    regime: empresa.regime,
    codigoIbge: empresa.codigoIbge,
    municipio: empresa.municipio,
    logradouro: empresa.logradouro,
    numero: empresa.numero,
    bairro: empresa.bairro,
    cep: empresa.cep,
    email: empresa.email,
    telefone: empresa.telefone,
  };
}

function dtoEmpresa(empresa: Empresa) {
  const caminho = resolverCaminho({
    regime: empresa.regime,
    codigoIbge: empresa.codigoIbge,
    uf: empresa.uf,
  });
  return {
    id: empresa.id,
    cnpj: formatarCnpj(empresa.cnpj),
    cnpjDigitos: empresa.cnpj,
    razaoSocial: empresa.razaoSocial,
    nomeFantasia: empresa.nomeFantasia,
    inscricaoMunicipal: empresa.inscricaoMunicipal,
    regime: empresa.regime,
    regimeLabel: LABEL_REGIME[empresa.regime] ?? empresa.regime,
    codigoIbge: empresa.codigoIbge,
    municipio: empresa.municipio,
    uf: empresa.uf,
    logradouro: empresa.logradouro,
    numero: empresa.numero,
    bairro: empresa.bairro,
    cep: empresa.cep,
    email: empresa.email,
    telefone: empresa.telefone,
    focusEmpresaId: null,
    certificadoStatus: empresa.certificadoStatus,
    certificadoValidoAte: null,
    caminho: caminho.ok ? caminho : null,
  };
}

function dtoTomador(tomador: Tomador) {
  return {
    id: tomador.id,
    cnpj: tomador.cnpj ? formatarCnpj(tomador.cnpj) : null,
    cpf: tomador.cpf,
    razaoSocial: tomador.razaoSocial,
    email: tomador.email,
    telefone: tomador.telefone,
    logradouro: tomador.logradouro,
    numero: tomador.numero,
    complemento: tomador.complemento,
    bairro: tomador.bairro,
    codigoIbge: tomador.codigoIbge,
    municipio: tomador.municipio,
    uf: tomador.uf,
    cep: tomador.cep,
    ultimaNotaEm: tomador.ultimaNotaEm,
    ultimaLabel: tomador.ultimaNotaEm ? `última: ${quandoRelativo(tomador.ultimaNotaEm)}` : "novo",
  };
}

function dtoServico(servico: Servico) {
  return {
    id: servico.id,
    nome: servico.nome,
    descricao: servico.descricao,
    codigoLc116: servico.codigoLc116,
    codigoNacional: servico.codigoNacional,
    codigoMunicipal: servico.codigoMunicipal,
    codigoNbs: servico.codigoNbs,
    aliquotaIss: servico.aliquotaIss,
  };
}

function dtoNota(estado: Estado, nota: Nota) {
  const tomador = estado.tomadores.find((item) => item.id === nota.tomadorId);
  const servico = estado.servicos.find((item) => item.id === nota.servicoId);
  let erros: unknown = null;
  if (nota.erros) {
    try { erros = JSON.parse(nota.erros); } catch { erros = nota.erros; }
  }
  return {
    id: nota.id,
    ref: nota.ref,
    caminho: nota.caminho,
    status: nota.status,
    valor: nota.valor,
    aliquotaIss: nota.aliquotaIss,
    valorIss: nota.valorIss,
    issRetido: nota.issRetido,
    descricao: nota.descricao,
    enviarEmail: nota.enviarEmail,
    numero: nota.numero,
    codigoVerificacao: nota.codigoVerificacao,
    urlConsulta: null,
    temPdf: Boolean(nota.pdfBase64),
    temXml: Boolean(nota.xml),
    erros,
    payload: JSON.parse(nota.payload) as unknown,
    tomadorId: nota.tomadorId,
    servicoId: nota.servicoId,
    tomadorNome: tomador?.razaoSocial ?? "",
    servicoNome: servico?.nome ?? "",
    criadoEm: nota.criadoEm,
    atualizadoEm: nota.atualizadoEm,
  };
}

function autorizar(estado: Estado, nota: Nota) {
  if (nota.status !== "processando_autorizacao") return;
  const empresa = estado.empresas.find((item) => item.id === nota.empresaId);
  const tomador = estado.tomadores.find((item) => item.id === nota.tomadorId);
  if (!empresa || !tomador) return;
  const sequencia = estado.notas.filter((item) => item.empresaId === empresa.id).length + 1042;
  const numero = String(sequencia).padStart(6, "0");
  const codigo = hex(4).toUpperCase();
  nota.status = "autorizado";
  nota.numero = numero;
  nota.codigoVerificacao = codigo;
  nota.xml = xmlDemonstracao({
    numero,
    ref: nota.ref,
    prestador: empresa.razaoSocial,
    cnpjPrestador: empresa.cnpj,
    tomador: tomador.razaoSocial,
    cnpjTomador: tomador.cnpj ?? "",
    descricao: nota.descricao,
    valor: nota.valor,
    caminho: nota.caminho,
    codigoVerificacao: codigo,
  });
  nota.pdfBase64 = bytesParaBase64(pdfDemonstracao(linhasPdf({
    numero,
    prestador: empresa.razaoSocial,
    tomador: tomador.razaoSocial,
    descricao: nota.descricao,
    valor: nota.valor,
    caminho: nota.caminho,
    status: "autorizado",
  })));
  nota.atualizadoEm = new Date().toISOString();
  tomador.ultimaNotaEm = nota.atualizadoEm;
}

function instrucoes(empresa: Empresa): string[] {
  const caminho = resolverCaminho({ regime: empresa.regime, codigoIbge: empresa.codigoIbge, uf: empresa.uf });
  const passos = [
    "O certificado é o modelo A1 (arquivo .pfx) do CNPJ prestador. A NotaFácil não guarda o arquivo nem a senha.",
    "Nesta demonstração do celular não há token Focus. Nada é enviado à prefeitura.",
  ];
  if (caminho.ok && caminho.habilitarAmbienteNacional) {
    passos.push("Nesta empresa, ligue apenas “Ambiente da NFS-e Nacional — Homologação” (habilita_nfsen_homologacao). Deixe a NFS-e municipal desligada.");
  } else if (caminho.ok) {
    passos.push("Nesta empresa, ligue a NFS-e municipal (habilita_nfse) e deixe o Ambiente Nacional desligado. É assim que a Focus fala com o IssNet/SGISS de Goiânia.");
  }
  return passos;
}

function semearCatalogo(estado: Estado, empresaId: string, ontem: string) {
  const tomadores = [
    {
      id: `${empresaId}-tom-x`, cnpj: gerarCnpj("444444440001"), razaoSocial: "Construtora X Ltda",
      email: "financeiro@construtorax.example", logradouro: "Rua da Obra", numero: "1500", bairro: "Setor Bueno",
      codigoIbge: "5208707", municipio: "Goiânia", cep: "74210010", ultimaNotaEm: null as string | null,
    },
    {
      id: `${empresaId}-tom-ex`, cnpj: gerarCnpj("555555550001"), razaoSocial: "Empresa Exemplo Ltda",
      email: "financeiro@exemplo.example", logradouro: "Rua do Comércio", numero: "40", bairro: "Centro",
      codigoIbge: "5201108", municipio: "Anápolis", cep: "75010010", ultimaNotaEm: empresaId === "emp-simples" ? ontem : null,
    },
  ];
  for (const tomador of tomadores) {
    estado.tomadores.push({
      ...tomador,
      empresaId,
      cpf: null,
      telefone: "6230000000",
      complemento: null,
      uf: "GO",
    });
  }
  const servicos = [
    { slug: "limpeza", nome: "Limpeza pós-obra", descricao: "Limpeza e conservação do imóvel depois da obra.", lc: "07.10", municipal: "710", aliquota: 5 },
    { slug: "consultoria", nome: "Consultoria empresarial", descricao: "Consultoria em gestão e processos.", lc: "17.01", municipal: "1701", aliquota: 5 },
    { slug: "suporte", nome: "Suporte técnico mensal", descricao: "Suporte e manutenção de sistemas.", lc: "01.07", municipal: "107", aliquota: 2 },
  ];
  for (const item of servicos) {
    estado.servicos.push({
      id: `${empresaId}-srv-${item.slug}`,
      empresaId,
      nome: item.nome,
      descricao: item.descricao,
      codigoLc116: item.lc,
      codigoNacional: codigoNacionalIss(item.lc),
      codigoMunicipal: item.municipal,
      codigoNbs: null,
      aliquotaIss: item.aliquota,
    });
  }
}

async function hashSenha(senha: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`notafacil:${senha}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hex(bytes: number): string {
  const lista = crypto.getRandomValues(new Uint8Array(bytes));
  return [...lista].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64ParaBytes(base64: string): Uint8Array {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
