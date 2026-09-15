import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  EgressStatus,
  EncodedFileOutput,
  EncodedFileType,
  StreamOutput,
  StreamProtocol,
  type EgressInfo,
} from "livekit-server-sdk";
import type { LiveKitClients } from "../clients.js";
import { guard, ok } from "../util.js";

const HINT =
  "Egress needs the LiveKit Egress service. `livekit-server --dev` alone does not run one; on LiveKit Cloud it is built in.";

export function summarizeEgress(e: EgressInfo) {
  return {
    egressId: e.egressId,
    roomName: e.roomName,
    status: EgressStatus[e.status] ?? String(e.status),
    startedAt: Number(e.startedAt),
    endedAt: Number(e.endedAt),
    error: e.error || undefined,
    files: e.fileResults.map((f) => ({ filename: f.filename, location: f.location, size: Number(f.size) })),
    streams: e.streamResults.map((s) => ({ url: s.url, status: s.status })),
  };
}

export function registerEgressTools(server: McpServer, lk: LiveKitClients): void {
  server.registerTool(
    "egress_start_room_composite",
    {
      title: "Start room recording or stream",
      description:
        "Starts a room-composite egress: records the whole room to a file (MP4/OGG/MP3) or pushes it to RTMP/SRT stream URLs. Exactly one of filepath or streamUrls is required.",
      inputSchema: {
        room: z.string().min(1),
        filepath: z.string().optional().describe('Output path, e.g. "recordings/{room_name}-{time}.mp4" (uploads per egress config)'),
        fileType: z.enum(["MP4", "OGG", "MP3"]).optional(),
        streamUrls: z.array(z.string().url()).optional().describe("RTMP(S) or SRT URLs"),
        layout: z.string().optional().describe('e.g. "grid", "speaker", "single-speaker"'),
        audioOnly: z.boolean().default(false),
      },
    },
    async (args) =>
      guard(async () => {
        if (!args.filepath && !args.streamUrls?.length) throw new Error("Provide filepath or streamUrls.");
        if (args.filepath && args.streamUrls?.length) throw new Error("Provide only one of filepath or streamUrls.");
        const output = args.filepath
          ? new EncodedFileOutput({
              filepath: args.filepath,
              fileType: args.fileType ? EncodedFileType[args.fileType] : EncodedFileType.DEFAULT_FILETYPE,
            })
          : new StreamOutput({
              protocol: StreamProtocol.DEFAULT_PROTOCOL,
              urls: args.streamUrls as string[],
            });
        const info = await lk.egress.startRoomCompositeEgress(args.room, output, {
          layout: args.layout,
          audioOnly: args.audioOnly,
        });
        return ok(summarizeEgress(info));
      }, HINT),
  );

  server.registerTool(
    "egress_list",
    {
      title: "List egress",
      description: "Lists egress jobs, optionally filtered by room or restricted to active ones.",
      inputSchema: {
        room: z.string().optional(),
        activeOnly: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      guard(async () => {
        const list = await lk.egress.listEgress({ roomName: args.room, active: args.activeOnly });
        return ok({ count: list.length, egress: list.map(summarizeEgress) });
      }, HINT),
  );

  server.registerTool(
    "egress_stop",
    {
      title: "Stop egress",
      description: "Stops a running egress job by id.",
      inputSchema: { egressId: z.string().min(1) },
      annotations: { destructiveHint: true },
    },
    async (args) => guard(async () => ok(summarizeEgress(await lk.egress.stopEgress(args.egressId))), HINT),
  );
}
