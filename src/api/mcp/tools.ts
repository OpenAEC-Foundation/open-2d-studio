/**
 * MCP Tool Definitions
 *
 * Generates MCP tool definitions from the command registry.
 */

import { commandRegistry } from '../commands';

/**
 * MCP Tool definition format
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Get all MCP tool definitions from the command registry.
 * These can be exposed via an MCP server.
 */
export function getMcpToolDefinitions(): McpTool[] {
  return commandRegistry.getMcpTools();
}

/**
 * Get a specific tool definition by name.
 */
export function getMcpToolByName(name: string): McpTool | undefined {
  const tools = getMcpToolDefinitions();
  return tools.find(t => t.name === name);
}

/**
 * Parse an MCP tool name to extract command details.
 * Format: cad_{command}_{action}[_{entity}]
 */
export function parseMcpToolName(name: string): {
  command: string;
  action: string;
  entity?: string;
} | null {
  if (!name.startsWith('cad_')) return null;

  const parts = name.substring(4).split('_');
  if (parts.length < 2) return null;

  if (parts.length === 2) {
    return { command: parts[0], action: parts[1] };
  }

  // Handle entity names that may contain underscores
  return {
    command: parts[0],
    action: parts[1],
    entity: parts.slice(2).join('_'),
  };
}

/**
 * Get tool definitions grouped by category.
 */
export function getMcpToolsByCategory(): Record<string, McpTool[]> {
  const tools = getMcpToolDefinitions();
  const grouped: Record<string, McpTool[]> = {};

  for (const tool of tools) {
    const parsed = parseMcpToolName(tool.name);
    if (!parsed) continue;

    const category = parsed.command;
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(tool);
  }

  return grouped;
}

/**
 * Generate a markdown documentation of all MCP tools.
 */
export function generateMcpToolsDocumentation(): string {
  const grouped = getMcpToolsByCategory();
  const lines: string[] = ['# Open 2D Studio MCP Tools', ''];

  for (const [category, tools] of Object.entries(grouped).sort()) {
    lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)} Commands`, '');

    for (const tool of tools) {
      lines.push(`### ${tool.name}`, '');
      lines.push(tool.description, '');

      const schema = tool.inputSchema;
      if (schema.required.length > 0 || Object.keys(schema.properties).length > 0) {
        lines.push('**Parameters:**', '');

        for (const [name, prop] of Object.entries(schema.properties)) {
          const propObj = prop as Record<string, unknown>;
          const required = schema.required.includes(name);
          const type = propObj.type || (propObj.oneOf ? 'point' : 'any');
          const desc = propObj.description || '';

          lines.push(`- \`${name}\` (${type}${required ? ', required' : ''}): ${desc}`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}
