import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DataPacket_Kind } from "livekit-server-sdk";
import type { LiveKitClients } from "../clients.js";
import { guard, ok, slug } from "../util.js";
import { mintJoinToken } from "./tokens.js";

export interface Seat {
  identity: string;
  token: string;
  joinUrl: string;
}

export interface TeamRoom {
  team: string;
  room: string;
  sid?: string;
  seats: Seat[];
  mentor?: Seat;
}

export interface WorkshopManifest {
  event: string;
  prefix: string;
  wsUrl: string;
  ttl: string;
  createdAt: string;
  rooms: TeamRoom[];
}

const manifestSchema = z.object({
  event: z.string(),
  prefix: z.string(),
  wsUrl: z.string(),
  ttl: z.string(),
  createdAt: z.string(),
  rooms: z.array(
    z.object({
      team: z.string(),
      room: z.string(),
      sid: z.string().optional(),
      seats: z.array(z.object({ identity: z.string(), token: z.string(), joinUrl: z.string() })),
      mentor: z.object({ identity: z.string(), token: z.string(), joinUrl: z.string() }).optional(),
    }),
  ),
});

export function teamNames(teams: string[] | undefined, count: number | undefined): string[] {
  if (teams?.length) return teams;
  const n = count ?? 5;
  return Array.from({ length: n }, (_, i) => `team-${String(i + 1).padStart(2, "0")}`);
}

export async function spinUp(
  lk: LiveKitClients,
  opts: {
    event: string;
    teams?: string[];
    count?: number;
    seatsPerTeam: number;
    ttl: string;
    emptyTimeout: number;
    maxParticipants: number;
    mentor: boolean;
  },
): Promise<WorkshopManifest> {
  const prefix = slug(opts.event);
  const rooms: TeamRoom[] = [];
  for (const team of teamNames(opts.teams, opts.count)) {
    const room = `${prefix}-${slug(team)}`;
    const created = await lk.rooms.createRoom({
      name: room,
      emptyTimeout: opts.emptyTimeout,
      maxParticipants: opts.maxParticipants,
      metadata: JSON.stringify({ event: opts.event, team, kit: "livekit-ops-mcp" }),
    });
    const seats: Seat[] = [];
    for (let i = 1; i <= opts.seatsPerTeam; i++) {
      const identity = `${slug(team)}-seat-${i}`;
      const t = await mintJoinToken(lk, { room, identity, name: `${team} ${i}`, ttl: opts.ttl });
      seats.push({ identity, token: t.token, joinUrl: t.joinUrl });
    }
    let mentor: Seat | undefined;
    if (opts.mentor) {
      const identity = `mentor-${slug(team)}`;
      const t = await mintJoinToken(lk, {
        room,
        identity,
        name: "Mentor",
        ttl: opts.ttl,
        grant: { roomAdmin: true, roomRecord: true },
      });
      mentor = { identity, token: t.token, joinUrl: t.joinUrl };
    }
    rooms.push({ team, room, sid: created.sid, seats, mentor });
  }
  return { event: opts.event, prefix, wsUrl: lk.config.wsUrl, ttl: opts.ttl, createdAt: new Date().toISOString(), rooms };
}

