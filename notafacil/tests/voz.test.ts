import { describe, expect, it } from "vitest";
import { interpretarNotaFalada, type CatalogoVoz } from "../src/domain/voz.js";

const catalogo: CatalogoVoz = {
  tomadores: [
    { id: "x", nome: "Construtora X Ltda" },
    { id: "ex", nome: "Empresa Exemplo Ltda" },
    { id: "alfa", nome: "Alfa Serviços" },
  ],
  servicos: [
    { id: "limpeza", nome: "Limpeza pós-obra" },
    { id: "consultoria", nome: "Consultoria empresarial" },
    { id: "suporte", nome: "Suporte técnico mensal" },
  ],
};

describe("interpretação da nota falada", () => {
  it("entende a frase de exemplo com valor, cliente e serviço", () => {
    const rascunho = interpretarNotaFalada("nota de 1500 reais para Construtora X, limpeza pós-obra", catalogo);
    expect(rascunho.valor).toBe(1500);
    expect(rascunho.tomadorId).toBe("x");
    expect(rascunho.servicoId).toBe("limpeza");
    expect(rascunho.avisos).toEqual([]);
  });

  it("aceita milhar brasileiro, centavos e número por extenso", () => {
    expect(interpretarNotaFalada("nota de 1.500,50 para Construtora X, limpeza pós-obra", catalogo).valor).toBe(1500.5);
    expect(interpretarNotaFalada("emite nota de dois mil reais pra Empresa Exemplo, consultoria", catalogo)).toMatchObject({
      valor: 2000,
      tomadorId: "ex",
      servicoId: "consultoria",
    });
    expect(interpretarNotaFalada("nota de mil e quinhentos reais para Construtora X, limpeza pós-obra", catalogo).valor).toBe(1500);
    expect(interpretarNotaFalada("nota de dois mil e quinhentos reais para Alfa, suporte técnico", catalogo)).toMatchObject({
      valor: 2500,
      tomadorId: "alfa",
      servicoId: "suporte",
    });
    expect(interpretarNotaFalada("nota de R$ 2.000,00 para Empresa Exemplo, consultoria empresarial", catalogo).valor).toBe(2000);
  });

  it("encontra o serviço no meio da frase quando não há vírgula", () => {
    const rascunho = interpretarNotaFalada("nota de 800 reais para Construtora X limpeza pós-obra", catalogo);
    expect(rascunho.tomadorId).toBe("x");
    expect(rascunho.servicoId).toBe("limpeza");
    expect(rascunho.valor).toBe(800);
  });

  it("não inventa cliente nem serviço e não emite nada", () => {
    const rascunho = interpretarNotaFalada("nota de 90 reais para Cliente Inexistente, jardinagem", catalogo);
    expect(rascunho.valor).toBe(90);
    expect(rascunho.tomadorId).toBeNull();
    expect(rascunho.servicoId).toBeNull();
    expect(rascunho.avisos.length).toBeGreaterThan(0);
    expect(interpretarNotaFalada("oi", catalogo).valor).toBeNull();
  });
});
