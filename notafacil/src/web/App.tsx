import { useEffect, useMemo, useState } from "react";
import { api, ApiError, baixarNota } from "./api";
import { LABEL_REGIME, resolverCaminho, type Regime } from "../domain/emissao";
import {
  calcularIss,
  formatarBrl,
  formatarBrlInput,
  formatarCep,
  formatarCnpj,
  parseValorBr,
} from "../domain/format";
import type { MunicipioGo } from "../domain/municipios";

type Modo = "mock" | "homologacao";
type Empresa = {
  id: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  inscricaoMunicipal: string;
  regime: Regime;
  regimeLabel: string;
  codigoIbge: string;
  municipio: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cep: string;
  email: string | null;
  telefone: string | null;
  certificadoStatus: string;
  caminho: { caminho: string; titulo: string; detalhe: string } | null;
};
type Tomador = {
  id: string;
  cnpj: string | null;
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
  ultimaLabel: string;
};
type Servico = {
  id: string;
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
  status: string;
  valor: number;
  numero: string | null;
  tomadorId: string;
  servicoId: string;
  tomadorNome: string;
  servicoNome: string;
  descricao: string;
  issRetido: boolean;
  enviarEmail: boolean;
  aliquotaIss: number;
  valorIss: number;
  caminho: string;
  erros: { mensagem?: string }[] | string | null;
  temPdf: boolean;
  temXml: boolean;
  criadoEm: string;
  urlConsulta: string | null;
  codigoVerificacao: string | null;
};
type Rascunho = {
  tomadorId: string;
  servicoId: string;
  valor: number;
  issRetido: boolean;
  enviarEmail: boolean;
  descricao: string;
};
type Tela =
  | { nome: "login" }
  | { nome: "inicio" }
  | { nome: "tomador" }
  | { nome: "servico" }
  | { nome: "confirmar" }
  | { nome: "voz" }
  | { nome: "sucesso"; notaId: string }
  | { nome: "notas" }
  | { nome: "nota"; id: string }
  | { nome: "escritorio" }
  | { nome: "empresa"; id?: string }
  | { nome: "servicos" }
  | { nome: "servicoForm"; id?: string };

type Meta = { modo: Modo; registroAberto: boolean; municipios: MunicipioGo[]; empresasApi: boolean; estatico?: boolean };

const CORES = ["#4f46e5", "#0891b2", "#db2777", "#ea580c", "#7c3aed"];
const STATUS: Record<string, string> = {
  processando_autorizacao: "Processando",
  autorizado: "Autorizada",
  cancelado: "Cancelada",
  erro_autorizacao: "Erro",
};

function iniciais(nome: string) {
  return nome.split(" ").slice(0, 2).map((parte) => parte[0] ?? "").join("").toUpperCase();
}

function classeStatus(status: string) {
  if (status === "autorizado") return "ok";
  if (status === "processando_autorizacao") return "wait";
  if (status === "erro_autorizacao") return "err";
  return "muted";
}

