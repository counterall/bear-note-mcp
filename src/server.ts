import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "node:child_process";
import * as http from "node:http";
import { URL, URLSearchParams } from "node:url";

// Helper: open a URL with the system browser (macOS will route bear:// to Bear)
function openUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(`open "${url}"`, (err) => (err ? reject(err) : resolve()));
  });
}

// Helper: spin up a one-shot local HTTP server to capture x-success/x-error
async function captureCallback(): Promise<{ ok: boolean; data: Record<string, string> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || "", `http://${req.headers.host}`);
      const params: Record<string, string> = {};
      reqUrl.searchParams.forEach((v, k) => (params[k] = v));

      const ok = reqUrl.pathname.includes("success");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(ok ? "OK" : "ERROR");
      server.close();
      resolve({ ok, data: params });
    });

    // 0 = let OS choose an available port
    server.listen(0, "127.0.0.1", () => {});
    // Safety timeout in case Bear doesn't call back
    setTimeout(() => {
      try { server.close(); } catch {}
      resolve({ ok: false, data: { error: "timeout" } });
    }, 15000); // 15s
  });
}

const server = new McpServer({ name: "bear-mcp", version: "0.1.0" });

server.registerTool(
  "create_bear_note",
  {
    title: "Create a new note in Bear",
    description:
      "Creates a note in Bear using x-callback-url. Returns the new note identifier if callback succeeds.",
    // Align inputs with Bear's /create params (title, text, tags, etc.)
    // See Bear docs for the full list. 
    // https://bear.app/faq/x-callback-url-scheme-documentation/
    inputSchema: {
      title: z.string().optional(),
      text: z.string().optional(),
      tags: z.array(z.string()).optional(),
      open_note: z.boolean().default(true),
      edit: z.boolean().default(false),
      pin: z.boolean().default(false),
      timestamp: z.boolean().default(false)
    },
  },
  async (args) => {
    // Prepare a local HTTP callback (x-success / x-error)
    // Bear's /create action returns identifier and title via x-success. 
    // https://bear.app/faq/x-callback-url-scheme-documentation/
    const oneShot = await new Promise<{ port: number; ready: () => Promise<{ ok: boolean; data: Record<string, string> }> }>((resolve) => {
      const srv = http.createServer(); // dummy to get a free port
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        srv.close(() => {
          resolve({
            port,
            ready: () => captureCallback(),
          });
        });
      });
    });

    const xSuccess = `http://127.0.0.1:${oneShot.port}/success`;
    const xError = `http://127.0.0.1:${oneShot.port}/error`;

    const params = new URLSearchParams();
    if (args.title) params.set("title", args.title);
    if (args.text) params.set("text", args.text);
    if (args.tags?.length) params.set("tags", args.tags.join(","));
    if (!args.open_note) params.set("open_note", "no");
    if (args.edit) params.set("edit", "yes");
    if (args.pin) params.set("pin", "yes");
    if (args.timestamp) params.set("timestamp", "yes");

    // x-callback params
    params.set("x-success", xSuccess);
    params.set("x-error", xError);

    const bearUrl = `bear://x-callback-url/create?${params.toString()}`;
    await openUrl(bearUrl);

    const result = await oneShot.ready();
    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Bear create failed or timed out: ${JSON.stringify(result.data)}` }],
        isError: true
      };
    }
    // Typically includes ?identifier=...&title=...
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ status: "created", ...result.data }, null, 2),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
