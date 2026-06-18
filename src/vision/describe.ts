import type { OcxProviderConfig } from "../types";
import { FORWARD_HEADERS } from "../adapters/openai-responses";
import { parseSidecarSSE } from "../web-search/parse";

export interface VisionSettings {
  model: string;
  timeoutMs: number;
}

/** A description, or an `error` string when it couldn't run (caller injects a graceful marker). */
export type DescribeOutcome = { text: string; error?: string };

/**
 * Describe ONE image via a gpt vision model through the ChatGPT forward backend — the path that has
 * native image input. Reuses the caller's forwarded OAuth headers. The user's own request text is
 * passed as context so the description is focused. Never throws — returns `{error}` on failure.
 */
export async function describeImage(
  imageUrl: string,
  detail: string | undefined,
  contextText: string,
  forwardProvider: OcxProviderConfig,
  incomingHeaders: Headers,
  settings: VisionSettings,
): Promise<DescribeOutcome> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (forwardProvider.headers) Object.assign(headers, forwardProvider.headers);
  for (const h of FORWARD_HEADERS) {
    const v = incomingHeaders.get(h);
    if (v) headers[h] = v;
  }
  const content: unknown[] = [];
  if (contextText) content.push({ type: "input_text", text: `The user's request about this image: ${contextText}` });
  content.push({ type: "input_image", image_url: imageUrl, detail: detail ?? "high" });

  const body = {
    model: settings.model,
    instructions:
      "You are a vision describer for a text-only model that cannot see the image. Describe the image " +
      "thoroughly and factually so that model can fully reason about it: transcribe any visible text " +
      "verbatim, and note UI/layout, colors, branding/logos, charts, and notable details. Focus on " +
      "what's relevant to the user's request. Output only the description.",
    input: [{ type: "message", role: "user", content }],
    reasoning: { effort: "low" },
    store: false,
    stream: true,
  };
  try {
    const res = await fetch(`${forwardProvider.baseUrl}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(settings.timeoutMs),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { text: "", error: `vision sidecar HTTP ${res.status}: ${t.slice(0, 200)}` };
    }
    const parsed = await parseSidecarSSE(res);
    return { text: parsed.text };
  } catch (e) {
    return { text: "", error: e instanceof Error ? e.message : String(e) };
  }
}