function textoErro(erros: Nota["erros"]) {
  if (!erros) return "";
  if (typeof erros === "string") return erros;
  if (Array.isArray(erros)) return erros.map((item) => item.mensagem).filter(Boolean).join(" ");
  if (typeof erros === "object" && erros && "mensagem" in erros) return String((erros as { mensagem?: string }).mensagem ?? "");
  return "";
}

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tela, setTela] = useState<Tela>({ nome: "login" });
  const [usuario, setUsuario] = useState("");
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [tomadores, setTomadores] = useState<Tomador[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [notas, setNotas] = useState<Nota[]>([]);
  const [tomadorId, setTomadorId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const empresa = empresas.find((item) => item.id === empresaId) ?? null;

  async function carregarPainel() {
    const lista = await api<{ ativaId: string | null; empresas: Empresa[] }>("/api/empresas");
    setEmpresas(lista.empresas);
    setEmpresaId(lista.ativaId);
    if (!lista.ativaId) {
      setTomadores([]);
      setServicos([]);
      setNotas([]);
      return lista;
    }
    const [clientes, itens, emitidas] = await Promise.all([
      api<Tomador[]>("/api/tomadores"),
      api<Servico[]>("/api/servicos"),
      api<Nota[]>("/api/notas"),
    ]);
    setTomadores(clientes);
    setServicos(itens);
    setNotas(emitidas);
    return lista;
  }

  useEffect(() => {
    api<Meta>("/api/meta").then(setMeta).catch(() => setErro("Não foi possível carregar o app."));
    api<{ nome: string }>("/api/auth/me")
      .then(async (me) => {
        setUsuario(me.nome);
        await carregarPainel();
        setTela({ nome: "inicio" });
      })
      .catch(() => setTela({ nome: "login" }));
  }, []);

  useEffect(() => {
    if (!empresaId || (tela.nome !== "notas" && tela.nome !== "inicio")) return;
    api<Nota[]>("/api/notas").then(setNotas).catch(() => undefined);
  }, [tela.nome, empresaId]);

  function ir(proxima: Tela) {
    setErro("");
    setTela(proxima);
  }

  async function entrar(email: string, senha: string) {
    setOcupado(true);
    setErro("");
    try {
      const me = await api<{ nome: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, senha }) });
      setUsuario(me.nome);
      await carregarPainel();
      setTela({ nome: "inicio" });
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Falha no login.");
    } finally {
      setOcupado(false);
    }
  }

  async function usarEmpresa(id: string) {
    await api("/api/sessao/empresa", { method: "POST", body: JSON.stringify({ id }) });
    setEmpresaId(id);
    await carregarPainel();
    ir({ nome: "inicio" });
  }

  function escolherTomador(id: string) {
    setTomadorId(id);
    ir({ nome: "servico" });
  }

  function escolherServico(id: string, valorSugerido?: number) {
    const servico = servicos.find((item) => item.id === id);
    const tomador = tomadores.find((item) => item.id === tomadorId);
    if (!servico || !tomador) return;
    const ultima = notas.find((nota) => nota.tomadorId === tomador.id);
    setRascunho({
      tomadorId: tomador.id,
      servicoId: servico.id,
      valor: valorSugerido ?? ultima?.valor ?? notas[0]?.valor ?? 1500,
      issRetido: false,
      enviarEmail: Boolean(tomador.email),
      descricao: servico.descricao,
    });
    ir({ nome: "confirmar" });
  }

  async function emitir() {
    if (!rascunho) return;
    setOcupado(true);
    setErro("");
    try {
      const nota = await api<Nota>("/api/notas", { method: "POST", body: JSON.stringify(rascunho) });
      await carregarPainel();
      ir({ nome: "sucesso", notaId: nota.id });
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível emitir.");
    } finally {
      setOcupado(false);
    }
  }

  const mostraNav = tela.nome === "inicio" || tela.nome === "notas" || tela.nome === "escritorio" || tela.nome === "servicos";
  const banner = meta?.estatico
    ? "DEMONSTRAÇÃO NO CELULAR · os dados ficam neste aparelho · nenhuma nota real é emitida"
    : meta?.modo === "homologacao"
      ? "HOMOLOGAÇÃO Focus NFe · a nota de teste não tem valor fiscal"
      : "DEMONSTRAÇÃO · sem token Focus · nenhuma nota real é emitida";

  return (
    <div className="app">
      <div className={meta?.modo === "homologacao" ? "banner homo" : "banner"}>{banner}</div>
      {tela.nome === "login" && <Login ocupado={ocupado} erro={erro} onEntrar={entrar} registro={meta?.registroAberto !== false} onCriou={async (nome) => { setUsuario(nome); await carregarPainel(); ir({ nome: "inicio" }); }} />}
      {tela.nome === "inicio" && (
        <Inicio
          empresa={empresa}
          tomadores={tomadores}
          notas={notas}
          onTomador={escolherTomador}
          onNovo={() => ir({ nome: "tomador" })}
          onVoz={() => ir({ nome: "voz" })}
          onRepetir={() => {
            const ultima = notas[0];
            if (!ultima) return;
            setTomadorId(ultima.tomadorId);
            setRascunho({
              tomadorId: ultima.tomadorId,
              servicoId: ultima.servicoId,
              valor: ultima.valor,
              issRetido: ultima.issRetido,
              enviarEmail: ultima.enviarEmail,
              descricao: ultima.descricao,
            });
            ir({ nome: "confirmar" });
          }}
          onEscritorio={() => ir({ nome: "escritorio" })}
        />
      )}
      {tela.nome === "tomador" && <TomadorForm municipios={meta?.municipios ?? []} onCancelar={() => ir({ nome: "inicio" })} onSalvo={async (id) => { await carregarPainel(); escolherTomador(id); }} />}
      {tela.nome === "servico" && (
        <ServicosPasso
          tomador={tomadores.find((item) => item.id === tomadorId) ?? null}
          servicos={servicos}
          notas={notas}
          onVoltar={() => ir({ nome: "inicio" })}
          onEscolher={escolherServico}
        />
      )}
      {tela.nome === "confirmar" && rascunho && (
        <Confirmar
          empresa={empresa}
          tomador={tomadores.find((item) => item.id === rascunho.tomadorId) ?? null}
          servico={servicos.find((item) => item.id === rascunho.servicoId) ?? null}
          rascunho={rascunho}
          ocupado={ocupado}
          erro={erro}
          onChange={setRascunho}
          onVoltar={() => ir({ nome: "servico" })}
          onEmitir={emitir}
        />
      )}
      {tela.nome === "voz" && (
        <Voz
          tomadores={tomadores}
          servicos={servicos}
          onCancelar={() => ir({ nome: "inicio" })}
          onRevisar={(draft) => {
            setTomadorId(draft.tomadorId);
            setRascunho(draft);
            ir({ nome: "confirmar" });
          }}
        />
      )}
      {tela.nome === "sucesso" && <Sucesso notaId={tela.notaId} modo={meta?.modo ?? "mock"} onNova={() => ir({ nome: "inicio" })} onAbrir={(id) => ir({ nome: "nota", id })} onAtualizou={carregarPainel} />}
      {tela.nome === "notas" && <Notas notas={notas} onAbrir={(id) => ir({ nome: "nota", id })} />}
      {tela.nome === "nota" && <NotaDetalhe id={tela.id} onVoltar={() => ir({ nome: "notas" })} onMudou={carregarPainel} />}
      {tela.nome === "escritorio" && (
        <Escritorio
          usuario={usuario}
          empresas={empresas}
          ativaId={empresaId}
          onUsar={usarEmpresa}
          onEditar={(id) => ir({ nome: "empresa", id })}
          onNova={() => ir({ nome: "empresa" })}
          onServicos={() => ir({ nome: "servicos" })}
          onSair={async () => { await api("/api/auth/logout", { method: "POST" }); ir({ nome: "login" }); }}
        />
      )}
      {tela.nome === "empresa" && (
        <EmpresaForm
          id={tela.id}
          municipios={meta?.municipios ?? []}
          empresasApi={meta?.empresasApi ?? false}
          onVoltar={() => ir({ nome: "escritorio" })}
          onSalvo={carregarPainel}
        />
      )}
      {tela.nome === "servicos" && <ListaServicos servicos={servicos} onNovo={() => ir({ nome: "servicoForm" })} onEditar={(id) => ir({ nome: "servicoForm", id })} onVoltar={() => ir({ nome: "escritorio" })} />}
      {tela.nome === "servicoForm" && (
        <ServicoForm
          id={tela.id}
          atual={servicos.find((item) => item.id === tela.id) ?? null}
          exigeMunicipal={empresa?.caminho?.caminho === "municipal_goiania"}
          onVoltar={() => ir({ nome: "servicos" })}
          onSalvo={async () => { await carregarPainel(); ir({ nome: "servicos" }); }}
        />
      )}
      {mostraNav && (
        <nav className="nav">
          <button className={tela.nome === "inicio" ? "on" : ""} onClick={() => ir({ nome: "inicio" })}>Emitir</button>
          <button className={tela.nome === "notas" ? "on" : ""} onClick={() => ir({ nome: "notas" })}>Notas</button>
          <button className={tela.nome === "escritorio" || tela.nome === "servicos" ? "on" : ""} onClick={() => ir({ nome: "escritorio" })}>Escritório</button>
        </nav>
      )}
    </div>
  );
}

