import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LiveKitClients } from "./clients.js";
import { registerRoomTools } from "./tools/rooms.js";
import { registerParticipantTools } from "./tools/participants.js";
import { registerTokenTools } from "./tools/tokens.js";
import { registerDataTools } from "./tools/data.js";
import { registerEgressTools } from "./tools/egress.js";
import { registerIngressTools } from "./tools/ingress.js";
import { registerWorkshopTools } from "./tools/workshop.js";

export const SERVER_NAME = "livekit-ops-mcp";
export const SERVER_VERSION = "0.1.0";

export function buildServer(lk: LiveKitClients): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Operator control of a LiveKit deployment. Start with server_health. Rooms, tokens, participants, data messages, egress and ingress map 1:1 to the LiveKit server API. The workshop_* tools run a hackathon: workshop_spinup, then workshop_join_sheet, workshop_status and workshop_broadcast during the event, workshop_teardown after.",
    },
  );
  registerRoomTools(server, lk);
  registerParticipantTools(server, lk);
  registerTokenTools(server, lk);
  registerDataTools(server, lk);
  registerEgressTools(server, lk);
  registerIngressTools(server, lk);
  registerWorkshopTools(server, lk);
  return server;
}
