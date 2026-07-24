import { codeToHtml } from "shiki";

const highlightedCode = new Map<string, Promise<string>>();

export function highlightCodeHtml(code: string, language = "text"): Promise<string> {
  const key = `${language}\0${code}`;
  const cached = highlightedCode.get(key);
  if (cached) return cached;

  const result = render(code, language);
  highlightedCode.set(key, result);
  return result;
}

export async function highlightCodeInner(code: string, language = "text"): Promise<string> {
  const html = await highlightCodeHtml(code, language);
  const document = new DOMParser().parseFromString(html, "text/html");
  return document.querySelector("code")?.innerHTML ?? escapeHtml(code);
}

async function render(code: string, language: string): Promise<string> {
  try {
    return await codeToHtml(code, {
      lang: language || "text",
      themes: { light: "github-light", dark: "github-dark" },
    });
  } catch {
    return codeToHtml(code, {
      lang: "text",
      themes: { light: "github-light", dark: "github-dark" },
    });
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
