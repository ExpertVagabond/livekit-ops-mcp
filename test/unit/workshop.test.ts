import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harness } from "./helpers.js";
import { renderJoinSheet, teamNames, type WorkshopManifest } from "../../src/tools/workshop.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

describe("workshop kit", () => {
  it("teamNames auto-numbers or uses the given list", () => {
    expect(teamNames(undefined, 3)).toEqual(["team-01", "team-02", "team-03"]);
    expect(teamNames(["A", "B"], 9)).toEqual(["A", "B"]);
    expect(teamNames(undefined, undefined)).toHaveLength(5);
  });

  it("spinup creates N rooms with seats and mentor tokens, then teardown removes them", async () => {
    const s = await h.call<WorkshopManifest>("workshop_spinup", { event: "SF Voice Hack", teams: ["Otters", "Herons", "Foxes"], seatsPerTeam: 3, ttl: "8h" });
    expect(s.data.prefix).toBe("sf-voice-hack");
    expect(s.data.rooms).toHaveLength(3);
    expect(s.data.rooms.map((r) => r.room)).toEqual(["sf-voice-hack-otters", "sf-voice-hack-herons", "sf-voice-hack-foxes"]);
    expect(s.data.rooms[0].seats).toHaveLength(3);
    expect(s.data.rooms[0].seats[0].identity).toBe("otters-seat-1");
    expect(s.data.rooms[0].mentor?.identity).toBe("mentor-otters");
    expect(s.text.startsWith("3 rooms created")).toBe(true);
    expect(h.lk.rooms.createRoom).toHaveBeenCalledTimes(3);
    const meta = JSON.parse((h.lk.rooms.createRoom as unknown as { mock: { calls: Array<[{ metadata: string }]> } }).mock.calls[0][0].metadata);
    expect(meta).toMatchObject({ event: "SF Voice Hack", team: "Otters" });

    // mentor token carries admin + record grants; seat token does not
    const mentor = await h.call<{ claims: { video: { roomAdmin?: boolean; roomRecord?: boolean } } }>("token_verify", { token: s.data.rooms[0].mentor!.token });
    expect(mentor.data.claims.video.roomAdmin).toBe(true);
    expect(mentor.data.claims.video.roomRecord).toBe(true);
    const seat = await h.call<{ claims: { video: { roomAdmin?: boolean } } }>("token_verify", { token: s.data.rooms[0].seats[0].token });
    expect(seat.data.claims.video.roomAdmin).toBeUndefined();

    const dry = await h.call<{ rooms: string[]; deleted: number }>("workshop_teardown", { event: "SF Voice Hack", dryRun: true });
    expect(dry.data.rooms).toHaveLength(3);
    expect(dry.data.deleted).toBe(0);
    expect(h.lk.store.size).toBe(3);

    const down = await h.call<{ deleted: number }>("workshop_teardown", { event: "SF Voice Hack" });
    expect(down.data.deleted).toBe(3);
    expect(h.lk.store.size).toBe(0);
  });

  it("status and broadcast only touch rooms under the prefix", async () => {
    await h.call("workshop_spinup", { event: "Hack A", count: 2, seatsPerTeam: 1, mentor: false });
    await h.call("room_create", { name: "unrelated" });
    const st = await h.call<{ rooms: number; totalParticipants: number; emptyRooms: string[] }>("workshop_status", { event: "Hack A" });
    expect(st.data.rooms).toBe(2);
    expect(st.data.totalParticipants).toBe(4); // mock lists 2 participants per room
    expect(st.data.emptyRooms).toEqual([]);
    const bc = await h.call<{ rooms: string[] }>("workshop_broadcast", { event: "Hack A", payload: "10 min left" });
    expect(bc.data.rooms).toEqual(["hack-a-team-01", "hack-a-team-02"]);
    expect(h.lk.rooms.sendData).toHaveBeenCalledTimes(2);
  });

  it("join sheet renders markdown and html from the manifest", async () => {
    const s = await h.call<WorkshopManifest>("workshop_spinup", { event: "Demo Night", teams: ["Alpha"], seatsPerTeam: 2 });
    const md = renderJoinSheet(s.data, { format: "markdown", qr: false });
    expect(md).toContain("# Demo Night: join sheet");
    expect(md).toContain("| 1 | alpha-seat-1 |");
    expect(md).toContain("| mentor | mentor-alpha |");
    const html = renderJoinSheet(s.data, { format: "html", qr: true, title: "Print me" });
    expect(html).toContain("<title>Print me</title>");
    expect(html.match(/api\.qrserver\.com/g)).toHaveLength(3); // 2 seats + mentor
    expect(html).toContain("alpha-seat-2");
    const viaTool = await h.call("workshop_join_sheet", { manifest: s.data, format: "markdown" });
    expect(viaTool.text).toContain("alpha-seat-1");
  });
});
