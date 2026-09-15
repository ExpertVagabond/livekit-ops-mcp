export interface LiveKitConfig {
  /** Server API host, http(s) form. ws(s):// URLs are converted. */
  apiHost: string;
  /** WebSocket URL handed to participants (ws(s)://). */
  wsUrl: string;
  apiKey: string;
  apiSecret: string;
  /** Base URL of a LiveKit Meet-style page that accepts ?liveKitUrl=&token=. */
  meetUrl: string;
}

export function toHttp(url: string): string {
  return url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
}

export function toWs(url: string): string {
  return url.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
}

/**
 * Reads LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET from the environment.
 * Defaults match `livekit-server --dev` (http://localhost:7880, devkey / secret)
 * so the server runs against a local dev instance with zero configuration.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): LiveKitConfig {
  const raw = env.LIVEKIT_URL?.trim() || "http://localhost:7880";
  const apiKey = env.LIVEKIT_API_KEY?.trim() || "devkey";
  const apiSecret = env.LIVEKIT_API_SECRET?.trim() || "secret";
  const meetUrl = env.LIVEKIT_MEET_URL?.trim() || "https://meet.livekit.io/custom";
  return {
    apiHost: toHttp(raw).replace(/\/+$/, ""),
    wsUrl: toWs(raw).replace(/\/+$/, ""),
    apiKey,
    apiSecret,
    meetUrl,
  };
}
