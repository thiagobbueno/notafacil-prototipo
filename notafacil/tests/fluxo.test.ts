import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";

let base = "";
let server: Server;
let cookie = "";

async function chamar(caminho: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const resposta = await fetch(`${base}${caminho}`, { ...init, headers });
  const texto = await resposta.text();
  let json: unknown = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: resposta.status, json, texto, headers: resposta.headers };
}

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "notafacil-"));
  const app = await createApp({
    dataDir: dir,
    client: false,
    webhookSecret: "segredo-webhook",
    registroAberto: true,
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endereco = server.address();
  if (!endereco || typeof endereco === "string") throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
  const login = await chamar("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "contador@notafacil.local", senha: "notafacil" }),
  });
  cookie = login.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  expect(login.status).toBe(200);
});

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server.close((erro) => erro ? reject(erro) : resolve()));
});

describe("fluxo de demonstração", () => {
  it("entra sem token, emite pelos dois caminhos, baixa PDF/XML e cancela", async () => {
    const meta = await chamar("/api/meta");
    expect(meta.json).toMatchObject({ modo: "mock" });

    const empresas = await chamar("/api/empresas");
    const lista = (empresas.json as { empresas: { id: string; caminho: { caminho: string } }[] }).empresas;
    expect(lista.find((item) => item.id === "emp-simples")?.caminho.caminho).toBe("emissor_nacional");
    expect(lista.find((item) => item.id === "emp-goiania")?.caminho.caminho).toBe("municipal_goiania");
    expect(lista.find((item) => item.id === "emp-mei")?.caminho.caminho).toBe("emissor_nacional");

    await chamar("/api/sessao/empresa", { method: "POST", body: JSON.stringify({ id: "emp-goiania" }) });
    const municipal = await chamar("/api/notas", {
      method: "POST",
      body: JSON.stringify({
        tomadorId: "emp-goiania-tom-x",
        servicoId: "emp-goiania-srv-limpeza",
        valor: 1500,
        issRetido: false,
        enviarEmail: true,
        descricao: "Limpeza pós-obra",
      }),
    });
    expect(municipal.status).toBe(201);
    const idMunicipal = (municipal.json as { id: string; status: string }).id;
    expect((municipal.json as { status: string }).status).toBe("processando_autorizacao");
    const consultada = await chamar(`/api/notas/${idMunicipal}`);
    const notaMunicipal = consultada.json as {
      status: string;
      numero: string;
      payload: { caminho: string; habilitarAmbienteNacional: boolean; body: Record<string, unknown> };
      temPdf: boolean;
    };
    expect(notaMunicipal.status).toBe("autorizado");
    expect(notaMunicipal.numero).toMatch(/\d{6}/);
    expect(notaMunicipal.payload.caminho).toBe("municipal_goiania");
    expect(notaMunicipal.payload.habilitarAmbienteNacional).toBe(false);
    expect(notaMunicipal.payload.body.codigo_tributacao_municipal_iss).toBe("710");
    expect(notaMunicipal.payload.body.codigo_opcao_simples_nacional).toBe(1);

    const pdf = await fetch(`${base}/api/notas/${idMunicipal}/pdf`, { headers: { cookie } });
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    const xml = await chamar(`/api/notas/${idMunicipal}/xml`);
    expect(xml.texto).toContain("Construtora X");
    expect(xml.texto).toContain("demonstracao");

    const cancelada = await chamar(`/api/notas/${idMunicipal}/cancelar`, {
      method: "POST",
      body: JSON.stringify({ justificativa: "Serviço não prestado conforme o combinado com o cliente." }),
    });
    expect((cancelada.json as { status: string }).status).toBe("cancelado");

    await chamar("/api/sessao/empresa", { method: "POST", body: JSON.stringify({ id: "emp-simples" }) });
    const nacional = await chamar("/api/notas", {
      method: "POST",
      body: JSON.stringify({
        tomadorId: "emp-simples-tom-x",
        servicoId: "emp-simples-srv-limpeza",
        valor: 1500,
        issRetido: true,
        descricao: "Limpeza pós-obra",
      }),
    });
    const idNacional = (nacional.json as { id: string }).id;
    const notaNacional = (await chamar(`/api/notas/${idNacional}`)).json as {
      payload: { caminho: string; body: Record<string, unknown> };
    };
    expect(notaNacional.payload.caminho).toBe("emissor_nacional");
    expect(notaNacional.payload.body.codigo_opcao_simples_nacional).toBe(3);
    expect(notaNacional.payload.body.tipo_retencao_iss).toBe(2);
    expect(notaNacional.payload.body).not.toHaveProperty("codigo_tributacao_municipal_iss");

    const voz = await chamar("/api/voz/interpretar", {
      method: "POST",
      body: JSON.stringify({ texto: "nota de 1500 reais para Construtora X, limpeza pós-obra" }),
    });
    expect(voz.json).toMatchObject({ valor: 1500, tomadorId: "emp-simples-tom-x", servicoId: "emp-simples-srv-limpeza", avisos: [] });
  });

  it("atualiza a nota pelo webhook e recusa chamada sem o segredo", async () => {
    await chamar("/api/sessao/empresa", { method: "POST", body: JSON.stringify({ id: "emp-mei" }) });
    const criada = await chamar("/api/notas", {
      method: "POST",
      body: JSON.stringify({
        tomadorId: "emp-mei-tom-x",
        servicoId: "emp-mei-srv-consultoria",
        valor: 300,
        descricao: "Consultoria empresarial",
      }),
    });
    const nota = criada.json as { id: string; ref: string; status: string };
    expect(nota.status).toBe("processando_autorizacao");
    const negado = await chamar("/api/webhooks/focus", {
      method: "POST",
      body: JSON.stringify({ ref: nota.ref, status: "autorizado", numero: "0000999" }),
    });
    expect(negado.status).toBe(401);
    const aceito = await fetch(`${base}/api/webhooks/focus`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "segredo-webhook" },
      body: JSON.stringify({ ref: nota.ref, status: "autorizado", numero: "0000999", codigo_verificacao: "ABC" }),
    });
    expect(aceito.status).toBe(200);
    const lida = await chamar(`/api/notas/${nota.id}`);
    expect(lida.json).toMatchObject({ status: "autorizado", numero: "0000999", codigoVerificacao: "ABC" });
  });
});
