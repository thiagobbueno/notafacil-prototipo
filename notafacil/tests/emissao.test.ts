import { describe, expect, it } from "vitest";
import { linhasPdf, pdfDemonstracao } from "../src/domain/documento.js";
import {
  flagsEmpresaFocus,
  montarEmissao,
  requisicaoCancelamento,
  requisicaoEmissao,
  resolverCaminho,
  type EmpresaFiscal,
  type NotaFiscalInput,
} from "../src/domain/emissao.js";
import { cnpjValido, codigoNacionalIss, gerarCnpj } from "../src/domain/format.js";
import { chamarFocus } from "../src/server/focus.js";

const quando = new Date("2026-10-21T15:04:05Z");

function empresa(parcial: Partial<EmpresaFiscal> & Pick<EmpresaFiscal, "regime" | "codigoIbge">): EmpresaFiscal {
  return {
    cnpj: "11.111.111/0001-91",
    razaoSocial: "Empresa Teste",
    inscricaoMunicipal: "12345",
    uf: "GO",
    municipio: "Goiás",
    ...parcial,
  };
}

function nota(empresaFiscal: EmpresaFiscal, extras: Partial<NotaFiscalInput> = {}): NotaFiscalInput {
  return {
    empresa: empresaFiscal,
    tomador: {
      cnpj: "22.222.222/0001-43",
      razaoSocial: "Construtora X Ltda",
      email: "financeiro@construtorax.example",
      telefone: "6230000000",
      logradouro: "Rua da Obra",
      numero: "1500",
      bairro: "Setor Bueno",
      codigoIbge: "5208707",
      uf: "GO",
      cep: "74210-010",
    },
    servico: {
      nome: "Limpeza pós-obra",
      descricao: "Limpeza pós-obra",
      codigoNacional: "071001",
      codigoMunicipal: "710",
      codigoNbs: null,
      aliquotaIss: 5,
    },
    valor: 1500,
    issRetido: false,
    descricao: "Limpeza pós-obra",
    emitidoEm: quando,
    ...extras,
  };
}

