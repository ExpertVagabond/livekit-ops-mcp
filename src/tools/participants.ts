import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ParticipantInfo_State, TrackSource, TrackType, type ParticipantInfo } from "livekit-server-sdk";
import type { LiveKitClients } from "../clients.js";
import { guard, ok } from "../util.js";

const HINT = "Check the room name and participant identity with participant_list.";

export function summarizeParticipant(p: ParticipantInfo) {
  return {
    identity: p.identity,
    name: p.name,
    sid: p.sid,
    state: ParticipantInfo_State[p.state] ?? String(p.state),
    kind: p.kind,
    isPublisher: p.isPublisher,
    joinedAt: Number(p.joinedAt),
    metadata: p.metadata,
    attributes: p.attributes,
    permission: p.permission
      ? {
          canPublish: p.permission.canPublish,
          canSubscribe: p.permission.canSubscribe,
          canPublishData: p.permission.canPublishData,
          hidden: p.permission.hidden,
        }
      : undefined,
    tracks: p.tracks.map((t) => ({
      sid: t.sid,
      type: TrackType[t.type] ?? String(t.type),
      source: TrackSource[t.source] ?? String(t.source),
      name: t.name,
      muted: t.muted,
    })),
  };
}

export function registerParticipantTools(server: McpServer, lk: LiveKitClients): void {
  server.registerTool(
    "participant_list",
    {
      title: "List participants",
      description: "Lists participants in a room with their state, permissions and published tracks.",
      inputSchema: { room: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      guard(async () => {
        const list = await lk.rooms.listParticipants(args.room);
        return ok({ room: args.room, count: list.length, participants: list.map(summarizeParticipant) });
      }, HINT),
  );

  server.registerTool(
    "participant_get",
    {
      title: "Get participant",
      description: "Returns one participant's full info including track SIDs (needed for participant_mute_track).",
      inputSchema: { room: z.string().min(1), identity: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      guard(async () => ok(summarizeParticipant(await lk.rooms.getParticipant(args.room, args.identity))), HINT),
  );

  server.registerTool(
    "participant_remove",
    {
      title: "Remove participant",
      description: "Disconnects a participant from the room. Their token stays valid unless you revoke it.",
      inputSchema: { room: z.string().min(1), identity: z.string().min(1) },
      annotations: { destructiveHint: true },
    },
    async (args) =>
      guard(async () => {
        await lk.rooms.removeParticipant(args.room, args.identity);
        return ok({ room: args.room, removed: args.identity });
      }, HINT),
  );

  server.registerTool(
    "participant_mute_track",
    {
      title: "Mute or unmute a track",
      description: "Server-side mute of a published track. Get the trackSid from participant_get.",
      inputSchema: {
        room: z.string().min(1),
        identity: z.string().min(1),
        trackSid: z.string().min(1),
        muted: z.boolean().default(true),
      },
    },
    async (args) =>
      guard(async () => ok(await lk.rooms.mutePublishedTrack(args.room, args.identity, args.trackSid, args.muted)), HINT),
  );

  server.registerTool(
    "participant_update",
    {
      title: "Update participant",
      description:
        "Updates a participant's display name, metadata, attributes or permissions. Permissions are replaced atomically: pass every permission you want to keep.",
      inputSchema: {
        room: z.string().min(1),
        identity: z.string().min(1),
        name: z.string().optional(),
        metadata: z.string().optional(),
        attributes: z.record(z.string()).optional().describe("Set a key to empty string to remove it"),
        permission: z
          .object({
            canPublish: z.boolean().optional(),
            canSubscribe: z.boolean().optional(),
            canPublishData: z.boolean().optional(),
            hidden: z.boolean().optional(),
          })
          .optional(),
      },
    },
    async (args) =>
      guard(async () => {
        const info = await lk.rooms.updateParticipant(args.room, args.identity, {
          name: args.name,
          metadata: args.metadata,
          attributes: args.attributes,
          permission: args.permission,
        });
        return ok(summarizeParticipant(info));
      }, HINT),
  );
}
