import { describe, expect, it } from "vitest";
import { loadConfig, toHttp, toWs } from "../../src/config.js";
import { plain, slug } from "../../src/util.js";

describe("config", () => {
  it("defaults to the livekit-server --dev keys", () => {
    const c = loadConfig({});
    expect(c.apiHost).toBe("http://localhost:7880");
    expect(c.wsUrl).toBe("ws://localhost:7880");
    expect(c.apiKey).toBe("devkey");
    expect(c.apiSecret).toBe("secret");
  });

  it("accepts a wss:// cloud URL and derives the http host", () => {
    const c = loadConfig({ LIVEKIT_URL: "wss://demo.livekit.cloud/", LIVEKIT_API_KEY: "APIx", LIVEKIT_API_SECRET: "s" });
    expect(c.apiHost).toBe("https://demo.livekit.cloud");
    expect(c.wsUrl).toBe("wss://demo.livekit.cloud");
    expect(c.apiKey).toBe("APIx");
  });

  it("converts schemes both ways", () => {
    expect(toHttp("ws://a")).toBe("http://a");
    expect(toHttp("wss://a")).toBe("https://a");
    expect(toWs("http://a")).toBe("ws://a");
    expect(toWs("https://a")).toBe("wss://a");
  });
});

describe("util", () => {
  it("plain() converts bigint fields", () => {
    expect(plain({ t: 1700000000n, n: [1n, 2] })).toEqual({ t: 1700000000, n: [1, 2] });
  });

  it("slug() normalises event names", () => {
    expect(slug("SF Voice Agent Hackathon, Oct 2026!")).toBe("sf-voice-agent-hackathon-oct-2026");
    expect(slug("  Otters  ")).toBe("otters");
  });
});
