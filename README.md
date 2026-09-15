# livekit-ops-mcp

An MCP server that gives an AI agent operator control of a LiveKit deployment, plus a workshop kit that runs a hackathon room-by-room in one call.

24 tools over stdio. TypeScript, `@modelcontextprotocol/sdk`, `livekit-server-sdk`. Works against `livekit-server --dev` with zero configuration and against LiveKit Cloud with three environment variables.

```
npx livekit-ops-mcp        # after publish; or: node dist/index.js
```

## What it is

LiveKit already has MCP on the agent side: the Agents framework can consume MCP tools, and docs.livekit.io serves a documentation MCP. What did not exist was the other direction: an MCP server that exposes the LiveKit **server API** (rooms, access tokens, participants, data messages, egress, ingress) so that Claude, Cursor, or any MCP client can operate a deployment by talking to it.

On top of that control plane sits a workshop kit, because the operator who needs this most is the person running a room full of developers:

- `workshop_spinup`: one call creates a room per team, mints a scoped join token per seat, and a mentor token with admin and record rights per room.
- `workshop_join_sheet`: turns that manifest into a printable HTML sheet with a QR code per seat (or Markdown).
- `workshop_status`: which teams are in their rooms, which rooms are empty, who is publishing.
- `workshop_broadcast`: "30 minutes left, submit your repo link" to every team room at once.
- `workshop_teardown`: delete everything under the event prefix when the day ends.

## Why

Events and community work run on repetition: the same room setup, the same token hand-out, the same "who is stuck" walk around the room, the same cleanup. Making that a five-prompt conversation with an agent means a meetup or hackathon host spends the evening with developers instead of with a terminal. The same tools double as the feedback loop: `workshop_status` and `participant_list` show, in real time, where builders drop off, and every session leaves a manifest that says what was tried. That is the signal a developer advocate carries back to Product.

## Install

```bash
git clone https://github.com/ExpertVagabond/livekit-ops-mcp
cd livekit-ops-mcp
npm install
npm run build
```

Run a local LiveKit server (no account needed):

```bash
# Docker
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  livekit/livekit-server --dev --bind 0.0.0.0 --node-ip 127.0.0.1
# or Homebrew
brew install livekit && livekit-server --dev
```

`--dev` uses the well-known keys `devkey` / `secret`, which are also this server's defaults. For LiveKit Cloud or your own deployment:

| Variable | Default | Notes |
|---|---|---|
| `LIVEKIT_URL` | `http://localhost:7880` | `wss://<project>.livekit.cloud` works; the http host is derived |
| `LIVEKIT_API_KEY` | `devkey` | |
| `LIVEKIT_API_SECRET` | `secret` | |
| `LIVEKIT_MEET_URL` | `https://meet.livekit.io/custom` | Base for join links (`?liveKitUrl=&token=`) |

Claude Desktop / Claude Code / Cursor config:

```json
{
  "mcpServers": {
    "livekit": {
      "command": "node",
      "args": ["/path/to/livekit-ops-mcp/dist/index.js"],
      "env": {
        "LIVEKIT_URL": "wss://your-project.livekit.cloud",
        "LIVEKIT_API_KEY": "APIxxxxxxxx",
        "LIVEKIT_API_SECRET": "..."
      }
    }
  }
}
```

Claude Code one-liner: `claude mcp add livekit -- node /path/to/livekit-ops-mcp/dist/index.js`

## Tools

| Tool | What it does |
|---|---|
| `server_health` | Round-trips ListRooms; reports host, key, latency, active rooms. Run first. |
| `room_create` | Create a room with empty/departure timeouts, participant cap, metadata |
| `room_list` | List rooms, filter by exact names or prefix |
| `room_delete` | Delete a room and disconnect everyone |
| `room_update_metadata` | Replace room metadata (pushed to all participants) |
| `participant_list` | Participants with state, permissions, published tracks |
| `participant_get` | One participant, including track SIDs |
| `participant_remove` | Kick a participant |
| `participant_mute_track` | Server-side mute/unmute of a published track |
| `participant_update` | Name, metadata, attributes, permissions |
| `token_create` | Mint a scoped join JWT (room, identity, TTL, publish/subscribe/data/admin/record grants) and a Meet join link |
| `token_verify` | Verify a JWT against the configured secret and return its claims |
| `data_send` | Publish a data message into a room from the server (topic, reliable/lossy, per-identity targeting) |
| `egress_start_room_composite` | Record a room to MP4/OGG/MP3 or push to RTMP/SRT |
| `egress_list` | List egress jobs (filter by room, active only) |
| `egress_stop` | Stop an egress job |
| `ingress_create` | RTMP / WHIP / URL ingress into a room; returns URL and stream key for OBS |
| `ingress_list` | List ingress endpoints |
| `ingress_delete` | Delete an ingress endpoint |
| `workshop_spinup` | N team rooms + seat tokens + mentor tokens in one call; returns a manifest |
| `workshop_join_sheet` | Printable HTML (QR per seat) or Markdown join sheet from the manifest |
| `workshop_status` | Live per-room participant and publisher counts, empty rooms |
| `workshop_broadcast` | One data message to every room under the event prefix |
| `workshop_teardown` | Delete every room under the event prefix (`dryRun` to preview) |

