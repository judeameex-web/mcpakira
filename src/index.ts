import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
const server = new McpServer({ name: "My Custom MCP", version: "1.0.0" });

server.tool("greetUser", { name: z.string() }, async ({ name }) => {
  return { content: [{ type: "text", text: `Hello, ${name}!` }] };
});

server.tool(
  "addNumbers",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => {
    const sum = a + b;
    return { content: [{ type: "text", text: `Sum is ${sum}` }] };
  }
);

const app = express();
app.use(express.json());
// Enable CORS for specific origins or all, exposing the MCP session header
app.use(
  cors({
    origin: "*",
    // TODO: lock down in production to specific domains
    exposedHeaders: ["Mcp-Session-Id"],
    allowedHeaders: ["Content-Type", "Mcp-Session-Id"],
  })
);
// Session management for MCP connections
const transports: Record<string, StreamableHTTPServerTransport> = {};
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;
  if (sessionId && transports[sessionId]) {
    transport = transports[sessionId]; // reuse existing session
  } else if (!sessionId && req.body && req.body.method === "initialize") {
    // Start a new MCP session if this is an initialize request
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport;
      },
    });
    // Clean up on close
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };
    await server.connect(transport);
    // connect MCP server to this transport:contentReference[oaicite:13]{index=13}
  } else {
    // Invalid request (e.g. missing session initialization)
    res.status(400).json({ error: "Bad Request: No valid session ID" });
    return;
  }
  // Delegate the MCP request handling to the transport
  await transport.handleRequest(req, res, req.body);
});
// Handle Server-Sent Events (SSE) for asynchronous tool outputs or notifications:
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const transport = transports[sessionId];
  await transport.handleRequest(req, res); // upgrades to SSE stream
});
// Endpoints to terminate sessions if needed
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  if (sessionId && transports[sessionId]) {
    transports[sessionId].close();
  }
  res.status(204).send();
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ MCP server listening on port ${PORT}`);
});
