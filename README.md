# Bear Note MCP Server

This project is a Node.js MCP (Model Context Protocol) server that allows AI agents to interact with the Bear note-taking app on macOS using Bear's x-callback-url scheme.

## Features

- **Create Bear Notes**: Agents can create new notes in Bear with custom titles, text, and tags.
- **Tag Support**: Supports both flat and nested tags (e.g., `test`, `test/mcp-server`).
- **Open/Edit/Pin**: Options to open the note after creation, open in edit mode, or pin the note.
- **Callback Handling**: Uses a local HTTP server to capture Bear's x-success/x-error callbacks for robust automation.
- **macOS Native Integration**: Leverages the `open` command to trigger Bear via its URL scheme.

## Setup Instructions

### Prerequisites
- macOS with [Bear](https://bear.app/) installed
- Node.js (v18 or newer recommended)
- npm

### Installation
1. Clone this repository:
   ```bash
   git clone git@github.com:counterall/bear-note-mcp.git
   cd bear-note-mcp
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

### Running the MCP Server, use VSCode as an example
Add the following to your global or project-specific `mcp.json`:
```json
{
	"servers": {
		"bear-note": {
      "command": "node",
      "args": ["/path/to/bear-note-mcp/dist/server.js"]
    }
	}
}
```

### Notes
- The server must be running on the same macOS machine as Bear.
- The Bear app must be installed and accessible via the `bear://` URL scheme.
---

For more details, see the code in `src/server.ts` or reach out via issues.
