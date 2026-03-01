import { afterEach, describe, expect, it, vi } from "vitest";

async function loadConfigModule() {
  vi.resetModules();
  return import("../lib/config");
}

describe("config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds websocket URL from browser location", async () => {
    const config = await loadConfigModule();
    expect(config.WS_URL).toMatch(/^ws(s)?:\/\//);
    expect(config.WS_URL.endsWith("/ws")).toBe(true);
  });

  it("reads token cost budget from env", async () => {
    vi.stubEnv("VITE_TOKEN_COST_BUDGET_USD", "2.5");
    const config = await loadConfigModule();
    expect(config.TOKEN_COST_BUDGET_USD).toBe(2.5);
  });

  it("falls back to default token cost budget for invalid env", async () => {
    vi.stubEnv("VITE_TOKEN_COST_BUDGET_USD", "invalid-value");
    const config = await loadConfigModule();
    expect(config.TOKEN_COST_BUDGET_USD).toBe(1);
  });

  it("exports playback mode class mapping", async () => {
    const config = await loadConfigModule();
    expect(config.PLAYBACK_MODE_TEXT_CLASS.live).toBe("text-success");
    expect(config.PLAYBACK_MODE_TEXT_CLASS.paused).toBe("text-warning");
    expect(config.PLAYBACK_MODE_TEXT_CLASS.history).toBe("text-accent");
    expect(config.PLAYBACK_MODE_TEXT_CLASS.replay).toBe("text-accent");
  });
});
