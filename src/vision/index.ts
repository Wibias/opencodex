import type { OcxConfig, OcxContentPart, OcxParsedRequest, OcxProviderConfig, OcxTextContent } from "../types";
import { describeImage, type VisionSettings } from "./describe";

export { describeImage } from "./describe";

const DEFAULT_VISION_MODEL = "gpt-5.4-mini";
const DEFAULT_TIMEOUT_MS = 45_000;

/** First configured forward (ChatGPT passthrough) provider — the path with native image input. */
function findForwardProvider(config: OcxConfig): OcxProviderConfig | undefined {
  for (const prov of Object.values(config.providers)) {
    if (prov.authMode === "forward") return prov;
  }
  return undefined;
}

function messagesHaveImage(parsed: OcxParsedRequest): boolean {
  return parsed.context.messages.some(m =>
    (m.role === "user" || m.role === "developer") &&
    Array.isArray(m.content) && (m.content as OcxContentPart[]).some(p => p.type === "image"));
}

export interface VisionPlan {
  forwardProvider: OcxProviderConfig;
  settings: VisionSettings;
}

/**
 * Decide whether the vision sidecar should pre-describe images for this request, returning the plan
 * if so. Active when: the routed model is in `provider.noVisionModels`, the request actually carries
 * an image, a forward provider exists, the sidecar isn't disabled, and the caller forwarded ChatGPT
 * auth. Returns undefined otherwise (the request takes the normal path — images sent natively).
 */
export function planVisionSidecar(
  config: OcxConfig,
  provider: OcxProviderConfig,
  modelId: string,
  parsed: OcxParsedRequest,
  incomingHeaders: Headers,
): VisionPlan | undefined {
  if (!provider.noVisionModels?.includes(modelId)) return undefined;
  if (!messagesHaveImage(parsed)) return undefined;
  const cfg = config.visionSidecar ?? {};
  if (cfg.enabled === false) return undefined;
  if (!incomingHeaders.get("authorization")) return undefined;
  const forwardProvider = findForwardProvider(config);
  if (!forwardProvider) return undefined;
  return {
    forwardProvider,
    settings: { model: cfg.model ?? DEFAULT_VISION_MODEL, timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS },
  };
}

/**
 * Replace every image part in the request with a gpt-described text part, so a text-only model can
 * reason about it. Mutates `parsed.context.messages` in place; uses the message's own text as the
 * description context. Failures degrade to a short marker (the turn still proceeds).
 */
export async function describeImagesInPlace(
  parsed: OcxParsedRequest,
  forwardProvider: OcxProviderConfig,
  incomingHeaders: Headers,
  settings: VisionSettings,
): Promise<void> {
  for (const msg of parsed.context.messages) {
    if ((msg.role !== "user" && msg.role !== "developer") || !Array.isArray(msg.content)) continue;
    const parts = msg.content as OcxContentPart[];
    if (!parts.some(p => p.type === "image")) continue;
    const contextText = parts
      .filter((p): p is OcxTextContent => p.type === "text")
      .map(p => p.text)
      .join(" ")
      .slice(0, 800);
    const newParts: OcxContentPart[] = [];
    for (const p of parts) {
      if (p.type === "image") {
        const out = await describeImage(p.imageUrl, p.detail, contextText, forwardProvider, incomingHeaders, settings);
        newParts.push({
          type: "text",
          text: out.error
            ? `[An image was attached but could not be processed: ${out.error}]`
            : `[Image content — described by a vision model because you cannot see images directly:\n${out.text.trim()}]`,
        });
      } else {
        newParts.push(p);
      }
    }
    msg.content = newParts;
  }
}