function Topo({ titulo, sub, escuro, ok, voltar, progresso }: { titulo: string; sub?: string; escuro?: boolean; ok?: boolean; voltar?: () => void; progresso?: number }) {
  return (
    <div className={`top${escuro ? " dark" : ""}${ok ? " ok" : ""}`}>
      <div className="brand"><span>NotaFácil</span>{voltar && <button onClick={voltar}>‹ voltar</button>}</div>
      <h2>{titulo}</h2>
      {sub && <div className="sub">{sub}</div>}
      {progresso && <div className="prog">{[1, 2, 3].map((passo) => <i key={passo} className={passo <= progresso ? "on" : ""} />)}</div>}
    </div>
  );
}

function Login({ ocupado, erro, registro, onEntrar, onCriou }: { ocupado: boolean; erro: string; registro: boolean; onEntrar: (email: string, senha: string) => void; onCriou: (nome: string) => void }) {
  const [email, setEmail] = useState("contador@notafacil.local");
  const [senha, setSenha] = useState("");
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [falha, setFalha] = useState("");

  async function criar() {
    setFalha("");
    try {
      const me = await api<{ nome: string }>("/api/auth/registrar", { method: "POST", body: JSON.stringify({ nome, email, senha }) });
      onCriou(me.nome);
    } catch (erroCriacao) {
      setFalha(erroCriacao instanceof ApiError ? erroCriacao.message : "Não foi possível criar a conta.");
    }
  }

  return (
    <>
      <Topo titulo="Entrar" sub="NFS-e para o escritório em Goiás" />
      <div className="main">
        {criando && <><div className="lbl">Seu nome</div><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do contador" /></>}
        <div className="lbl">E-mail</div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        <div className="lbl">Senha</div>
        <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" placeholder={criando ? "mínimo 6 caracteres" : ""} />
        {(erro || falha) && <p className="hint err">{erro || falha}</p>}
        {criando ? (
          <button className="btn" onClick={criar}>Criar conta</button>
        ) : (
          <button className="btn" disabled={ocupado} onClick={() => onEntrar(email, senha)}>{ocupado ? "Entrando…" : "Entrar"}</button>
        )}
        {registro && <button className="btn ghost" onClick={() => { setCriando(!criando); setFalha(""); }}>{criando ? "Já tenho conta" : "Criar uma conta"}</button>}
        <p className="hint">Demonstração: contador@notafacil.local · senha notafacil</p>
      </div>
    </>
  );
}

function Inicio({ empresa, tomadores, notas, onTomador, onNovo, onVoz, onRepetir, onEscritorio }: {
  empresa: Empresa | null;
  tomadores: Tomador[];
  notas: Nota[];
  onTomador: (id: string) => void;
  onNovo: () => void;
  onVoz: () => void;
  onRepetir: () => void;
  onEscritorio: () => void;
}) {
  const [busca, setBusca] = useState("");
  const lista = tomadores.filter((cliente) => {
    const q = busca.toLowerCase();
    const digitos = busca.replace(/\D/g, "");
    if (!q) return true;
    return cliente.razaoSocial.toLowerCase().includes(q) || (digitos && (cliente.cnpj ?? "").replace(/\D/g, "").includes(digitos));
  });
  return (
    <>
      <Topo titulo="Para quem?" progresso={1} />
      <div className="main">
        <button className="cl" onClick={onEscritorio}>
          <div className="av" style={{ background: "#0f172a" }}>{empresa ? iniciais(empresa.nomeFantasia || empresa.razaoSocial) : "+"}</div>
          <div className="grow">
            <b>{empresa ? (empresa.nomeFantasia || empresa.razaoSocial) : "Cadastrar empresa"}</b>
            <small>{empresa ? `${empresa.regimeLabel} · ${empresa.municipio}` : "Nenhuma empresa selecionada"}</small>
          </div>
        </button>
        {empresa?.caminho && <span className={empresa.caminho.caminho === "municipal_goiania" ? "pill city" : "pill"}>{empresa.caminho.titulo}</span>}
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente ou CNPJ" style={{ marginTop: 12 }} />
        <div className="lbl">Frequentes</div>
        {lista.map((cliente, indice) => (
          <button key={cliente.id} className="cl" onClick={() => onTomador(cliente.id)}>
            <div className="av" style={{ background: CORES[indice % CORES.length] }}>{iniciais(cliente.razaoSocial)}</div>
            <div><b>{cliente.razaoSocial}</b><small>{cliente.cnpj} · {cliente.ultimaLabel}</small></div>
          </button>
        ))}
        {!lista.length && <p className="hint">Nenhum cliente. Use “Novo cliente”.</p>}
        <button className="new" onClick={onNovo}>+ Novo cliente (CNPJ)</button>
        <button className="btn" disabled={!notas.length} onClick={onRepetir}>↻ Repetir última nota</button>
        <button className="btn dark" onClick={onVoz}>🎙️ Falar nota</button>
      </div>
    </>
  );
}

function TomadorForm({ municipios, onCancelar, onSalvo }: { municipios: MunicipioGo[]; onCancelar: () => void; onSalvo: (id: string) => void }) {
  const [cnpj, setCnpj] = useState("");
  const [form, setForm] = useState({ razaoSocial: "", email: "", telefone: "", logradouro: "", numero: "", complemento: "", bairro: "", codigoIbge: "5208707", municipio: "Goiânia", uf: "GO", cep: "" });
  const [erro, setErro] = useState("");
  const [buscando, setBuscando] = useState(false);

  async function buscar() {
    setBuscando(true);
    setErro("");
    try {
      const dados = await api<Record<string, string>>(`/api/cnpj/${cnpj.replace(/\D/g, "")}`);
      setForm((atual) => ({
        ...atual,
        razaoSocial: String(dados.razaoSocial ?? ""),
        email: String(dados.email ?? ""),
        telefone: String(dados.telefone ?? ""),
        logradouro: String(dados.logradouro ?? ""),
        numero: String(dados.numero ?? ""),
        complemento: String(dados.complemento ?? ""),
        bairro: String(dados.bairro ?? ""),
        municipio: String(dados.municipio ?? atual.municipio),
        uf: String(dados.uf ?? "GO"),
        cep: formatarCep(String(dados.cep ?? "")),
        codigoIbge: String(dados.codigoIbge ?? atual.codigoIbge),
      }));
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Falha na consulta.");
    } finally {
      setBuscando(false);
    }
  }

  async function salvar() {
    setErro("");
    try {
      const criado = await api<{ id: string }>("/api/tomadores", {
        method: "POST",
        body: JSON.stringify({ ...form, cnpj, cep: form.cep }),
      });
      onSalvo(criado.id);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível salvar.");
    }
  }

  return (
    <>
      <Topo titulo="Novo cliente" voltar={onCancelar} />
      <div className="main">
        <div className="lbl">CNPJ</div>
        <input inputMode="numeric" value={cnpj} placeholder="00.000.000/0001-00" onChange={(e) => setCnpj(formatarCnpj(e.target.value))} />
        <button className="btn ghost" onClick={buscar} disabled={buscando}>{buscando ? "Buscando…" : "Buscar dados"}</button>
        <div className="lbl">Razão social</div>
        <input value={form.razaoSocial} onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })} />
        <div className="lbl">E-mail</div>
        <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <div className="lbl">Logradouro</div>
        <input value={form.logradouro} onChange={(e) => setForm({ ...form, logradouro: e.target.value })} />
        <div className="lbl">Número</div>
        <input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
        <div className="lbl">Bairro</div>
        <input value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} />
        <div className="lbl">CEP</div>
        <input inputMode="numeric" value={form.cep} onChange={(e) => setForm({ ...form, cep: formatarCep(e.target.value) })} />
        <div className="lbl">Município</div>
        <select value={municipios.some((item) => item.ibge === form.codigoIbge) ? form.codigoIbge : "outro"} onChange={(e) => {
          const ibge = e.target.value;
          if (ibge === "outro") setForm({ ...form, codigoIbge: "" });
          else setForm({ ...form, codigoIbge: ibge, municipio: municipios.find((item) => item.ibge === ibge)?.nome ?? form.municipio, uf: "GO" });
        }}>
          {municipios.map((item) => <option key={item.ibge} value={item.ibge}>{item.nome}</option>)}
          <option value="outro">Outro código IBGE</option>
        </select>
        {!municipios.some((item) => item.ibge === form.codigoIbge) && <input inputMode="numeric" placeholder="Código IBGE" value={form.codigoIbge} onChange={(e) => setForm({ ...form, codigoIbge: e.target.value.replace(/\D/g, "").slice(0, 7) })} />}
        {erro && <p className="hint err">{erro}</p>}
        <button className="btn" onClick={salvar}>Salvar cliente</button>
      </div>
    </>
  );
}

