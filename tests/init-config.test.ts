import { describe, expect, test } from "bun:test";
import { buildInitConfig } from "../src/cli/init";
import type { OcxProviderConfig } from "../src/types";

const kimi: OcxProviderConfig = {
  adapter: "openai-chat",
  baseUrl: "https://api.kimi.com/coding/v1",
  apiKey: "sk-test",
  defaultModel: "kimi-k2",
};

describe("ocx init config assembly", () => {
  test("keeps the openai passthrough when a non-openai provider is chosen (issue #261)", () => {
    const { config, keptPassthrough } = buildInitConfig("kimi", kimi, 10100);

    // The chosen provider is the default, but the openai forward provider must survive so bare
    // gpt-* requests still route instead of 404ing with NoEnabledOpenAiProviderError.
    expect(config.defaultProvider).toBe("kimi");
    expect(config.providers.kimi).toEqual(kimi);
    expect(config.providers.openai?.authMode).toBe("forward");
    expect(keptPassthrough).toBe(true);
  });

  test("does not report a kept passthrough when openai itself is chosen", () => {
    const openai: OcxProviderConfig = {
      adapter: "openai-responses",
      baseUrl: "https://chatgpt.com/backend-api/codex",
      authMode: "forward",
    };
    const { config, keptPassthrough } = buildInitConfig("openai", openai, 10100);

    expect(config.defaultProvider).toBe("openai");
    expect(config.providers.openai).toEqual(openai);
    expect(keptPassthrough).toBe(false);
  });

  test("honors the chosen port", () => {
    const { config } = buildInitConfig("kimi", kimi, 4321);
    expect(config.port).toBe(4321);
  });
});
