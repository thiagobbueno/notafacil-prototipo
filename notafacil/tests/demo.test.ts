import { describe, expect, it } from "vitest";
import { criarLoja, memoriaKv } from "../src/demo/loja.js";

describe("demonstração no navegador", () => {
  it("mantém login, os dois caminhos, PDF, XML, cancelamento e voz só no aparelho", async () => {
    const kv = memoriaKv();
    const loja = criarLoja(kv);
    const meta = await loja.despachar({ method: "GET", caminho: "/api/meta" });
    expect(meta.status).toBe(200);
    expect(meta.json).toMatchObject({ modo: "mock", estatico: true, empresasApi: false });

    const ruim = await loja.despachar({
      method: "POST",
      caminho: "/api/auth/login",
      body: { email: "contador@notafacil.local", senha: "errada" },
    });
    expect(ruim.status).toBe(401);

    const login = await loja.despachar({
      method: "POST",
      caminho: "/api/auth/login",
      body: { email: "Contador@NotaFacil.local", senha: "notafacil" },
    });
    expect(login.status).toBe(200);
    expect(login.json).toMatchObject({ nome: "Escritório Contábil", empresaId: "emp-simples" });

    const empresas = await loja.despachar({ method: "GET", caminho: "/api/empresas" });
    expect(empresas.json).toMatchObject({ ativaId: "emp-simples" });

    const voz = await loja.despachar({
      method: "POST",
      caminho: "/api/voz/interpretar",
      body: { texto: "nota de 1500 reais para Construtora X, limpeza pós-obra" },
    });
    expect(voz.json).toMatchObject({
      valor: 1500,
      tomadorId: "emp-simples-tom-x",
      servicoId: "emp-simples-srv-limpeza",
    });

    const nota = await loja.despachar({
      method: "POST",
      caminho: "/api/notas",
      body: {
        tomadorId: "emp-simples-tom-x",
        servicoId: "emp-simples-srv-limpeza",
        valor: 1500,
        issRetido: true,
        descricao: "Limpeza pós-obra",
      },
    });
    expect(nota.status).toBe(201);
    const criada = nota.json as { id: string; status: string; payload: { body: Record<string, unknown> }; caminho: string };
    expect(criada.status).toBe("processando_autorizacao");
    expect(criada.caminho).toBe("emissor_nacional");
    expect(criada.payload.body.codigo_opcao_simples_nacional).toBe(3);
    expect(criada.payload.body.codigo_tributacao_municipal_iss).toBeUndefined();
    expect(criada.payload.body.tipo_retencao_iss).toBe(2);

    const detalhe = await loja.despachar({ method: "GET", caminho: `/api/notas/${criada.id}` });
    expect(detalhe.json).toMatchObject({ status: "autorizado", numero: "001044", temPdf: true, temXml: true });

    const pdf = await loja.despachar({ method: "GET", caminho: `/api/notas/${criada.id}/pdf` });
    expect(new TextDecoder().decode(pdf.arquivo?.bytes.subarray(0, 5))).toBe("%PDF-");
    const xml = await loja.despachar({ method: "GET", caminho: `/api/notas/${criada.id}/xml` });
    const xmlTexto = new TextDecoder().decode(xml.arquivo?.bytes);
    expect(xmlTexto).toContain("Construtora X");
    expect(xmlTexto).toContain('ambiente="demonstracao"');

    const cancelada = await loja.despachar({
      method: "POST",
      caminho: `/api/notas/${criada.id}/cancelar`,
      body: { justificativa: "Serviço não prestado conforme combinado." },
    });
    expect(cancelada.json).toMatchObject({ status: "cancelado" });

    const cert = await loja.despachar({
      method: "POST",
      caminho: "/api/empresas/emp-simples/certificado",
      body: { arquivoBase64: "SEGREDOPFX", senha: "senha-a1" },
    });
    expect(cert.json).toMatchObject({ certificadoStatus: "simulado" });
    const gravado = kv.get("notafacil-demo-v1") ?? "";
    expect(gravado).not.toContain("SEGREDOPFX");
    expect(gravado).not.toContain("senha-a1");

    await loja.despachar({ method: "POST", caminho: "/api/sessao/empresa", body: { id: "emp-goiania" } });
    const municipal = await loja.despachar({
      method: "POST",
      caminho: "/api/notas",
      body: {
        tomadorId: "emp-goiania-tom-x",
        servicoId: "emp-goiania-srv-limpeza",
        valor: 1500,
      },
    });
    const goiania = municipal.json as { id: string; caminho: string; payload: { body: Record<string, unknown> } };
    expect(goiania.caminho).toBe("municipal_goiania");
    expect(goiania.payload.body.codigo_tributacao_municipal_iss).toBe("710");
    expect(goiania.payload.body.codigo_opcao_simples_nacional).toBe(1);
    const detalheGo = await loja.despachar({ method: "GET", caminho: `/api/notas/${goiania.id}` });
    expect(detalheGo.json).toMatchObject({ status: "autorizado", numero: "001043" });

    const outraAba = criarLoja(kv);
    const ainda = await outraAba.despachar({ method: "GET", caminho: "/api/auth/me" });
    expect(ainda.status).toBe(200);

    await loja.despachar({ method: "POST", caminho: "/api/auth/logout" });
    const saiu = await criarLoja(kv).despachar({ method: "GET", caminho: "/api/auth/me" });
    expect(saiu.status).toBe(401);
    const deVolta = await criarLoja(kv).despachar({
      method: "POST",
      caminho: "/api/auth/login",
      body: { email: "contador@notafacil.local", senha: "notafacil" },
    });
    expect(deVolta.status).toBe(200);
    const lista = await criarLoja(kv).despachar({ method: "GET", caminho: "/api/notas" });
    const notas = lista.json as { status: string }[];
    expect(notas.some((item) => item.status === "cancelado")).toBe(true);
  });
});
