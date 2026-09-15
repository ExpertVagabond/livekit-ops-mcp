import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LiveKitClients } from "../clients.js";
import { guard, ok, ms } from "../util.js";

const HINT = "Is the LiveKit server reachable at LIVEKIT_URL and are LIVEKIT_API_KEY / LIVEKIT_API_SECRET valid?";

export function registerRoomTools(server: McpServer, lk: LiveKitClients): void {
  server.registerTool(
    "server_health",
    {
      title: "Server health",
      description:
        "Round-trips the LiveKit server API (ListRooms) and reports reachability, latency and the configured host. Run this first.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      guard(async () => {
        const t = performance.now();
        const rooms = await lk.rooms.listRooms();
        return ok({
          ok: true,
          apiHost: lk.config.apiHost,
          wsUrl: lk.config.wsUrl,
          apiKey: lk.config.apiKey,
          activeRooms: rooms.length,
          latencyMs: ms(t),
        });
      }, HINT),
  );

  server.registerTool(
    "room_create",
    {
      title: "Create room",
      description:
        "Creates a LiveKit room with explicit settings. Rooms are also auto-created on first join; use this to set timeouts, participant caps and metadata ahead of time.",
      inputSchema: {
        name: z.string().min(1).describe("Room name (unique per project)"),
        emptyTimeout: z.number().int().min(0).optional().describe("Seconds to keep the room open before anyone joins (default 300)"),
        departureTimeout: z.number().int().min(0).optional().describe("Seconds to keep the room open after the last participant leaves"),
        maxParticipants: z.number().int().min(0).optional().describe("Participant cap, 0 = unlimited"),
        metadata: z.string().optional().describe("Free-form room metadata (often JSON)"),
      },
    },
    async (args) =>
      guard(async () => {
        const room = await lk.rooms.createRoom({
          name: args.name,
          emptyTimeout: args.emptyTimeout,
          departureTimeout: args.departureTimeout,
          maxParticipants: args.maxParticipants,
          metadata: args.metadata,
        });
        return ok(room);
      }, HINT),
  );

  server.registerTool(
    "room_list",
    {
      title: "List rooms",
      description: "Lists active rooms. Optionally filter to specific names or a name prefix.",
      inputSchema: {
        names: z.array(z.string()).optional().describe("Exact room names to return"),
        prefix: z.string().optional().describe("Only rooms whose name starts with this prefix"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      guard(async () => {
        let rooms = await lk.rooms.listRooms(args.names?.length ? args.names : undefined);
        if (args.prefix) rooms = rooms.filter((r) => r.name.startsWith(args.prefix as string));
        return ok({
          count: rooms.length,
          rooms: rooms.map((r) => ({
            name: r.name,
            sid: r.sid,
            numParticipants: r.numParticipants,
            numPublishers: r.numPublishers,
            creationTime: Number(r.creationTime),
            emptyTimeout: r.emptyTimeout,
            maxParticipants: r.maxParticipants,
            metadata: r.metadata,
          })),
        });
      }, HINT),
  );

  server.registerTool(
    "room_delete",
    {
      title: "Delete room",
      description: "Deletes a room and disconnects everyone in it.",
      inputSchema: { name: z.string().min(1) },
      annotations: { destructiveHint: true },
    },
    async (args) =>
      guard(async () => {
        await lk.rooms.deleteRoom(args.name);
        return ok({ deleted: args.name });
      }, HINT),
  );

  server.registerTool(
    "room_update_metadata",
    {
      title: "Update room metadata",
      description: "Replaces the room's metadata string. Every participant receives the update.",
      inputSchema: { name: z.string().min(1), metadata: z.string() },
    },
    async (args) =>
      guard(async () => ok(await lk.rooms.updateRoomMetadata(args.name, args.metadata)), HINT),
  );
}
