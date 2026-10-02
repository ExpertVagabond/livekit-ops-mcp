/**
 * Bootcamp-scale load test of the workshop kit, against a REAL LiveKit deployment.
 *
 *   LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... npx tsx scripts/bootcamp.ts
 *   TEAMS=25 SEATS=4 npx tsx scripts/bootcamp.ts
 *
 * `npm run smoke` proves the tools work. This proves the kit holds at the size a
 * real workshop actually is: one room per team, a scoped token per seat, a mentor
 * token per room, a printable sheet, and a teardown that leaves nothing behind.
 *
 * Why it is safe to run against a live project:
 *   - It creates ROOMS and mints TOKENS. No participants join, no agents are
 *     dispatched, so it spends no WebRTC minutes, no agent session minutes and no
 *     inference credit. Rooms are the cheap side of the platform.
 *   - Every room name is prefixed with a unique event slug, and teardown filters on
 *     that prefix (`name.startsWith(prefix)`), so it can never delete a room it did
 *     not create. The dry run prints the exact list before anything is deleted.
 *
 * Exits non-zero if any assertion fails or if teardown does not restore the
 * pre-existing room count.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { makeClients } from "../src/clients.js";
import { buildServer } from "../src/server.js";
import type { WorkshopManifest } from "../src/tools/workshop.js";

const TEAMS = Number(process.env.TEAMS ?? 25);
const SEATS = Number(process.env.SEATS ?? 4);
const SHEET = process.env.SHEET ?? "/tmp/bootcamp-join-sheet.html";

const config = loadConfig();
const server = buildServer(makeClients(config));
const client = new Client({ name: "bootcamp", version: "0.0.0" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st);
await client.connect(ct);

let step = 0;
let failures = 0;
const t0 = Date.now();
const log = (m: string) => console.log(`[${String(++step).padStart(2, "0")}] ${m}`);
const expect = (cond: unknown, msg: string) => {
  if (!cond) {
    failures++;
    console.log(`     FAIL: ${msg}`);
  }
};

async function call<T = Record<string, unknown>>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; data: T; isError: boolean }> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  return {
    text: res.content.map((c) => c.text ?? "").join("\n"),
    data: (res.structuredContent ?? {}) as T,
    isError: Boolean(res.isError),
  };
}

const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const s = Date.now();
  const out = await fn();
  console.log(`     ⏱  ${label}: ${((Date.now() - s) / 1000).toFixed(2)}s`);
  return out;
};

const EVENT = `bootcamp dryrun ${Date.now().toString(36)}`;

try {
  const health = await call<{ ok: boolean; apiHost: string; activeRooms: number }>("server_health");
  log(`server_health -> ok=${health.data.ok} host=${health.data.apiHost} activeRooms=${health.data.activeRooms}`);
  expect(health.data.ok, "server_health not ok — is LIVEKIT_URL/API_KEY/API_SECRET set?");

  const before = await call<{ rooms: Array<{ name: string }> }>("room_list");
  const baseline = before.data.rooms?.length ?? 0;
  log(`room_list -> ${baseline} room(s) before we start (baseline to restore)`);

  // ---------------------------------------------------------------- spin up
  log(`workshop_spinup -> ${TEAMS} teams x ${SEATS} seats + 1 mentor each`);
  const spun = await timed("provision", () =>
    call<WorkshopManifest>("workshop_spinup", {
      event: EVENT,
      count: TEAMS,
      seatsPerTeam: SEATS,
      ttl: "12h",
      mentor: true,
    }),
  );
  expect(!spun.isError, `workshop_spinup errored: ${spun.text.slice(0, 200)}`);
  const manifest = spun.data;
  const rooms = manifest.rooms ?? [];
  const seatCount = rooms.reduce((n, r) => n + (r.seats?.length ?? 0), 0);
  const mentorCount = rooms.filter((r) => r.mentor).length;
  log(`   -> ${rooms.length} rooms, ${seatCount} seat tokens, ${mentorCount} mentor tokens`);
  expect(rooms.length === TEAMS, `expected ${TEAMS} rooms, got ${rooms.length}`);
  expect(seatCount === TEAMS * SEATS, `expected ${TEAMS * SEATS} seats, got ${seatCount}`);
  expect(mentorCount === TEAMS, `expected ${TEAMS} mentor tokens, got ${mentorCount}`);

  // Every token must be distinct, and every seat must be scoped to its OWN room.
  // The room is NOT in the joinUrl — joinUrl is `${meetUrl}?liveKitUrl=..&token=..`
  // and the room lives in the JWT's `video.room` claim. So decode the token and
  // check the grant, which is the assertion that actually matters.
  const tokens = new Set<string>();
  let scopeErrors = 0;
  const roomOf = (jwt: string): string | undefined => {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
      return payload?.video?.room ?? payload?.videoGrant?.room;
    } catch {
      return undefined;
    }
  };
  for (const r of rooms) {
    for (const s of [...(r.seats ?? []), ...(r.mentor ? [r.mentor] : [])]) {
      tokens.add(s.token);
      if (roomOf(s.token) !== r.room) scopeErrors++;
    }
  }
  log(`   -> ${tokens.size} unique tokens, ${scopeErrors} token(s) not scoped to their own room`);
  expect(tokens.size === seatCount + mentorCount, "duplicate tokens minted");
  expect(scopeErrors === 0, `${scopeErrors} tokens carry the wrong video.room grant`);

  // --------------------------------------------------------- verify on server
  // LiveKit Cloud's ListRooms is EVENTUALLY CONSISTENT: a room created moments ago
  // is not necessarily listed yet, and a deleted one can linger. Verified on
  // 2026-10-02 against demo-v7iv55bq — a create-then-list in the same second
  // reported zero rooms while `lk room list` showed them. Poll instead of
  // asserting once, or this test lies about a kit that worked.
  const pollRooms = async (want: number, label: string) => {
    let seen = -1;
    for (let i = 0; i < 20; i++) {
      const r = await call<{ rooms: Array<{ name: string }> }>("room_list");
      const mine = (r.data.rooms ?? []).filter((x) => x.name.startsWith(manifest.prefix));
      seen = mine.length;
      if (seen === want) {
        log(`room_list -> ${seen}/${want} under "${manifest.prefix}" after ${i + 1} poll(s) — ${label}`);
        return seen;
      }
      await new Promise((res) => setTimeout(res, 3000));
    }
    log(`room_list -> settled at ${seen}/${want} under "${manifest.prefix}" — ${label}`);
    return seen;
  };

  const mineCount = await timed("list converge", () => pollRooms(TEAMS, "all rooms visible"));
  expect(mineCount === TEAMS, `server shows ${mineCount} of our rooms, expected ${TEAMS}`);

  // NB: workshop_status returns `rooms` as a COUNT (number), with the per-room
  // array under `detail`. Reading it as an array silently yields 0.
  const status = await call<{ rooms: number; totalParticipants: number; emptyRooms: string[]; detail: unknown[] }>(
    "workshop_status",
    { event: EVENT },
  );
  log(
    `workshop_status -> rooms=${status.data.rooms} participants=${status.data.totalParticipants} ` +
      `empty=${status.data.emptyRooms?.length ?? 0} detail=${status.data.detail?.length ?? 0}`,
  );
  expect(!status.isError, `workshop_status errored: ${status.text.slice(0, 160)}`);
  expect(status.data.rooms === TEAMS, `workshop_status says ${status.data.rooms} rooms, expected ${TEAMS}`);
  expect(status.data.detail?.length === TEAMS, `status detail has ${status.data.detail?.length}, expected ${TEAMS}`);

  // ------------------------------------------------------------- join sheet
  const sheet = await timed("render sheet", () =>
    call("workshop_join_sheet", { manifest, format: "html", title: "Voice Agent Bootcamp", qr: true }),
  );
  writeFileSync(SHEET, sheet.text);
  const qrCount = (sheet.text.match(/qrserver\.com/g) ?? []).length;
  log(`workshop_join_sheet -> ${sheet.text.length.toLocaleString()} bytes, ${qrCount} QR codes -> ${SHEET}`);
  expect(sheet.text.length > 1000, "join sheet suspiciously small");
  expect(qrCount >= seatCount, `expected >= ${seatCount} QR codes, got ${qrCount}`);

  // NB: the parameter is `payload`, not `message`.
  const bc = await call<{ rooms: string[]; bytes: number; topic: string }>("workshop_broadcast", {
    event: EVENT,
    payload: "Bootcamp dry run — ignore.",
  });
  log(
    `workshop_broadcast -> ${bc.isError ? `ERROR: ${bc.text.slice(0, 140)}` : `${bc.data.bytes}B on topic "${bc.data.topic}" to ${bc.data.rooms?.length ?? 0} room(s)`}`,
  );
  expect(!bc.isError, "workshop_broadcast errored");
  expect(bc.data.rooms?.length === TEAMS, `broadcast reached ${bc.data.rooms?.length}, expected ${TEAMS}`);

  // ---------------------------------------------------------------- teardown
  const dry = await call<{ rooms: string[]; deleted: number }>("workshop_teardown", { event: EVENT, dryRun: true });
  log(`workshop_teardown dryRun -> would delete ${dry.data.rooms?.length ?? 0} room(s), deleted=${dry.data.deleted}`);
  expect(dry.data.rooms?.length === TEAMS, `dry run would delete ${dry.data.rooms?.length}, expected ${TEAMS}`);
  expect(dry.data.deleted === 0, "dry run reported deletions — it must not delete");

  const down = await timed("teardown", () => call<{ deleted: number }>("workshop_teardown", { event: EVENT }));
  log(`workshop_teardown -> deleted ${down.data.deleted} room(s)`);
  expect(down.data.deleted === TEAMS, `deleted ${down.data.deleted}, expected ${TEAMS}`);

  // Deletes lag the same way creates do, so poll back down to zero.
  const leftover = await timed("teardown converge", () => pollRooms(0, "nothing left behind"));
  expect(leftover === 0, `${leftover} rooms still listed under "${manifest.prefix}" after teardown`);

  const end = await call<{ rooms: Array<{ name: string }> }>("room_list");
  log(`room_list -> ${end.data.rooms?.length ?? 0} room(s) total (baseline was ${baseline})`);
  expect((end.data.rooms?.length ?? 0) === baseline, `room count ${end.data.rooms?.length} != baseline ${baseline}`);
} catch (err) {
  failures++;
  console.error("THREW:", err instanceof Error ? err.message : err);
} finally {
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\n${failures === 0 ? "PASS" : "FAIL"} — ${step} steps, ${failures} failure(s), ` +
      `${TEAMS} teams x ${SEATS} seats, ${secs}s total`,
  );
  await client.close();
  process.exit(failures === 0 ? 0 : 1);
}
