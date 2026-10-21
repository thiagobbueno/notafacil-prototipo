import { despacharDemo } from "../demo/loja";

export class ApiError extends Error {}

const paginas = import.meta.env.VITE_PAGES === "1";

export async function api<T>(caminho: string, init?: RequestInit): Promise<T> {
  if (paginas) {
    const corpo = init?.body ? JSON.parse(String(init.body)) as unknown : undefined;
    const resposta = await despacharDemo(init?.method ?? "GET", caminho, corpo);
    if (resposta.status >= 400 || resposta.arquivo) {
      const dados = resposta.json as { erro?: string };
      throw new ApiError(typeof dados.erro === "string" ? dados.erro : "Não foi possível concluir.");
    }
    return resposta.json as T;
  }
  const resposta = await fetch(caminho, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    credentials: "same-origin",
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const mensagem = typeof dados.erro === "string" ? dados.erro : "Não foi possível concluir.";
    throw new ApiError(mensagem);
  }
  return dados as T;
}

export async function baixarNota(id: string, tipo: "pdf" | "xml") {
  if (paginas) {
    const resposta = await despacharDemo("GET", `/api/notas/${id}/${tipo}`);
    if (resposta.status >= 400 || !resposta.arquivo) {
      const dados = resposta.json as { erro?: string };
      throw new ApiError(typeof dados.erro === "string" ? dados.erro : "Arquivo indisponível.");
    }
    const bytes = resposta.arquivo.bytes;
    const copia = new Uint8Array(bytes.byteLength);
    copia.set(bytes);
    const blob = new Blob([copia], { type: resposta.arquivo.contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = resposta.arquivo.nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return;
  }
  const url = `/api/notas/${id}/${tipo}`;
  if (tipo === "pdf") window.open(url, "_blank", "noopener");
  else window.location.assign(url);
}
