/**
 * MCP Server Bridge
 *
 * Provides MCP tool execution bridge for the CAD API.
 * This module allows external MCP clients to execute commands.
 */

import { commandRegistry, type Command, type CommandResponse } from '../commands';
import { parseMcpToolName, getMcpToolDefinitions, type McpTool } from './tools';

/**
 * MCP call request format
 */
export interface McpCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * MCP call response format
 */
export interface McpCallResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

/**
 * Execute an MCP tool call.
 * Converts the MCP format to our command format and executes it.
 */
export async function executeMcpTool(request: McpCallRequest): Promise<McpCallResponse> {
  const parsed = parseMcpToolName(request.name);

  if (!parsed) {
    return {
      content: [{ type: 'text', text: `Invalid tool name: ${request.name}` }],
      isError: true,
    };
  }

  const cmd: Command = {
    command: parsed.command,
    action: parsed.action,
    entity: parsed.entity,
    params: request.arguments,
  };

  try {
    const response = await commandRegistry.execute(cmd);
    return commandResponseToMcp(response);
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}

/**
 * Convert a CommandResponse to MCP format.
 */
function commandResponseToMcp(response: CommandResponse): McpCallResponse {
  if (!response.success) {
    return {
      content: [{ type: 'text', text: response.error || 'Unknown error' }],
      isError: true,
    };
  }

  // Format the response data as JSON
  const text = response.data ? JSON.stringify(response.data, null, 2) : 'Success';

  const result: McpCallResponse = {
    content: [{ type: 'text', text }],
  };

  // Add warnings if present
  if (response.warnings && response.warnings.length > 0) {
    result.content.push({
      type: 'text',
      text: `Warnings: ${response.warnings.join(', ')}`,
    });
  }

  return result;
}

/**
 * MCP Server configuration
 */
export interface McpServerConfig {
  name: string;
  version: string;
  capabilities?: {
    tools?: boolean;
  };
}

/**
 * Create MCP server info response.
 */
export function getMcpServerInfo(): McpServerConfig {
  return {
    name: 'open-2d-studio',
    version: '1.0.0',
    capabilities: {
      tools: true,
    },
  };
}

/**
 * Get MCP tools list response.
 */
export function getMcpToolsList(): { tools: McpTool[] } {
  return {
    tools: getMcpToolDefinitions(),
  };
}

/**
 * Handle an MCP JSON-RPC request.
 * This is a simplified handler for the MCP protocol.
 */
export async function handleMcpRequest(
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return getMcpServerInfo();

    case 'tools/list':
      return getMcpToolsList();

    case 'tools/call':
      if (!params || !params.name) {
        throw new Error('Missing tool name');
      }
      return executeMcpTool({
        name: params.name as string,
        arguments: (params.arguments as Record<string, unknown>) || {},
      });

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

/**
 * Express-style middleware for MCP endpoints.
 * Usage: app.post('/mcp', mcpMiddleware(cad));
 */
export function createMcpHandler() {
  return async (
    req: { body?: { method?: string; params?: Record<string, unknown>; id?: number | string } },
    res: { json: (data: unknown) => void; status: (code: number) => { json: (data: unknown) => void } }
  ) => {
    const { method, params, id } = req.body || {};

    if (!method) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid request: missing method' },
        id,
      });
      return;
    }

    try {
      const result = await handleMcpRequest(method, params);
      res.json({
        jsonrpc: '2.0',
        result,
        id,
      });
    } catch (error) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
        id,
      });
    }
  };
}
