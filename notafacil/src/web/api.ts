export class ApiError extends Error {}

export async function api<T>(caminho: string, init?: RequestInit): Promise<T> {
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