function ServicosPasso({ tomador, servicos, notas, onVoltar, onEscolher }: {
  tomador: Tomador | null;
  servicos: Servico[];
  notas: Nota[];
  onVoltar: () => void;
  onEscolher: (id: string, valor?: number) => void;
}) {
  const ultima = notas.find((nota) => nota.tomadorId === tomador?.id);
  return (
    <>
      <Topo titulo="Qual serviço?" sub={tomador?.razaoSocial} voltar={onVoltar} progresso={2} />
      <div className="main">
        {ultima && <button className="chip" onClick={() => onEscolher(ultima.servicoId, ultima.valor)}>Sugestão: {ultima.servicoNome} — igual à última nota</button>}
        {servicos.map((servico) => (
          <button key={servico.id} className="svc" onClick={() => onEscolher(servico.id)}>
            <b>{servico.nome}</b>
            <p>{servico.descricao}</p>
            <div className="tags"><span>Cód. {servico.codigoLc116}</span><span>ISS {servico.aliquotaIss}%</span></div>
          </button>
        ))}
        {!servicos.length && <p className="hint">Cadastre um serviço no escritório antes de emitir.</p>}
      </div>
    </>
  );
}

function Confirmar({ empresa, tomador, servico, rascunho, ocupado, erro, onChange, onVoltar, onEmitir }: {
  empresa: Empresa | null;
  tomador: Tomador | null;
  servico: Servico | null;
  rascunho: Rascunho;
  ocupado: boolean;
  erro: string;
  onChange: (rascunho: Rascunho) => void;
  onVoltar: () => void;
  onEmitir: () => void;
}) {
  const [textoValor, setTextoValor] = useState(rascunho.valor ? formatarBrlInput(rascunho.valor) : "");
  const valor = parseValorBr(textoValor) ?? 0;
  const aliquota = servico?.aliquotaIss ?? 0;
  const totais = calcularIss(valor, aliquota, rascunho.issRetido);
  return (
    <>
      <Topo titulo="Confirmar" voltar={onVoltar} progresso={3} />
      <div className="main">
        <div className="line"><span>Cliente</span><b>{tomador?.razaoSocial}</b></div>
        <div className="line"><span>Serviço</span><b>{servico?.nome} · {servico?.codigoLc116}</b></div>
        <div className="line"><span>Envio</span><b>{empresa?.caminho?.titulo ?? "—"}</b></div>
        <div className="lbl">Descrição na nota</div>
        <textarea value={rascunho.descricao} onChange={(e) => onChange({ ...rascunho, descricao: e.target.value })} />
        <div className="lbl">Valor (toque para editar)</div>
        <div className="val"><span>R$</span><input inputMode="decimal" value={textoValor} onChange={(e) => {
          setTextoValor(e.target.value);
          onChange({ ...rascunho, valor: parseValorBr(e.target.value) ?? 0 });
        }} /></div>
        <div className="line"><span>ISS estimado ({aliquota}%)</span><b>{formatarBrl(totais.valorIss)}</b></div>
        <div className="line"><span>{rascunho.issRetido ? "Valor líquido" : "Valor do serviço"}</span><b>{formatarBrl(totais.liquido)}</b></div>
        <button className="tg" onClick={() => onChange({ ...rascunho, issRetido: !rascunho.issRetido })}>
          ISS retido pelo tomador <div className={rascunho.issRetido ? "sw on" : "sw"} />
        </button>
        <button className="tg" onClick={() => onChange({ ...rascunho, enviarEmail: !rascunho.enviarEmail })}>
          Enviar cópia por e-mail <div className={rascunho.enviarEmail ? "sw on" : "sw"} />
        </button>
        <p className="hint">{rascunho.enviarEmail && tomador?.email ? `O e-mail do tomador (${tomador.email}) vai no pedido.` : "A nota não leva e-mail do tomador."} O ISS exibido é a estimativa do cadastro; a prefeitura calcula o valor oficial.</p>
        {empresa?.caminho && <div className="caminho"><b>{empresa.caminho.titulo}</b><p>{empresa.caminho.detalhe}</p></div>}
        {erro && <p className="hint err">{erro}</p>}
        <button className="btn green" disabled={ocupado || valor <= 0} onClick={onEmitir}>{ocupado ? "Enviando…" : "✓ Emitir nota"}</button>
      </div>
    </>
  );
}

