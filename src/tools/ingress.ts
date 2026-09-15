import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { IngressInput, type IngressInfo } from "livekit-server-sdk";
import type { LiveKitClients } from "../clients.js";
import { guard, ok } from "../util.js";

const HINT =
  "Ingress needs the LiveKit Ingress service. `livekit-server --dev` alone does not run one; on LiveKit Cloud it is built in.";

export function summarizeIngress(i: IngressInfo) {
  return {
    ingressId: i.ingressId,
    name: i.name,
    inputType: IngressInput[i.inputType] ?? String(i.inputType),
    url: i.url,
    streamKey: i.streamKey,
    roomName: i.roomName,
    participantIdentity: i.participantIdentity,
    participantName: i.participantName,
    reusable: i.reusable,
    status: i.state ? { status: i.state.status, error: i.state.error || undefined } : undefined,
  };
}

export function registerIngressTools(server: McpServer, lk: LiveKitClients): void {
  server.registerTool(
    "ingress_create",
    {
      title: "Create ingress",
      description:
        "Creates an ingress so OBS (RTMP), a WHIP encoder, or a media URL can publish into a room as a participant. Returns the RTMP/WHIP URL and stream key to paste into the encoder.",
      inputSchema: {
        inputType: z.enum(["RTMP", "WHIP", "URL"]).default("RTMP"),
        room: z.string().min(1),
        participantIdentity: z.string().min(1),
        participantName: z.string().optional(),
        name: z.string().optional().describe("Label for the ingress"),
        url: z.string().url().optional().describe("Required for URL input: the media URL to pull"),
        enableTranscoding: z.boolean().optional(),
      },
    },
    async (args) =>
      guard(async () => {
        if (args.inputType === "URL" && !args.url) throw new Error("URL input requires url.");
        const type =
          args.inputType === "WHIP" ? IngressInput.WHIP_INPUT : args.inputType === "URL" ? IngressInput.URL_INPUT : IngressInput.RTMP_INPUT;
        const info = await lk.ingress.createIngress(type, {
          name: args.name,
          roomName: args.room,
          participantIdentity: args.participantIdentity,
          participantName: args.participantName,
          url: args.url,
          enableTranscoding: args.enableTranscoding,
        });
        return ok(summarizeIngress(info));
      }, HINT),
  );

  server.registerTool(
    "ingress_list",
    {
      title: "List ingress",
      description: "Lists ingress endpoints, optionally filtered by room.",
      inputSchema: { room: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      guard(async () => {
        const list = await lk.ingress.listIngress({ roomName: args.room });
        return ok({ count: list.length, ingress: list.map(summarizeIngress) });
      }, HINT),
  );

  server.registerTool(
    "ingress_delete",
    {
      title: "Delete ingress",
      description: "Deletes an ingress endpoint by id.",
      inputSchema: { ingressId: z.string().min(1) },
      annotations: { destructiveHint: true },
    },
    async (args) => guard(async () => ok(summarizeIngress(await lk.ingress.deleteIngress(args.ingressId))), HINT),
  );
}