const qr = (data: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=4&data=${encodeURIComponent(data)}`;

export function renderJoinSheet(m: WorkshopManifest, opts: { title?: string; instructions?: string; format: "markdown" | "html"; qr: boolean }): string {
  const title = opts.title ?? `${m.event}: join sheet`;
  const instructions =
    opts.instructions ??
    "Scan your seat's QR code or open the join link. One seat per person. Mentors use the mentor link; it can mute, remove and record.";
  if (opts.format === "markdown") {
    const lines = [`# ${title}`, "", instructions, "", `Server: \`${m.wsUrl}\` · tokens valid ${m.ttl} from ${m.createdAt}`, ""];
    for (const r of m.rooms) {
      lines.push(`## ${r.team}`, "", `Room: \`${r.room}\``, "", "| Seat | Identity | Join |", "|---|---|---|");
      r.seats.forEach((s, i) => lines.push(`| ${i + 1} | ${s.identity} | ${s.joinUrl} |`));
      if (r.mentor) lines.push(`| mentor | ${r.mentor.identity} | ${r.mentor.joinUrl} |`);
      lines.push("");
    }
    return lines.join("\n");
  }
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const seatCard = (s: Seat, label: string) => `
      <div class="seat">
        ${opts.qr ? `<img src="${qr(s.joinUrl)}" alt="QR for ${esc(s.identity)}" width="120" height="120">` : ""}
        <div class="label">${esc(label)}</div>
        <div class="id">${esc(s.identity)}</div>
        <a class="link" href="${esc(s.joinUrl)}">join link</a>
      </div>`;
  const teams = m.rooms
    .map(
      (r) => `
    <section class="team">
      <h2>${esc(r.team)} <span class="room">${esc(r.room)}</span></h2>
      <div class="seats">
        ${r.seats.map((s, i) => seatCard(s, `Seat ${i + 1}`)).join("")}
        ${r.mentor ? seatCard(r.mentor, "Mentor") : ""}
      </div>
    </section>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: Letter; margin: 0.5in; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; padding: 24px; }
  h1 { font-size: 24px; margin: 0 0 6px; }
  .meta { color: #555; font-size: 12px; margin-bottom: 18px; }
  .team { break-inside: avoid; page-break-inside: avoid; border-top: 2px solid #111; padding: 12px 0 18px; }
  h2 { font-size: 18px; margin: 0 0 10px; }
  .room { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #555; font-weight: 400; margin-left: 8px; }
  .seats { display: flex; flex-wrap: wrap; gap: 14px; }
  .seat { width: 140px; text-align: center; font-size: 12px; }
  .seat img { display: block; margin: 0 auto 4px; }
  .label { font-weight: 700; }
  .id { font-family: ui-monospace, Menlo, monospace; font-size: 10px; color: #555; word-break: break-all; }
  .link { font-size: 10px; color: #0645ad; }
</style></head><body>
  <h1>${esc(title)}</h1>
  <div class="meta">${esc(instructions)}<br>Server: <code>${esc(m.wsUrl)}</code> · tokens valid ${esc(m.ttl)} from ${esc(m.createdAt)}</div>
  ${teams}
</body></html>`;
}