function Voz({ tomadores, servicos, onCancelar, onRevisar }: {
  tomadores: Tomador[];
  servicos: Servico[];
  onCancelar: () => void;
  onRevisar: (rascunho: Rascunho) => void;
}) {
  const [ouvindo, setOuvindo] = useState(false);
  const [status, setStatus] = useState("Toque e diga, ex.: “nota de 1500 reais para Construtora X, limpeza pós-obra”");
  const [texto, setTexto] = useState("");
  const [rascunho, setRascunho] = useState<null | { valor: number | null; tomadorId: string | null; tomadorNome: string | null; servicoId: string | null; servicoNome: string | null; avisos: string[] }>(null);
  const [tomadorId, setTomadorId] = useState("");
  const [servicoId, setServicoId] = useState("");
  const [valorTexto, setValorTexto] = useState("");

  async function interpretar(frase: string) {
    setTexto(frase);
    const resposta = await api<{ valor: number | null; tomadorId: string | null; tomadorNome: string | null; servicoId: string | null; servicoNome: string | null; avisos: string[] }>("/api/voz/interpretar", {
      method: "POST",
      body: JSON.stringify({ texto: frase }),
    });
    setRascunho(resposta);
    setTomadorId(resposta.tomadorId ?? "");
    setServicoId(resposta.servicoId ?? "");
    setValorTexto(resposta.valor != null ? formatarBrlInput(resposta.valor) : "");
  }

  function ouvir() {
    const SR = (window as unknown as { SpeechRecognition?: new () => Reconhecimento; webkitSpeechRecognition?: new () => Reconhecimento }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => Reconhecimento }).webkitSpeechRecognition;
    if (!SR) {
      setStatus("Reconhecimento de voz indisponível neste navegador. Use o texto ou “Simular áudio”.");
      return;
    }
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    setOuvindo(true);
    setStatus("Ouvindo… fale agora");
    rec.onresult = (evento) => {
      const resultados = Array.from(evento.results);
      const frase = resultados.map((item) => item[0].transcript).join(" ");
      setTexto(frase);
      if (resultados.at(-1)?.isFinal) void interpretar(frase);
    };
    rec.onerror = () => setStatus("Erro no microfone. Digite a frase ou use “Simular áudio”.");
    rec.onend = () => setOuvindo(false);
    rec.start();
  }

  const valor = parseValorBr(valorTexto);
  const servico = servicos.find((item) => item.id === servicoId);
  const tomador = tomadores.find((item) => item.id === tomadorId);
  const pronto = Boolean(valor && valor > 0 && servico && tomador);

  return (
    <>
      <Topo titulo="Falar nota" escuro voltar={onCancelar} />
      <div className="main">
        <div className="rec">
          <button className={ouvindo ? "bigmic live" : "bigmic"} onClick={ouvir}>🎙️</button>
          <small>{status}</small>
        </div>
        <div className="tr">{texto ? `“${texto}”` : "…"}</div>
        <div className="lbl">Ou digite a frase</div>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="nota de 1500 reais para Construtora X, limpeza pós-obra" />
        <button className="btn ghost" onClick={() => interpretar(texto || "nota de 1500 reais para Construtora X, limpeza pós-obra")}>▶ Simular áudio</button>
        {rascunho && (
          <div>
            <div className="lbl">Rascunho <i className="ai">voz</i></div>
            <div className="draft">
              <div className="line"><span>Cliente</span><b>{rascunho.tomadorNome ?? "não encontrado"}</b></div>
              <div className="line"><span>Serviço</span><b>{rascunho.servicoNome ?? "não encontrado"}</b></div>
              <div className="line" style={{ border: 0 }}><span>Valor</span><b>{rascunho.valor != null ? formatarBrl(rascunho.valor) : "—"}</b></div>
            </div>
            {rascunho.avisos.map((aviso) => <p key={aviso} className="hint err">{aviso}</p>)}
            <div className="lbl">Ajuste antes de revisar</div>
            <select value={tomadorId} onChange={(e) => setTomadorId(e.target.value)}>
              <option value="">Cliente</option>
              {tomadores.map((item) => <option key={item.id} value={item.id}>{item.razaoSocial}</option>)}
            </select>
            <select value={servicoId} onChange={(e) => setServicoId(e.target.value)}>
              <option value="">Serviço</option>
              {servicos.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
            </select>
            <input inputMode="decimal" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} placeholder="Valor" />
            <button className="btn" disabled={!pronto} onClick={() => pronto && tomador && servico && valor && onRevisar({
              tomadorId: tomador.id,
              servicoId: servico.id,
              valor,
              issRetido: false,
              enviarEmail: Boolean(tomador.email),
              descricao: servico.descricao,
            })}>Revisar e confirmar</button>
            <p className="hint">A nota só é emitida depois da confirmação na tela seguinte.</p>
          </div>
        )}
      </div>
    </>
  );
}