Every tool returns both human-readable text and `structuredContent`. SDK errors come back as MCP error results with a hint (for example, egress and ingress need their services running; `--dev` alone has neither).

## Run a hackathon in five prompts

With the server connected to Claude:

1. **"Check the LiveKit server is up."**
   `server_health` returns `ok: true`, the host, and latency.

2. **"Spin up the SF Voice Agent Hackathon: teams Otters, Herons, Foxes, Kestrels, four seats each, tokens good for ten hours."**
   `workshop_spinup` creates `sf-voice-agent-hackathon-otters` and the rest, mints 16 seat tokens and 4 mentor tokens, and returns the manifest.

3. **"Make me a printable join sheet."**
   `workshop_join_sheet` renders one page per team with a QR code per seat. Save it as HTML, print it, cut it into strips.

4. **"How are the teams doing? Tell everyone there are 30 minutes left."**
   `workshop_status` shows two rooms empty and one team with nobody publishing (go help them); `workshop_broadcast` drops the timer message into every room.

5. **"Tear it all down."**
   `workshop_teardown` deletes every room under the prefix. `room_list` confirms zero.

The same manifest feeds a recap: which teams stayed in their room the whole session, which never joined, and how many published media. Those numbers go into the event write-up and back to the product team.

## Tests

Unit tests run against mocked SDK clients through a real MCP client (in-memory transport):

```
$ npm test
 Test Files  3 passed (3)
      Tests  21 passed (21)

$ npx tsc --noEmit
(exit 0)
```

The integration smoke test runs against a real `livekit-server --dev`, drives every step through `tools/call`, and joins a real WebRTC participant with `@livekit/rtc-node` so `participant_list` and `data_send` are exercised for real. Output from 2026-09-14 against livekit-server 1.13.7 in Docker:

```
$ npm run smoke
[01] tools/list -> 24 tools: server_health, room_create, room_list, room_delete, room_update_metadata, participant_list, participant_get, participant_remove, participant_mute_track, participant_update, token_create, token_verify, data_send, egress_start_room_composite, egress_list, egress_stop, ingress_create, ingress_list, ingress_delete, workshop_spinup, workshop_join_sheet, workshop_status, workshop_broadcast, workshop_teardown
[02] server_health -> ok=true apiHost=http://localhost:7880 latencyMs=48.5 activeRooms=0
[03] workshop_spinup -> 2 rooms: smoke-mu1wxi2g-otters (sid RM_2CTLxz9gvyRy, 2 seats + mentor); smoke-mu1wxi2g-herons (sid RM_Kjqpeyyvvrwv, 2 seats + mentor)
[04] token_verify -> valid=true sub=otters-seat-1 room=smoke-mu1wxi2g-otters roomJoin=true
[05] room_list prefix=smoke-mu1wxi2g -> 2 rooms
[06] rtc-node Room.connect(ws://localhost:7880) as otters-seat-1 -> isConnected=true, server-side sid PA_5Z8GYhBztT3s
[07] participant_list smoke-mu1wxi2g-otters -> 1: otters-seat-1 [ACTIVE]
[08] participant_update -> name="Otter One"
[09] data_send -> 23 bytes; participant received "hello from the operator"
[10] workshop_broadcast -> 2 rooms
[11] workshop_status -> rooms=2 participants=1 empty=["smoke-mu1wxi2g-herons"]
[12] participant_remove -> removed=otters-seat-1; client saw Disconnected
[13] egress_list -> error (expected on --dev, no egress service): twirp error unknown: egress not connected (redis required)
[14] ingress_list -> error (expected on --dev, no ingress service): twirp error unknown: ingress not connected (redis required)
[15] workshop_join_sheet(markdown) -> 3157 chars, first line "# smoke mu1wxi2g: join sheet"
[16] workshop_teardown -> deleted 2: smoke-mu1wxi2g-otters, smoke-mu1wxi2g-herons
[17] room_list prefix=smoke-mu1wxi2g -> 0 rooms

SMOKE PASS: 17 steps, 0 failures against http://localhost:7880
```

Docker on macOS note: pass `--node-ip 127.0.0.1` to the server so ICE candidates point at the mapped ports; without it the signalling connects but media never does.

## Layout

```
src/index.ts          stdio entry
src/server.ts         McpServer + tool registration
src/config.ts         LIVEKIT_* env, dev defaults
src/clients.ts        RoomService / Egress / Ingress / AccessToken behind one interface (mockable)
src/tools/*.ts        rooms, participants, tokens, data, egress, ingress, workshop
scripts/smoke.ts      integration smoke against a real server
test/unit/*.test.ts   vitest, mocked clients through a real MCP client
```

## Prior art

- LiveKit Agents MCP client support (agents consuming MCP tools) and `livekit-examples/basic-mcp`
- LiveKit Docs MCP at `https://docs.livekit.io/mcp` (documentation search)
- Community voice agents wired to MCP servers (home-assistant-mcp-agent, voice-mcp-agent, and others)

None of these expose the server API to an MCP client; that is what this repo does.

## License

MIT. Copyright (c) 2026 Matthew Karsten.
