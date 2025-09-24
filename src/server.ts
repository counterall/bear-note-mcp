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
async function captureCallback(timeoutMs: number = 15000, port: number): Promise<{ ok: boolean; data: Record<string, string> }> {
  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = (result: { ok: boolean; data: Record<string, string> }) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || "", `http://${req.headers.host}`);
        const params: Record<string, string> = {};
        reqUrl.searchParams.forEach((v, k) => (params[k] = v));

        const ok = reqUrl.pathname.includes("success");
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(ok ? "OK" : "ERROR");
        
        // Clean up server after response
        setImmediate(() => {
          server.close(() => {
            safeResolve({ ok, data: params });
          });
        });
      } catch (error) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
        server.close(() => {
          safeResolve({ ok: false, data: { error: "callback_processing_error", message: String(error) } });
        });
      }
    });

    server.on('error', (error) => {
      safeResolve({ ok: false, data: { error: "server_error", message: String(error) } });
    });

    // 0 = let OS choose an available port
    const portToUse = port || 0;
    server.listen(portToUse, "127.0.0.1", () => {});

    // Safety timeout in case Bear doesn't call back
    const timeout = setTimeout(() => {
      server.close(() => {
        safeResolve({ ok: false, data: { error: "timeout", timeoutMs: String(timeoutMs) } });
      });
    }, timeoutMs);

    // Clear timeout if we resolve early
    server.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

// Helper: get a free port more efficiently
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to get server address')));
      }
    });
    server.on('error', reject);
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
      title: z.string().optional().describe("The title of the note"),
      text: z.string().optional().describe("The text content of the note"),
      tags: z.array(z.string()).optional().describe("Array of tags to add to the note"),
      open_note: z.boolean().default(true).describe("Whether to open the note after creation"),
      edit: z.boolean().default(false).describe("Whether to open the note in edit mode"),
      pin: z.boolean().default(false).describe("Whether to pin the note"),
      timestamp: z.boolean().default(false).describe("Whether to add a timestamp")
    },
  },
  async (args) => {
    try {
      // Get a free port first
      const port = await getFreePort();
      
      const xSuccess = `http://127.0.0.1:${port}/success`;
      const xError = `http://127.0.0.1:${port}/error`;

      const queryParts: string[] = [];
      if (args.title) queryParts.push(`title=${encodeURIComponent(args.title)}`);
      if (args.text) queryParts.push(`text=${encodeURIComponent(args.text)}`);
      if (args.tags?.length) {
        const encodedTags = args.tags.map(tag => encodeURIComponent(tag)).join(",");
        queryParts.push(`tags=${encodedTags}`);
      }
      if (!args.open_note) queryParts.push("open_note=no");
      if (args.edit) queryParts.push("edit=yes");
      if (args.pin) queryParts.push("pin=yes");
      if (args.timestamp) queryParts.push("timestamp=yes");

      // x-callback params
      queryParts.push(`x-success=${encodeURIComponent(xSuccess)}`);
      queryParts.push(`x-error=${encodeURIComponent(xError)}`);

      const queryString = queryParts.join("&");
      const bearUrl = `bear://x-callback-url/create?${queryString}`;
      
      // Start the callback server and open Bear URL concurrently
      const [result] = await Promise.all([
        captureCallback(15000, port),
        openUrl(bearUrl)
      ]);

      if (!result.ok) {
        return {
          content: [{ 
            type: "text", 
            text: `Bear create failed: ${result.data.error || 'unknown error'}\nDetails: ${JSON.stringify(result.data)}` 
          }],
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
    } catch (error) {
      return {
        content: [{ 
          type: "text", 
          text: `Failed to create Bear note: ${error instanceof Error ? error.message : String(error)}` 
        }],
        isError: true
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
