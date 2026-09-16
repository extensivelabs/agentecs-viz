import { describe, expect, it } from "vitest";
import { fetchBackendIdentity } from "../lib/metadata";

function respondWith(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

describe("fetchBackendIdentity", () => {
  it("maps source_type to sourceType", async () => {
    const result = await fetchBackendIdentity(
      respondWith({
        name: "AgentECS Visualizer",
        version: "0.4.1",
        source_type: "MockWorldSource",
        tick: 12,
      }),
    );

    expect(result).toEqual({
      ok: true,
      identity: {
        name: "AgentECS Visualizer",
        version: "0.4.1",
        sourceType: "MockWorldSource",
      },
    });
  });

  it("reports network failure when the request rejects", async () => {
    const rejecting = (async () => {
      throw new TypeError("failed to fetch");
    }) as typeof fetch;

    expect(await fetchBackendIdentity(rejecting)).toEqual({
      ok: false,
      reason: "network",
    });
  });

  it("reports the status code for a non-ok response", async () => {
    expect(await fetchBackendIdentity(respondWith({}, 404))).toEqual({
      ok: false,
      reason: "http 404",
    });
  });

  it("reports bad payload for a body that is not JSON", async () => {
    const notJson = (async () => new Response("<html>nope</html>")) as typeof fetch;

    expect(await fetchBackendIdentity(notJson)).toEqual({
      ok: false,
      reason: "bad payload",
    });
  });

  it("reports bad payload for a missing field", async () => {
    const result = await fetchBackendIdentity(
      respondWith({ name: "AgentECS Visualizer", source_type: "MockWorldSource" }),
    );

    expect(result).toEqual({ ok: false, reason: "bad payload" });
  });

  it("reports bad payload for a non-string field", async () => {
    const result = await fetchBackendIdentity(
      respondWith({ name: 7, version: "0.4.1", source_type: "MockWorldSource" }),
    );

    expect(result).toEqual({ ok: false, reason: "bad payload" });
  });
});
