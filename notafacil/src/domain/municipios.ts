export type MunicipioGo = { ibge: string; nome: string };

/** Municípios de Goiás usados no cadastro. Outros entram pelo código IBGE. */
export const MUNICIPIOS_GO: MunicipioGo[] = [
  { ibge: "5208707", nome: "Goiânia" },
  { ibge: "5201405", nome: "Aparecida de Goiânia" },
  { ibge: "5201108", nome: "Anápolis" },
  { ibge: "5218805", nome: "Rio Verde" },
  { ibge: "5212501", nome: "Luziânia" },
  { ibge: "5200258", nome: "Águas Lindas de Goiás" },
  { ibge: "5221858", nome: "Valparaíso de Goiás" },
  { ibge: "5221403", nome: "Trindade" },
  { ibge: "5208004", nome: "Formosa" },
  { ibge: "5220454", nome: "Senador Canedo" },
  { ibge: "5205109", nome: "Catalão" },
  { ibge: "5211503", nome: "Itumbiara" },
  { ibge: "5211909", nome: "Jataí" },
  { ibge: "5204508", nome: "Caldas Novas" },
  { ibge: "5217609", nome: "Planaltina" },
  { ibge: "5215231", nome: "Novo Gama" },
  { ibge: "5208905", nome: "Goiás" },
];

export const IBGE_GOIANIA = "5208707";
export const IBGE_APARECIDA = "5201405";

export function nomeMunicipio(ibge: string): string {
  return MUNICIPIOS_GO.find((municipio) => municipio.ibge === ibge)?.nome ?? `IBGE ${ibge}`;
}
