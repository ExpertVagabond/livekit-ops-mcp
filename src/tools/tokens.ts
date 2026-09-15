import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VideoGrant } from "livekit-server-sdk";
import type { LiveKitClients } from "../clients.js";
import { guard, ok } from "../util.js";

export const grantShape = {
  canPublish: z.boolean().default(true),
  canSubscribe: z.boolean().default(true),
  canPublishData: z.boolean().default(true),
  hidden: z.boolean().default(false).describe("Hidden participants are not listed to others"),
  roomAdmin: z.boolean().default(false).describe("Can mute, remove and update other participants"),
  roomRecord: z.boolean().default(false).describe("Can start egress"),
};

export interface MintInput {
  identity: string;
  room: string;
  name?: string;
  ttl?: string;
  metadata?: string;
  attributes?: Record<string, string>;
  grant?: Partial<VideoGrant>;
}

export async function mintJoinToken(lk: LiveKitClients, input: MintInput) {
  const at = lk.newToken({
    identity: input.identity,
    name: input.name ?? input.identity,
    ttl: input.ttl ?? "2h",
    metadata: input.metadata,
    attributes: input.attributes,
  });
  const grant: VideoGrant = {
    roomJoin: true,
    room: input.room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    ...input.grant,
  };
  at.addGrant(grant);
  const token = await at.toJwt();
  return {
    identity: input.identity,
    room: input.room,
    ttl: input.ttl ?? "2h",
    grant,
    token,
    wsUrl: lk.config.wsUrl,
    joinUrl: `${lk.config.meetUrl}?liveKitUrl=${encodeURIComponent(lk.config.wsUrl)}&token=${encodeURIComponent(token)}`,
  };
}

export function registerTokenTools(server: McpServer, lk: LiveKitClients): void {
  server.registerTool(
    "token_create",
    {
      title: "Mint access token",
      description:
        "Mints a scoped JWT for one participant to join one room. Returns the token, the ws URL and a LiveKit Meet join link. Default TTL 2h.",
      inputSchema: {
        room: z.string().min(1),
        identity: z.string().min(1).describe("Unique participant identity within the room"),
        name: z.string().optional().describe("Display name (defaults to identity)"),
        ttl: z.string().optional().describe('Lifetime, e.g. "30m", "2h", "1d" (default 2h)'),
        metadata: z.string().optional(),
        attributes: z.record(z.string()).optional(),
        ...grantShape,
      },
    },
    async (args) =>
      guard(async () =>
        ok(
          await mintJoinToken(lk, {
            room: args.room,
            identity: args.identity,
            name: args.name,
            ttl: args.ttl,
            metadata: args.metadata,
            attributes: args.attributes,
            grant: {
              canPublish: args.canPublish,
              canSubscribe: args.canSubscribe,
              canPublishData: args.canPublishData,
              hidden: args.hidden,
              roomAdmin: args.roomAdmin,
              roomRecord: args.roomRecord,
            },
          }),
        ),
      ),
  );

  server.registerTool(
    "token_verify",
    {
      title: "Verify token",
      description: "Verifies a LiveKit JWT against the configured API secret and returns its claims and grants.",
      inputSchema: { token: z.string().min(10) },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      guard(async () => {
        const claims = await lk.verifier.verify(args.token);
        return ok({ valid: true, claims });
      }, "Token was signed with a different API key/secret, is malformed, or has expired."),
  );
}