describe("caminhos de emissão em Goiás", () => {
  it("manda Simples Nacional de qualquer cidade ao Emissor Nacional", () => {
    const pronta = montarEmissao(nota(empresa({ regime: "simples_nacional", codigoIbge: "5201108" })));
    expect(pronta.caminho).toBe("emissor_nacional");
    expect(pronta.habilitarAmbienteNacional).toBe(true);
    expect(pronta.endpoint).toBe("/v2/nfsen");
    expect(pronta.body.codigo_opcao_simples_nacional).toBe(3);
    expect(pronta.body.codigo_municipio_emissora).toBe(5201108);
    expect(pronta.body.cnpj_prestador).toBe("11111111000191");
    expect(pronta.body.cnpj_tomador).toBe("22222222000143");
    expect(pronta.body.cep_tomador).toBe("74210010");
    expect(pronta.body.codigo_tributacao_nacional_iss).toBe("071001");
    expect(pronta.body.valor_servico).toBe(1500);
    expect(pronta.body.tipo_retencao_iss).toBe(1);
    expect(pronta.body.tributacao_iss).toBe(1);
    expect(pronta.body).not.toHaveProperty("codigo_tributacao_municipal_iss");
    expect(pronta.body.data_emissao).toBe("2026-10-21T12:04:05-0300");
    expect(pronta.body.data_competencia).toBe("2026-10-21");
    const flags = flagsEmpresaFocus(empresa({ regime: "simples_nacional", codigoIbge: "5208707" }));
    expect(flags).toEqual({
      regime_tributario: 1,
      habilita_nfse: false,
      habilita_nfsen_homologacao: true,
      habilita_nfsen_producao: false,
    });
  });

  it("trata MEI como optante MEI no Emissor Nacional, inclusive em Aparecida", () => {
    const pronta = montarEmissao(nota(empresa({ regime: "mei", codigoIbge: "5201405" })));
    expect(pronta.caminho).toBe("emissor_nacional");
    expect(pronta.body.codigo_opcao_simples_nacional).toBe(2);
    expect(flagsEmpresaFocus(empresa({ regime: "mei", codigoIbge: "5201405" })).regime_tributario).toBe(4);
  });

  it("manda lucro presumido ou real de Aparecida ao Emissor Nacional", () => {
    const pronta = montarEmissao(nota(empresa({ regime: "lucro_real", codigoIbge: "5201405", razaoSocial: "Oficina Real" })));
    expect(pronta.caminho).toBe("emissor_nacional");
    expect(pronta.body.codigo_opcao_simples_nacional).toBe(1);
    expect(pronta.body).not.toHaveProperty("codigo_tributacao_municipal_iss");
  });

  it("manda lucro presumido de Goiânia ao ISSNet/SGISS, com código municipal", () => {
    const pronta = montarEmissao(nota(empresa({ regime: "lucro_presumido", codigoIbge: "5208707" }), {
      issRetido: true,
      servico: {
        nome: "Limpeza pós-obra",
        descricao: "Limpeza pós-obra",
        codigoNacional: "071001",
        codigoMunicipal: "710",
        codigoNbs: "123456789",
        aliquotaIss: 5,
      },
    }));
    expect(pronta.caminho).toBe("municipal_goiania");
    expect(pronta.provedor).toBe("issnet");
    expect(pronta.habilitarAmbienteNacional).toBe(false);
    expect(pronta.endpoint).toBe("/v2/nfsen");
    expect(pronta.body.codigo_opcao_simples_nacional).toBe(1);
    expect(pronta.body.codigo_municipio_emissora).toBe(5208707);
    expect(pronta.body.codigo_tributacao_municipal_iss).toBe("710");
    expect(pronta.body.codigo_nbs).toBe("123456789");
    expect(pronta.body.tipo_retencao_iss).toBe(2);
    expect(pronta.body).not.toHaveProperty("percentual_total_tributos_simples_nacional");
    expect(flagsEmpresaFocus(empresa({ regime: "lucro_real", codigoIbge: "5208707" }))).toMatchObject({
      regime_tributario: 3,
      habilita_nfse: true,
      habilita_nfsen_homologacao: false,
      habilita_nfsen_producao: false,
    });
  });

  it("recusa Goiânia no lucro sem código municipal e lucro fora de Goiânia", () => {
    expect(() => montarEmissao(nota(empresa({ regime: "lucro_presumido", codigoIbge: "5208707" }), {
      servico: {
        nome: "Limpeza",
        descricao: "Limpeza",
        codigoNacional: "071001",
        codigoMunicipal: "",
        aliquotaIss: 5,
      },
    }))).toThrow(/código tributário municipal/);
    expect(resolverCaminho({ regime: "lucro_presumido", codigoIbge: "5218805", uf: "GO" }).ok).toBe(false);
    expect(resolverCaminho({ regime: "simples_nacional", codigoIbge: "3550308", uf: "SP" }).ok).toBe(false);
  });

  it("aponta a emissão só para a homologação da Focus", async () => {
    const pedido = requisicaoEmissao("nf1", { valor_servico: 10 });
    expect(pedido.url).toBe("https://homologacao.focusnfe.com.br/v2/nfsen?ref=nf1");
    expect(requisicaoCancelamento("nf1", "Servico nao prestado conforme combinado").method).toBe("DELETE");
    await expect(chamarFocus({
      url: "https://api.focusnfe.com.br/v2/nfsen?ref=nf1",
      method: "POST",
      token: "segredo",
      body: {},
      fetchImpl: async () => ({ status: 200, text: "{}" }),
    })).rejects.toThrow(/homologação/);
    expect(cnpjValido(gerarCnpj("111111110001"))).toBe(true);
    expect(codigoNacionalIss("07.10")).toBe("071001");
    expect(codigoNacionalIss("01.07")).toBe("010701");
    const pdf = pdfDemonstracao(linhasPdf({
      numero: "1",
      prestador: "A",
      tomador: "B",
      descricao: "Limpeza",
      valor: 10,
      caminho: "emissor_nacional",
      status: "autorizado",
    }));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
