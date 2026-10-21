import path from "node:path";
import { fileURLToPath } from "node:url";
import { carregarEnv, createApp } from "./app.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
carregarEnv(path.join(raiz, ".env"));

const porta = Number(process.env.PORT || 3000);
const app = await createApp({
  dataDir: path.join(raiz, "data"),
  focusToken: process.env.FOCUS_NFE_TOKEN,
  focusTokenPrincipal: process.env.FOCUS_NFE_TOKEN_PRINCIPAL,
  empresasEfetivar: process.env.FOCUS_EMPRESAS_EFETIVAR === "1",
  webhookSecret: process.env.FOCUS_WEBHOOK_SECRET,
  registroAberto: process.env.NOTAFACIL_REGISTRO !== "fechado",
  client: true,
});

app.listen(porta, "0.0.0.0", () => {
  const modo = process.env.FOCUS_NFE_TOKEN?.trim() ? "homologação Focus" : "demonstração";
  console.log(`NotaFácil em http://localhost:${porta} (${modo})`);
});