export function registerWorkshopTools(server: McpServer, lk: LiveKitClients): void {
  server.registerTool(
    "workshop_spinup",
    {
      title: "Spin up a hackathon / workshop",
      description:
        "One call: creates one room per team, mints a scoped join token for every seat, plus an optional mentor token with admin and record rights per room. Returns a manifest you can pass straight to workshop_join_sheet. Room names are <event-slug>-<team-slug>.",
      inputSchema: {
        event: z.string().min(1).describe('Event name, e.g. "SF Voice Agent Hackathon Oct 2026"'),
        teams: z.array(z.string().min(1)).optional().describe("Team names. Omit to auto-number team-01..team-N"),
        count: z.number().int().min(1).max(200).optional().describe("Number of teams when teams is omitted (default 5)"),
        seatsPerTeam: z.number().int().min(1).max(50).default(4),
        ttl: z.string().default("10h").describe("Token lifetime, e.g. 10h for a one-day event"),
        emptyTimeout: z.number().int().min(60).default(43200).describe("Seconds a room stays open with nobody in it (default 12h)"),
        maxParticipants: z.number().int().min(0).default(0).describe("Per-room cap, 0 = unlimited"),
        mentor: z.boolean().default(true).describe("Also mint a roomAdmin+roomRecord mentor token per room"),
      },
    },
    async (args) =>
      guard(
        async () => {
          const manifest = await spinUp(lk, args);
          const summary = `${manifest.rooms.length} rooms created with prefix "${manifest.prefix}", ${args.seatsPerTeam} seats each${args.mentor ? " + mentor" : ""}, tokens valid ${args.ttl}.`;
          return ok(manifest, `${summary}\n\n${JSON.stringify(manifest, null, 2)}`);
        },
        "Room creation failed part-way; run workshop_teardown with the same event name to clean up, then retry.",
      ),
  );

  server.registerTool(
    "workshop_join_sheet",
    {
      title: "Printable join sheet",
      description:
        "Renders a printable join sheet (HTML with a QR code per seat, or Markdown) from a workshop_spinup manifest. Save the HTML and print it, or hand each team its section.",
      inputSchema: {
        manifest: manifestSchema,
        format: z.enum(["html", "markdown"]).default("html"),
        title: z.string().optional(),
        instructions: z.string().optional(),
        qr: z.boolean().default(true).describe("Embed a QR code image per seat (HTML only, uses api.qrserver.com)"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      guard(async () => {
        const text = renderJoinSheet(args.manifest as WorkshopManifest, args);
        return { content: [{ type: "text", text }] };
      }),
  );

  server.registerTool(
    "workshop_status",
    {
      title: "Workshop status",
      description: "Live view of every room under an event prefix: participants, publishers, empty rooms. Use it during the event to see which teams are stuck.",
      inputSchema: { event: z.string().min(1).describe("Event name or prefix used at spinup") },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      guard(async () => {
        const prefix = slug(args.event);
        const rooms = (await lk.rooms.listRooms()).filter((r) => r.name.startsWith(prefix));
        const detail = [];
        for (const r of rooms) {
          const ps = await lk.rooms.listParticipants(r.name);
          detail.push({
            room: r.name,
            participants: ps.length,
            publishers: ps.filter((p) => p.isPublisher).length,
            identities: ps.map((p) => p.identity),
          });
        }
        return ok({
          prefix,
          rooms: detail.length,
          totalParticipants: detail.reduce((n, d) => n + d.participants, 0),
          emptyRooms: detail.filter((d) => d.participants === 0).map((d) => d.room),
          detail,
        });
      }),
  );

  server.registerTool(
    "workshop_broadcast",
    {
      title: "Broadcast to every team room",
      description: 'Sends one data message to every room under the event prefix, e.g. "30 minutes left, submit your repo link".',
      inputSchema: {
        event: z.string().min(1),
        payload: z.string().min(1),
        topic: z.string().default("workshop"),
      },
    },
    async (args) =>
      guard(async () => {
        const prefix = slug(args.event);
        const rooms = (await lk.rooms.listRooms()).filter((r) => r.name.startsWith(prefix));
        const bytes = new TextEncoder().encode(args.payload);
        const sent: string[] = [];
        for (const r of rooms) {
          await lk.rooms.sendData(r.name, bytes, DataPacket_Kind.RELIABLE, { topic: args.topic });
          sent.push(r.name);
        }
        return ok({ prefix, topic: args.topic, bytes: bytes.byteLength, rooms: sent });
      }),
  );

  server.registerTool(
    "workshop_teardown",
    {
      title: "Tear down a workshop",
      description: "Deletes every room under the event prefix and disconnects everyone. dryRun lists what would be deleted.",
      inputSchema: {
        event: z.string().min(1),
        dryRun: z.boolean().default(false),
      },
      annotations: { destructiveHint: true },
    },
    async (args) =>
      guard(async () => {
        const prefix = slug(args.event);
        const rooms = (await lk.rooms.listRooms()).filter((r) => r.name.startsWith(prefix)).map((r) => r.name);
        if (!args.dryRun) for (const name of rooms) await lk.rooms.deleteRoom(name);
        return ok({ prefix, dryRun: args.dryRun, rooms, deleted: args.dryRun ? 0 : rooms.length });
      }),
  );
}
