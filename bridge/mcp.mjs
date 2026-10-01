/**
 * MCP, without the agent SDK.
 *
 * JARVIS's own tools — the heads-up display, the interface controls, the
 * browser, the camera — used to be built with `createSdkMcpServer` and `tool`
 * from `@anthropic-ai/claude-agent-sdk`. Those are thin wrappers over the MCP
 * protocol, and the SDK is a paid product's client, so carrying it just to
 * declare four in-process servers meant a dependency on something that had
 * nothing to do with the work.
 *
 * These two stand in for them, built directly on `@modelcontextprotocol/sdk`.
 * The signatures are identical, so the four server modules only change their
 * import line; everything below that line is untouched.
 *
 *   import { createSdkMcpServer, tool } from './mcp.mjs'
 *
 * `alwaysLoad` is dropped rather than emulated. It was an agent-SDK hint that a
 * server's tools should not sit behind tool search — a decision the SDK made on
 * the model's behalf. Here the brain is ours, so we simply always send every
 * tool we have. There is no search to hide them behind.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * Declares one tool. Held as a plain record until `createSdkMcpServer` registers
 * it, which keeps the call sites reading exactly as they did before.
 *
 * @param {string} name
 * @param {string} description
 * @param object} schema - Zod raw shape
 * @param {(args: object) => Promise<object>} handler
 */
export const tool = (name, description, schema, handler) => ({
  name,
  description,
  schema,
  handler,
})

/**
 * Builds an MCP server and registers every tool passed in.
 *
 * @param {{ name: string, version: string, instructions?: string, tools?: object[] }} spec
 * @returns {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer}
 */
export function createSdkMcpServer({ name, version, instructions, tools }) {
  const server = new McpServer({ name, version }, { instructions })
  for (const t of tools ?? []) {
    server.tool(t.name, t.description, t.schema, t.handler)
  }
  return server
}
