import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { vi } from "vitest";
import { AccessToken, TokenVerifier, Room, ParticipantInfo, ParticipantInfo_State } from "livekit-server-sdk";
import type { LiveKitClients } from "../../src/clients.js";
import { loadConfig } from "../../src/config.js";
import { buildServer } from "../../src/server.js";

export function fakeRoom(name: string, extra: Partial<Room> = {}): Room {
  return new Room({ name, sid: `RM_${name}`, creationTime: 1700000000n, numParticipants: 0, ...extra });
}

export function fakeParticipant(identity: string, extra: Partial<ParticipantInfo> = {}): ParticipantInfo {
  return new ParticipantInfo({ identity, sid: `PA_${identity}`, name: identity, state: ParticipantInfo_State.ACTIVE, joinedAt: 1700000001n, ...extra });
}

export function mockClients(): LiveKitClients & { store: Map<string, Room> } {
  const config = loadConfig({});
  const store = new Map<string, Room>();
  const rooms = {
    createRoom: vi.fn(async (o: { name: string; metadata?: string; emptyTimeout?: number; maxParticipants?: number }) => {
      const r = fakeRoom(o.name, { metadata: o.metadata ?? "", emptyTimeout: o.emptyTimeout ?? 300, maxParticipants: o.maxParticipants ?? 0 });
      store.set(o.name, r);
      return r;
    }),
    listRooms: vi.fn(async (names?: string[]) => [...store.values()].filter((r) => !names?.length || names.includes(r.name))),
    deleteRoom: vi.fn(async (name: string) => {
      if (!store.delete(name)) throw new Error(`twirp error not_found: room ${name} not found`);
    }),
    updateRoomMetadata: vi.fn(async (name: string, metadata: string) => fakeRoom(name, { metadata })),
    listParticipants: vi.fn(async () => [fakeParticipant("alice"), fakeParticipant("bob", { isPublisher: true })]),
    getParticipant: vi.fn(async (_r: string, id: string) => fakeParticipant(id)),
    removeParticipant: vi.fn(async () => undefined),
    mutePublishedTrack: vi.fn(async () => ({ sid: "TR_1", muted: true })),
    updateParticipant: vi.fn(async (_r: string, id: string, o: { name?: string }) => fakeParticipant(id, { name: o.name ?? id })),
    sendData: vi.fn(async () => undefined),
  };
  const egress = {
    startRoomCompositeEgress: vi.fn(async () => ({ egressId: "EG_1", roomName: "r", status: 0, startedAt: 0n, endedAt: 0n, fileResults: [], streamResults: [] })),
    listEgress: vi.fn(async () => []),
    stopEgress: vi.fn(async () => ({ egressId: "EG_1", roomName: "r", status: 2, startedAt: 0n, endedAt: 0n, fileResults: [], streamResults: [] })),
  };
  const ingress = {
    createIngress: vi.fn(async () => ({ ingressId: "IN_1", name: "obs", inputType: 0, url: "rtmp://x/live", streamKey: "k", roomName: "r", participantIdentity: "obs", participantName: "", reusable: false })),
    listIngress: vi.fn(async () => []),
    deleteIngress: vi.fn(async () => ({ ingressId: "IN_1", name: "obs", inputType: 0, url: "", streamKey: "", roomName: "r", participantIdentity: "obs", participantName: "", reusable: false })),
  };
  return {
    config,
    store,
    rooms: rooms as unknown as LiveKitClients["rooms"],
    egress: egress as unknown as LiveKitClients["egress"],
    ingress: ingress as unknown as LiveKitClients["ingress"],
    newToken: (opts) => new AccessToken(config.apiKey, config.apiSecret, opts),
    verifier: new TokenVerifier(config.apiKey, config.apiSecret),
  };
}

export async function harness() {
  const lk = mockClients();
  const server = buildServer(lk);
  const client = new Client({ name: "test", version: "0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  const call = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: Array<{ type: string; text?: string }>;
      structuredContent?: T;
      isError?: boolean;
    };
    return { text: res.content.map((c) => c.text ?? "").join("\n"), data: (res.structuredContent ?? {}) as T, isError: Boolean(res.isError) };
  };
  const close = async () => {
    await client.close();
    await server.close();
  };
  return { lk, server, client, call, close };
}