type Reconhecimento = {
  lang: string;
  interimResults: boolean;
  start: () => void;
  onresult: (evento: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void;
  onerror: () => void;
  onend: () => void;
};

function Sucesso({ notaId, modo, onNova, onAbrir, onAtualizou }: { notaId: string; modo: Modo; onNova: () => void; onAbrir: (id: string) => void; onAtualizou: () => Promise<unknown> }) {
  const [nota, setNota] = useState<Nota | null>(null);
  useEffect(() => {
    let ativo = true;
    async function atualizar() {
      const dados = await api<Nota>(`/api/notas/${notaId}`);
      if (ativo) setNota(dados);
      if (dados.status !== "processando_autorizacao") void onAtualizou();
      return dados.status;
    }
    atualizar();
    const timer = setInterval(async () => {
      const status = await atualizar();
      if (status !== "processando_autorizacao") clearInterval(timer);
    }, 1500);
    return () => { ativo = false; clearInterval(timer); };
  }, [notaId]);
  const processando = !nota || nota.status === "processando_autorizacao";
  return (
    <>
      <Topo titulo={processando ? "Enviando…" : nota?.status === "autorizado" ? "Nota emitida!" : "Nota não autorizada"} ok={nota?.status === "autorizado"} />
      <div className="main">
        <div className="okic">{nota?.status === "erro_autorizacao" ? "⚠️" : processando ? "⏳" : "✅"}</div>
        <div className="num">NFS-e nº<b>{nota?.numero ?? (processando ? "aguardando" : "—")}</b></div>
        <div className="draft" style={{ marginTop: 16 }}>
          <div className="line"><span>Cliente</span><b>{nota?.tomadorNome}</b></div>
          <div className="line"><span>Serviço</span><b>{nota?.servicoNome}</b></div>
          <div className="line" style={{ border: 0 }}><span>Valor</span><b>{nota ? formatarBrl(nota.valor) : ""}</b></div>
        </div>
        <p className="hint" style={{ textAlign: "center" }}>
          {modo === "mock" ? "Modo demonstração: nada foi enviado à prefeitura." : "Homologação Focus: sem valor fiscal."}
          {nota?.enviarEmail ? " O e-mail do tomador foi incluído no pedido." : ""}
        </p>
        {nota?.status === "erro_autorizacao" && <p className="hint err">{textoErro(nota.erros)}</p>}
        <button className="btn ghost" onClick={() => onAbrir(notaId)}>Ver nota</button>
        <button className="btn" onClick={onNova}>+ Nova nota</button>
      </div>
    </>
  );
}

function Notas({ notas, onAbrir }: { notas: Nota[]; onAbrir: (id: string) => void }) {
  return (
    <>
      <Topo titulo="Notas" />
      <div className="main">
        {!notas.length && <p className="hint">Nenhuma nota desta empresa ainda.</p>}
        {notas.map((nota) => (
          <button key={nota.id} className="cl nota" onClick={() => onAbrir(nota.id)}>
            <div className="grow">
              <b>{nota.numero ? `NFS-e ${nota.numero}` : nota.tomadorNome}</b>
              <small>{nota.tomadorNome} · {nota.servicoNome} · {formatarBrl(nota.valor)}</small>
            </div>
            <span className={`badge ${classeStatus(nota.status)}`}>{STATUS[nota.status] ?? nota.status}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function NotaDetalhe({ id, onVoltar, onMudou }: { id: string; onVoltar: () => void; onMudou: () => Promise<unknown> }) {
  const [nota, setNota] = useState<Nota | null>(null);
  const [justificativa, setJustificativa] = useState("Serviço não prestado conforme o combinado.");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function ler() {
    const dados = await api<Nota>(`/api/notas/${id}`);
    setNota(dados);
    return dados.status;
  }

  useEffect(() => {
    let ativo = true;
    ler();
    const timer = setInterval(async () => {
      const status = await ler();
      if (!ativo || status !== "processando_autorizacao") clearInterval(timer);
    }, 2000);
    return () => { ativo = false; clearInterval(timer); };
  }, [id]);

  async function baixar(tipo: "pdf" | "xml") {
    setErro("");
    try {
      await baixarNota(id, tipo);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível baixar o arquivo.");
    }
  }

  async function cancelar() {
    setOcupado(true);
    setErro("");
    try {
      const dados = await api<Nota>(`/api/notas/${id}/cancelar`, { method: "POST", body: JSON.stringify({ justificativa }) });
      setNota(dados);
      await onMudou();
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível cancelar.");
    } finally {
      setOcupado(false);
    }
  }

  if (!nota) return <div className="main"><p className="hint">Carregando…</p></div>;
  return (
    <>
      <Topo titulo={nota.numero ? `NFS-e ${nota.numero}` : "Nota"} voltar={onVoltar} />
      <div className="main">
        <span className={`badge ${classeStatus(nota.status)}`}>{STATUS[nota.status] ?? nota.status}</span>
        <div className="draft">
          <div className="line"><span>Cliente</span><b>{nota.tomadorNome}</b></div>
          <div className="line"><span>Serviço</span><b>{nota.servicoNome}</b></div>
          <div className="line"><span>Valor</span><b>{formatarBrl(nota.valor)}</b></div>
          <div className="line"><span>ISS estimado</span><b>{formatarBrl(nota.valorIss)}</b></div>
          <div className="line" style={{ border: 0 }}><span>Caminho</span><b>{nota.caminho === "municipal_goiania" ? "ISSNet / SGISS" : "Emissor Nacional"}</b></div>
        </div>
        <p className="hint">{nota.descricao}</p>
        {nota.codigoVerificacao && <p className="hint">Código de verificação: {nota.codigoVerificacao}</p>}
        {textoErro(nota.erros) && <p className="hint err">{textoErro(nota.erros)}</p>}
        {nota.urlConsulta && <a className="btn ghost" href={nota.urlConsulta} target="_blank" rel="noreferrer">Consultar no portal</a>}
        {nota.temPdf && <button className="btn" type="button" onClick={() => baixar("pdf")}>Baixar PDF</button>}
        {nota.temXml && <button className="btn ghost" type="button" onClick={() => baixar("xml")}>Baixar XML</button>}
        {nota.status === "autorizado" && (
          <>
            <div className="lbl">Cancelar nota</div>
            <textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
            <p className="hint">{justificativa.trim().length}/255 · mínimo 15</p>
            {erro && <p className="hint err">{erro}</p>}
            <button className="btn warn" disabled={ocupado || justificativa.trim().length < 15} onClick={cancelar}>Cancelar nota</button>
          </>
        )}
      </div>
    </>
  );
}

function Escritorio({ usuario, empresas, ativaId, onUsar, onEditar, onNova, onServicos, onSair }: {
  usuario: string;
  empresas: Empresa[];
  ativaId: string | null;
  onUsar: (id: string) => void;
  onEditar: (id: string) => void;
  onNova: () => void;
  onServicos: () => void;
  onSair: () => void;
}) {
  return (
    <>
      <Topo titulo="Escritório" sub={usuario} />
      <div className="main">
        {empresas.map((empresa) => (
          <div key={empresa.id} className="card">
            <h3>{empresa.nomeFantasia || empresa.razaoSocial}</h3>
            <p className="hint">{empresa.cnpj} · IM {empresa.inscricaoMunicipal}</p>
            <p className="hint">{empresa.regimeLabel} · {empresa.municipio}</p>
            <div style={{ marginTop: 8 }}>
              <span className={empresa.caminho?.caminho === "municipal_goiania" ? "pill city" : "pill"}>{empresa.caminho?.titulo ?? "Fora do escopo"}</span>
              {ativaId === empresa.id && <span className="badge ok" style={{ marginLeft: 6 }}>Em uso</span>}
            </div>
            <div className="rowbtns" style={{ marginTop: 10 }}>
              {ativaId !== empresa.id && <button className="btn" onClick={() => onUsar(empresa.id)}>Usar esta</button>}
              <button className="btn ghost" onClick={() => onEditar(empresa.id)}>Dados</button>
            </div>
          </div>
        ))}
        <button className="new" onClick={onNova}>+ Nova empresa</button>
        <button className="btn ghost" disabled={!ativaId} onClick={onServicos}>Serviços da empresa em uso</button>
        <button className="btn dark" onClick={onSair}>Sair</button>
      </div>
    </>
  );
}

function EmpresaForm({ id, municipios, empresasApi, onVoltar, onSalvo }: {
  id?: string;
  municipios: MunicipioGo[];
  empresasApi: boolean;
  onVoltar: () => void;
  onSalvo: () => Promise<unknown>;
}) {
  const [form, setForm] = useState({
    cnpj: "", razaoSocial: "", nomeFantasia: "", inscricaoMunicipal: "", regime: "simples_nacional" as Regime,
    codigoIbge: "5201108", municipio: "Anápolis", logradouro: "", numero: "", bairro: "", cep: "", email: "", telefone: "",
  });
  const [erro, setErro] = useState("");
  const [salvoId, setSalvoId] = useState(id);
  const [certInstrucoes, setCertInstrucoes] = useState<string[]>([]);
  const [certStatus, setCertStatus] = useState("");
  const [senhaCert, setSenhaCert] = useState("");
  const [arquivo, setArquivo] = useState("");

  useEffect(() => {
    if (!id) return;
    api<{ empresas: Empresa[] }>("/api/empresas").then((lista) => {
      const empresa = lista.empresas.find((item) => item.id === id);
      if (!empresa) return;
      setForm({
        cnpj: empresa.cnpj,
        razaoSocial: empresa.razaoSocial,
        nomeFantasia: empresa.nomeFantasia ?? "",
        inscricaoMunicipal: empresa.inscricaoMunicipal,
        regime: empresa.regime,
        codigoIbge: empresa.codigoIbge,
        municipio: empresa.municipio,
        logradouro: empresa.logradouro,
        numero: empresa.numero,
        bairro: empresa.bairro,
        cep: formatarCep(empresa.cep),
        email: empresa.email ?? "",
        telefone: empresa.telefone ?? "",
      });
      setCertStatus(empresa.certificadoStatus);
    });
    api<{ instrucoes: string[]; certificadoStatus: string }>(`/api/empresas/${id}/certificado`).then((dados) => {
      setCertInstrucoes(dados.instrucoes);
      setCertStatus(dados.certificadoStatus);
    }).catch(() => undefined);
  }, [id]);

  const caminho = useMemo(() => resolverCaminho({ regime: form.regime, codigoIbge: form.codigoIbge || "0000000", uf: "GO" }), [form.regime, form.codigoIbge]);

  async function salvar() {
    setErro("");
    try {
      const metodo = salvoId ? "PATCH" : "POST";
      const url = salvoId ? `/api/empresas/${salvoId}` : "/api/empresas";
      const empresa = await api<Empresa>(url, { method: metodo, body: JSON.stringify(form) });
      setSalvoId(empresa.id);
      setCertStatus(empresa.certificadoStatus);
      const cert = await api<{ instrucoes: string[] }>(`/api/empresas/${empresa.id}/certificado`);
      setCertInstrucoes(cert.instrucoes);
      await onSalvo();
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível salvar.");
    }
  }

  async function enviarCertificado(manual: boolean) {
    if (!salvoId) return;
    setErro("");
    try {
      const dados = await api<{ certificadoStatus: string; instrucoes: string[] }>(`/api/empresas/${salvoId}/certificado`, {
        method: "POST",
        body: JSON.stringify(manual ? { manual: true } : { arquivoBase64: arquivo, senha: senhaCert }),
      });
      setCertStatus(dados.certificadoStatus);
      setCertInstrucoes(dados.instrucoes);
      setSenhaCert("");
      setArquivo("");
      await onSalvo();
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Falha no certificado.");
    }
  }

  return (
    <>
      <Topo titulo={id ? "Empresa" : "Nova empresa"} voltar={onVoltar} />
      <div className="main">
        <div className="lbl">CNPJ</div>
        <input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: formatarCnpj(e.target.value) })} />
        <div className="lbl">Razão social</div>
        <input value={form.razaoSocial} onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })} />
        <div className="lbl">Nome fantasia</div>
        <input value={form.nomeFantasia} onChange={(e) => setForm({ ...form, nomeFantasia: e.target.value })} />
        <div className="lbl">Inscrição municipal</div>
        <input value={form.inscricaoMunicipal} onChange={(e) => setForm({ ...form, inscricaoMunicipal: e.target.value })} />
        <div className="lbl">Regime</div>
        <select value={form.regime} onChange={(e) => setForm({ ...form, regime: e.target.value as Regime })}>
          {Object.entries(LABEL_REGIME).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
        </select>
        <div className="lbl">Município em Goiás</div>
        <select value={municipios.some((item) => item.ibge === form.codigoIbge) ? form.codigoIbge : "outro"} onChange={(e) => {
          if (e.target.value === "outro") setForm({ ...form, codigoIbge: "" });
          else setForm({ ...form, codigoIbge: e.target.value, municipio: municipios.find((item) => item.ibge === e.target.value)?.nome ?? "" });
        }}>
          {municipios.map((item) => <option key={item.ibge} value={item.ibge}>{item.nome}</option>)}
          <option value="outro">Outro código IBGE</option>
        </select>
        {!municipios.some((item) => item.ibge === form.codigoIbge) && <input placeholder="Código IBGE" value={form.codigoIbge} onChange={(e) => setForm({ ...form, codigoIbge: e.target.value.replace(/\D/g, "").slice(0, 7) })} />}
        <div className="lbl">CEP, rua, número, bairro</div>
        <input placeholder="CEP" value={form.cep} onChange={(e) => setForm({ ...form, cep: formatarCep(e.target.value) })} />
        <input placeholder="Logradouro" value={form.logradouro} onChange={(e) => setForm({ ...form, logradouro: e.target.value })} />
        <input placeholder="Número" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
        <input placeholder="Bairro" value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} />
        <div className="caminho">
          <b>{caminho.ok ? caminho.titulo : "Não emite"}</b>
          <p>{caminho.ok ? caminho.detalhe : caminho.erro}</p>
        </div>
        {erro && <p className="hint err">{erro}</p>}
        <button className="btn" onClick={salvar}>Salvar empresa</button>
        {salvoId && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3>Certificado A1</h3>
            <p className="hint">Situação: {certStatus || "pendente"}</p>
            {certInstrucoes.map((linha) => <p key={linha} className="hint">{linha}</p>)}
            <input type="file" accept=".pfx,.p12" onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const leitor = new FileReader();
              leitor.onload = () => setArquivo(String(leitor.result ?? ""));
              leitor.readAsDataURL(file);
            }} />
            <input type="password" placeholder="Senha do certificado" value={senhaCert} onChange={(e) => setSenhaCert(e.target.value)} autoComplete="new-password" />
            <button className="btn ghost" disabled={!arquivo || !senhaCert} onClick={() => enviarCertificado(false)}>
              {empresasApi ? "Enviar certificado à Focus" : "Validar arquivo (não grava)"}
            </button>
            <button className="btn ghost" onClick={() => enviarCertificado(true)}>Já cadastrei no painel da Focus</button>
          </div>
        )}
      </div>
    </>
  );
}

