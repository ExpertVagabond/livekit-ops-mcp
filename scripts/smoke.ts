/**
 * Integration smoke test against a REAL LiveKit server.
 *
 *   docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev --bind 0.0.0.0
 *   npm run smoke
 *
 * Drives the MCP server through a real MCP client (in-memory transport), so every
 * step below is a tools/call round-trip, and joins a real participant with
 * @livekit/rtc-node so participant_list has something to list.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Room, RoomEvent } from "@livekit/rtc-node";
import { loadConfig } from "../src/config.js";
import { makeClients } from "../src/clients.js";
import { buildServer } from "../src/server.js";
import type { WorkshopManifest } from "../src/tools/workshop.js";

const config = loadConfig();
const server = buildServer(makeClients(config));
const client = new Client({ name: "smoke", version: "0.0.0" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st);
await client.connect(ct);

let step = 0;
let failures = 0;
const log = (msg: string) => console.log(`[${String(++step).padStart(2, "0")}] ${msg}`);

async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; data: T; isError: boolean }> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  const text = res.content.map((c) => c.text ?? "").join("\n");
  return { text, data: (res.structuredContent ?? {}) as T, isError: Boolean(res.isError) };
}

function expect(cond: unknown, msg: string) {
  if (!cond) {
    failures++;
    console.log(`    FAIL: ${msg}`);
  }
}

const EVENT = `smoke ${Date.now().toString(36)}`;

try {
  const tools = await client.listTools();
  log(`tools/list -> ${tools.tools.length} tools: ${tools.tools.map((t) => t.name).join(", ")}`);
  expect(tools.tools.length >= 20, "expected 20+ tools");

  const health = await call("server_health");
  log(`server_health -> ok=${health.data.ok} apiHost=${health.data.apiHost} latencyMs=${health.data.latencyMs} activeRooms=${health.data.activeRooms}`);
  expect(health.data.ok === true, "server unreachable");

  const spin = await call<WorkshopManifest>("workshop_spinup", { event: EVENT, teams: ["Otters", "Herons"], seatsPerTeam: 2, ttl: "1h", mentor: true });
  const m = spin.data;
  log(`workshop_spinup -> ${m.rooms.length} rooms: ${m.rooms.map((r) => `${r.room} (sid ${r.sid}, ${r.seats.length} seats + mentor)`).join("; ")}`);
  expect(m.rooms.length === 2 && m.rooms.every((r) => r.sid?.startsWith("RM_")), "rooms not created with server SIDs");

  const seat = m.rooms[0].seats[0];
  const roomName = m.rooms[0].room;
  const verify = await call<{ valid: boolean; claims: { sub?: string; video?: { room?: string; roomJoin?: boolean } } }>("token_verify", { token: seat.token });
  log(`token_verify -> valid=${verify.data.valid} sub=${verify.data.claims.sub} room=${verify.data.claims.video?.room} roomJoin=${verify.data.claims.video?.roomJoin}`);
  expect(verify.data.valid && verify.data.claims.sub === seat.identity, "token claims mismatch");

  const list = await call<{ count: number; rooms: Array<{ name: string }> }>("room_list", { prefix: m.prefix });
  log(`room_list prefix=${m.prefix} -> ${list.data.count} rooms`);
  expect(list.data.count === 2, "room_list did not return both rooms");

  // A real participant joins with the minted token.
  const room = new Room();
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("RTC connect timed out after 15s. Docker on macOS: start the server with --node-ip 127.0.0.1 so ICE candidates point at the mapped ports.")), 15000),
  );
  await Promise.race([room.connect(config.wsUrl, seat.token, { autoSubscribe: true, dynacast: false }), timeout]);
  log(`rtc-node Room.connect(${config.wsUrl}) as ${seat.identity} -> isConnected=${room.isConnected}, server-side sid ${room.localParticipant?.sid}`);
  expect(room.isConnected, "rtc-node did not connect");
  await new Promise((r) => setTimeout(r, 400));

  const parts = await call<{ count: number; participants: Array<{ identity: string; state: string }> }>("participant_list", { room: roomName });
  if (parts.isError || !parts.data.participants) throw new Error(`participant_list failed: ${parts.text}`);
  log(`participant_list ${roomName} -> ${parts.data.count}: ${parts.data.participants.map((p) => `${p.identity} [${p.state}]`).join(", ")}`);
  expect(parts.data.participants.some((p) => p.identity === seat.identity), "joined participant not listed");

  const upd = await call<{ name: string }>("participant_update", { room: roomName, identity: seat.identity, name: "Otter One" });
  log(`participant_update -> name="${upd.data.name}"`);
  expect(upd.data.name === "Otter One", "participant name not updated");

  const dataMsg = new Promise<string>((resolve) =>
    room.once(RoomEvent.DataReceived, (payload) => resolve(new TextDecoder().decode(payload))),
  );
  const sent = await call<{ bytes: number }>("data_send", { room: roomName, payload: "hello from the operator", topic: "smoke" });
  const received = await Promise.race([dataMsg, new Promise<string>((r) => setTimeout(() => r("<timeout>"), 3000))]);
  log(`data_send -> ${sent.data.bytes} bytes; participant received "${received}"`);
  expect(received === "hello from the operator", "data message not received by participant");

  const bc = await call<{ rooms: string[] }>("workshop_broadcast", { event: EVENT, payload: "10 minutes left" });
  log(`workshop_broadcast -> ${bc.data.rooms.length} rooms`);

  const status = await call<{ rooms: number; totalParticipants: number; emptyRooms: string[] }>("workshop_status", { event: EVENT });
  log(`workshop_status -> rooms=${status.data.rooms} participants=${status.data.totalParticipants} empty=${JSON.stringify(status.data.emptyRooms)}`);
  expect(status.data.totalParticipants === 1, "status participant count wrong");

  const disconnected = new Promise<void>((resolve) => room.once(RoomEvent.Disconnected, () => resolve()));
  const rm = await call<{ removed: string }>("participant_remove", { room: roomName, identity: seat.identity });
  await Promise.race([disconnected, new Promise((r) => setTimeout(r, 3000))]);
  log(`participant_remove -> removed=${rm.data.removed}; client saw Disconnected`);

  const eg = await call("egress_list", {});
  log(`egress_list -> ${eg.isError ? "error (expected on --dev, no egress service): " + eg.text.split("\n")[0] : eg.text.split("\n")[0]}`);
  const ig = await call("ingress_list", {});
  log(`ingress_list -> ${ig.isError ? "error (expected on --dev, no ingress service): " + ig.text.split("\n")[0] : ig.text.split("\n")[0]}`);

  const sheet = await call("workshop_join_sheet", { manifest: m, format: "markdown" });
  log(`workshop_join_sheet(markdown) -> ${sheet.text.length} chars, first line "${sheet.text.split("\n")[0]}"`);
  expect(sheet.text.includes(seat.identity), "join sheet missing seat");

  const down = await call<{ deleted: number; rooms: string[] }>("workshop_teardown", { event: EVENT });
  log(`workshop_teardown -> deleted ${down.data.deleted}: ${down.data.rooms.join(", ")}`);
  expect(down.data.deleted === 2, "teardown count wrong");

  const after = await call<{ count: number }>("room_list", { prefix: m.prefix });
  log(`room_list prefix=${m.prefix} -> ${after.data.count} rooms`);
  expect(after.data.count === 0, "rooms still present after teardown");

  await room.disconnect().catch(() => {});
} catch (err) {
  failures++;
  console.error("SMOKE ERROR:", err);
}

console.log(failures === 0 ? `\nSMOKE PASS: ${step} steps, 0 failures against ${config.apiHost}` : `\nSMOKE FAIL: ${failures} failure(s)`);
await client.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
