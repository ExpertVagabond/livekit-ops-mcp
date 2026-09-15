import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harness } from "./helpers.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

describe("tool registry", () => {
  it("exposes 24 tools with descriptions", async () => {
    const { tools } = await h.client.listTools();
    expect(tools.length).toBe(24);
    for (const t of tools) expect(t.description, t.name).toBeTruthy();
    expect(tools.map((t) => t.name)).toContain("workshop_spinup");
  });
});

describe("rooms", () => {
  it("creates, lists by prefix, updates and deletes", async () => {
    const c = await h.call<{ name: string; sid: string }>("room_create", { name: "demo-1", metadata: "{}" });
    expect(c.data.name).toBe("demo-1");
    await h.call("room_create", { name: "other" });
    const l = await h.call<{ count: number; rooms: Array<{ name: string }> }>("room_list", { prefix: "demo" });
    expect(l.data.count).toBe(1);
    expect(l.data.rooms[0].name).toBe("demo-1");
    const u = await h.call<{ metadata: string }>("room_update_metadata", { name: "demo-1", metadata: "x" });
    expect(u.data.metadata).toBe("x");
    const d = await h.call<{ deleted: string }>("room_delete", { name: "demo-1" });
    expect(d.data.deleted).toBe("demo-1");
    expect(h.lk.store.has("demo-1")).toBe(false);
  });

  it("returns an MCP error result (not a transport failure) when the SDK throws", async () => {
    const r = await h.call("room_delete", { name: "missing" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("not found");
    expect(r.text).toContain("Hint:");
  });

  it("rejects invalid input", async () => {
    const r = await h.call("room_create", {});
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Invalid arguments.*name/);
    expect(h.lk.rooms.createRoom).not.toHaveBeenCalled();
  });

  it("server_health round-trips listRooms", async () => {
    const r = await h.call<{ ok: boolean; apiKey: string; latencyMs: number }>("server_health");
    expect(r.data.ok).toBe(true);
    expect(r.data.apiKey).toBe("devkey");
    expect(typeof r.data.latencyMs).toBe("number");
  });
});

describe("participants", () => {
  it("lists with state names and publisher flags", async () => {
    const r = await h.call<{ count: number; participants: Array<{ identity: string; state: string; isPublisher: boolean }> }>("participant_list", { room: "r" });
    expect(r.data.count).toBe(2);
    expect(r.data.participants[0].state).toBe("ACTIVE");
    expect(r.data.participants[1].isPublisher).toBe(true);
  });

  it("updates, mutes and removes", async () => {
    const u = await h.call<{ name: string }>("participant_update", { room: "r", identity: "alice", name: "Alice A" });
    expect(u.data.name).toBe("Alice A");
    const m = await h.call<{ muted: boolean }>("participant_mute_track", { room: "r", identity: "alice", trackSid: "TR_1" });
    expect(m.data.muted).toBe(true);
    const rm = await h.call<{ removed: string }>("participant_remove", { room: "r", identity: "alice" });
    expect(rm.data.removed).toBe("alice");
    expect(h.lk.rooms.removeParticipant).toHaveBeenCalledWith("r", "alice");
  });
});

describe("tokens", () => {
  it("mints a scoped join token that verifies with the same secret", async () => {
    const t = await h.call<{ token: string; joinUrl: string; grant: { room: string; roomJoin: boolean; canPublish: boolean } }>("token_create", {
      room: "demo",
      identity: "alice",
      ttl: "30m",
      canPublish: false,
    });
    expect(t.data.grant).toMatchObject({ room: "demo", roomJoin: true, canPublish: false });
    expect(t.data.joinUrl).toContain("meet.livekit.io/custom?liveKitUrl=");
    const v = await h.call<{ valid: boolean; claims: { sub: string; video: { room: string; canPublish: boolean } } }>("token_verify", { token: t.data.token });
    expect(v.data.valid).toBe(true);
    expect(v.data.claims.sub).toBe("alice");
    expect(v.data.claims.video.room).toBe("demo");
    expect(v.data.claims.video.canPublish).toBe(false);
  });

  it("rejects a token signed with another secret", async () => {
    const r = await h.call("token_verify", { token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.invalidsignature_invalidsignature" });
    expect(r.isError).toBe(true);
  });
});

describe("data", () => {
  it("encodes payload and forwards topic and recipients", async () => {
    const r = await h.call<{ bytes: number; recipients: unknown }>("data_send", { room: "r", payload: "héllo", topic: "t", destinationIdentities: ["alice"] });
    expect(r.data.bytes).toBe(6);
    expect(r.data.recipients).toEqual(["alice"]);
    const [room, bytes, kind, opts] = (h.lk.rooms.sendData as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(room).toBe("r");
    expect((bytes as Uint8Array).byteLength).toBe(6);
    expect(kind).toBe(0);
    expect(opts).toEqual({ topic: "t", destinationIdentities: ["alice"] });
  });
});

describe("egress and ingress", () => {
  it("requires exactly one output for room composite egress", async () => {
    const none = await h.call("egress_start_room_composite", { room: "r" });
    expect(none.isError).toBe(true);
    const both = await h.call("egress_start_room_composite", { room: "r", filepath: "a.mp4", streamUrls: ["rtmp://x/y"] });
    expect(both.isError).toBe(true);
    const ok = await h.call<{ egressId: string; status: string }>("egress_start_room_composite", { room: "r", filepath: "a.mp4", fileType: "MP4" });
    expect(ok.data.egressId).toBe("EG_1");
    expect(ok.data.status).toBe("EGRESS_STARTING");
  });

  it("creates an RTMP ingress and returns the stream key", async () => {
    const r = await h.call<{ inputType: string; streamKey: string }>("ingress_create", { room: "r", participantIdentity: "obs" });
    expect(r.data.inputType).toBe("RTMP_INPUT");
    expect(r.data.streamKey).toBe("k");
    const bad = await h.call("ingress_create", { inputType: "URL", room: "r", participantIdentity: "x" });
    expect(bad.isError).toBe(true);
  });
});