function ListaServicos({ servicos, onNovo, onEditar, onVoltar }: { servicos: Servico[]; onNovo: () => void; onEditar: (id: string) => void; onVoltar: () => void }) {
  return (
    <>
      <Topo titulo="Serviços" voltar={onVoltar} />
      <div className="main">
        {servicos.map((servico) => (
          <button key={servico.id} className="svc" onClick={() => onEditar(servico.id)}>
            <b>{servico.nome}</b>
            <p>{servico.descricao}</p>
            <div className="tags">
              <span>LC {servico.codigoLc116}</span>
              <span>Nac. {servico.codigoNacional}</span>
              {servico.codigoMunicipal && <span>Mun. {servico.codigoMunicipal}</span>}
              <span>ISS {servico.aliquotaIss}%</span>
            </div>
          </button>
        ))}
        <button className="new" onClick={onNovo}>+ Novo serviço</button>
      </div>
    </>
  );
}

function ServicoForm({ id, atual, exigeMunicipal, onVoltar, onSalvo }: {
  id?: string;
  atual: Servico | null;
  exigeMunicipal: boolean;
  onVoltar: () => void;
  onSalvo: () => void;
}) {
  const [form, setForm] = useState({
    nome: atual?.nome ?? "",
    descricao: atual?.descricao ?? "",
    codigoLc116: atual?.codigoLc116 ?? "",
    codigoMunicipal: atual?.codigoMunicipal ?? "",
    codigoNbs: atual?.codigoNbs ?? "",
    aliquotaIss: atual ? String(atual.aliquotaIss) : "5",
  });
  const [erro, setErro] = useState("");
  useEffect(() => {
    if (!atual) return;
    setForm({
      nome: atual.nome,
      descricao: atual.descricao,
      codigoLc116: atual.codigoLc116,
      codigoMunicipal: atual.codigoMunicipal ?? "",
      codigoNbs: atual.codigoNbs ?? "",
      aliquotaIss: String(atual.aliquotaIss),
    });
  }, [atual?.id]);

  async function salvar() {
    setErro("");
    try {
      const corpo = { ...form, aliquotaIss: Number(form.aliquotaIss.replace(",", ".")) };
      if (id) await api(`/api/servicos/${id}`, { method: "PATCH", body: JSON.stringify(corpo) });
      else await api("/api/servicos", { method: "POST", body: JSON.stringify(corpo) });
      onSalvo();
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível salvar.");
    }
  }

  return (
    <>
      <Topo titulo={id ? "Serviço" : "Novo serviço"} voltar={onVoltar} />
      <div className="main">
        <div className="lbl">Nome</div>
        <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        <div className="lbl">Descrição na nota</div>
        <textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
        <div className="lbl">Item da LC 116</div>
        <input value={form.codigoLc116} placeholder="07.10" onChange={(e) => setForm({ ...form, codigoLc116: e.target.value })} />
        <div className="lbl">Código tributário municipal {exigeMunicipal ? "(obrigatório em Goiânia no lucro)" : "(opcional)"}</div>
        <input value={form.codigoMunicipal} onChange={(e) => setForm({ ...form, codigoMunicipal: e.target.value })} />
        <div className="lbl">NBS (opcional)</div>
        <input value={form.codigoNbs} onChange={(e) => setForm({ ...form, codigoNbs: e.target.value })} />
        <div className="lbl">Alíquota ISS %</div>
        <input inputMode="decimal" value={form.aliquotaIss} onChange={(e) => setForm({ ...form, aliquotaIss: e.target.value })} />
        {erro && <p className="hint err">{erro}</p>}
        <button className="btn" onClick={salvar}>Salvar serviço</button>
      </div>
    </>
  );
}
