#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { makeClients } from "./clients.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const server = buildServer(makeClients(config));
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`livekit-ops-mcp ready on stdio (api ${config.apiHost}, key ${config.apiKey})\n`);
