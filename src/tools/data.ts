import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DataPacket_Kind } from "livekit-server-sdk";
import type { LiveKitClients } from "../clients.js";
import { guard, ok } from "../util.js";

export function registerDataTools(server: McpServer, lk: LiveKitClients): void {
  server.registerTool(
    "data_send",
    {
      title: "Send data message",
      description:
        "Publishes a data message into a room from the server (no participant needed). Use it for workshop announcements, timers, or driving a demo UI. Payload is UTF-8 text; pass JSON if the client expects it.",
      inputSchema: {
        room: z.string().min(1),
        payload: z.string().min(1).describe("Message body, up to ~15 KB"),
        topic: z.string().optional().describe("Topic string clients can filter on"),
        reliable: z.boolean().default(true).describe("Reliable (ordered, retransmitted) or lossy delivery"),
        destinationIdentities: z.array(z.string()).optional().describe("Deliver only to these identities; omit for everyone"),
      },
    },
    async (args) =>
      guard(async () => {
        const bytes = new TextEncoder().encode(args.payload);
        await lk.rooms.sendData(args.room, bytes, args.reliable ? DataPacket_Kind.RELIABLE : DataPacket_Kind.LOSSY, {
          topic: args.topic,
          destinationIdentities: args.destinationIdentities,
        });
        return ok({
          room: args.room,
          bytes: bytes.byteLength,
          topic: args.topic ?? null,
          reliable: args.reliable,
          recipients: args.destinationIdentities ?? "all",
        });
      }, "The room must exist (someone joined or room_create was called)."),
  );
}
