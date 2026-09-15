import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Protobuf messages carry bigint fields; JSON.stringify refuses them. */
export function plain<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
      if (v && typeof v === "object" && typeof (v as { toJson?: unknown }).toJson === "function") {
        return (v as { toJson: () => unknown }).toJson();
      }
      return v;
    }),
  );
}

export function ok(payload: unknown, text?: string): CallToolResult {
  const body = text ?? JSON.stringify(plain(payload), null, 2);
  return { content: [{ type: "text", text: body }], structuredContent: asRecord(payload) };
}

export function fail(err: unknown, hint?: string): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  const text = hint ? `${message}\n\nHint: ${hint}` : message;
  return { isError: true, content: [{ type: "text", text }] };
}

function asRecord(payload: unknown): Record<string, unknown> | undefined {
  const p = plain(payload);
  if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
  if (Array.isArray(p)) return { items: p };
  return undefined;
}

/** Wraps a tool body so SDK errors become MCP error results instead of transport failures. */
export async function guard(fn: () => Promise<CallToolResult>, hint?: string): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return fail(err, hint);
  }
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function ms(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
}
