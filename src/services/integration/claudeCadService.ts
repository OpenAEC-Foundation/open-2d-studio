/**
 * Claude CAD Integration Service
 *
 * Bridges Claude AI with the CAD API to enable natural language drawing commands.
 * Uses the MCP tool definitions for structured command execution.
 */

import { invoke } from '@tauri-apps/api/core';
import { executeMcpTool } from '../../api/mcp/server';
import { getMcpToolsByCategory } from '../../api/mcp/tools';

interface ShellResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * MCP tool call format that Claude should output
 */
interface McpToolCall {
  tool: string;
  arguments: Record<string, unknown>;
}

/**
 * Generate the system prompt dynamically using MCP tool definitions
 */
function generateSystemPrompt(): string {
  let prompt = `You are integrated into Open 2D Studio, a 2D CAD application.

OUTPUT FORMAT: You MUST respond with ONLY a JSON array of tool calls. No explanations, no markdown, no text.

Format:
[{"tool": "tool_name", "arguments": {...}}]

For single commands:
[{"tool": "cad_draw_create_circle", "arguments": {"center": {"x": 400, "y": 300}, "radius": 50}}]

For multiple commands:
[
  {"tool": "cad_draw_create_rectangle", "arguments": {"topLeft": {"x": 100, "y": 100}, "width": 200, "height": 100}},
  {"tool": "cad_draw_create_circle", "arguments": {"center": {"x": 200, "y": 150}, "radius": 30}}
]

COORDINATE SYSTEM: Origin (0,0) at top-left. X increases right, Y increases down.
CANVAS: ~1200x800 pixels. Center around (600, 400). Use X: 200-1000, Y: 100-600.

`;

  // Add available tools from MCP module
  const grouped = getMcpToolsByCategory();

  if (Object.keys(grouped).length > 0) {
    prompt += `AVAILABLE TOOLS:\n\n`;

    // Add each category
    for (const [category, tools] of Object.entries(grouped)) {
      prompt += `${category.toUpperCase()}:\n`;
      for (const tool of tools) {
        const schema = tool.inputSchema;
        const required = schema.required || [];
        const params = Object.entries(schema.properties || {})
          .map(([name, prop]: [string, any]) => {
            const req = required.includes(name) ? '*' : '';
            const type = prop.type || (prop.oneOf ? 'point' : 'any');
            return `${name}${req}:${type}`;
          })
          .join(', ');
        prompt += `  ${tool.name}(${params})\n`;
      }
      prompt += '\n';
    }
  }

  prompt += `EXAMPLES:

User: "draw a line"
[{"tool": "cad_draw_create_line", "arguments": {"start": {"x": 200, "y": 300}, "end": {"x": 500, "y": 300}}}]

User: "draw a red circle"
[{"tool": "cad_draw_create_circle", "arguments": {"center": {"x": 400, "y": 300}, "radius": 50, "style": {"strokeColor": "#ff0000"}}}]

User: "draw a blue filled rectangle"
[{"tool": "cad_draw_create_rectangle", "arguments": {"topLeft": {"x": 300, "y": 200}, "width": 150, "height": 100, "style": {"fillColor": "#0066cc"}}}]

User: "draw a house"
[
  {"tool": "cad_draw_create_rectangle", "arguments": {"topLeft": {"x": 300, "y": 300}, "width": 200, "height": 150}},
  {"tool": "cad_draw_create_polyline", "arguments": {"points": [{"x": 300, "y": 300}, {"x": 400, "y": 200}, {"x": 500, "y": 300}], "closed": true}}
]

User: "draw a diagonal hatch"
[{"tool": "cad_draw_create_hatch", "arguments": {"points": [{"x": 100, "y": 100}, {"x": 200, "y": 100}, {"x": 200, "y": 200}, {"x": 100, "y": 200}], "patternType": "diagonal", "fillColor": "#ffcc00"}}]

User: "undo"
[{"tool": "cad_history_undo", "arguments": {}}]

User: "zoom to fit"
[{"tool": "cad_viewport_fit", "arguments": {}}]

User: "delete selected"
[{"tool": "cad_modify_delete", "arguments": {}}]

User: "delete all" or "remove all objects" or "clear canvas"
[
  {"tool": "cad_selection_all", "arguments": {}},
  {"tool": "cad_modify_delete", "arguments": {}}
]

User: "delete all circles"
[
  {"tool": "cad_selection_all", "arguments": {"type": "circle"}},
  {"tool": "cad_modify_delete", "arguments": {}}
]

User: "select all circles"
[{"tool": "cad_selection_all", "arguments": {"type": "circle"}}]

User: "select all"
[{"tool": "cad_selection_all", "arguments": {}}]

User: "move selection right 50"
[{"tool": "cad_modify_move", "arguments": {"offset": {"x": 50, "y": 0}}}]

User: "create a layer called Walls"
[{"tool": "cad_layer_create", "arguments": {"name": "Walls"}}]

User: "create a sheet from template 3" or "use template named 3"
[{"tool": "cad_document_newSheetFromTemplate", "arguments": {"templateName": "3"}}]

User: "put this drawing on the sheet" or "add current drawing to sheet"
[{"tool": "cad_sheet_addViewport", "arguments": {"drawingId": "current", "x": 50, "y": 50, "width": 300, "height": 200}}]

User: "create sheet from template and add drawing"
[
  {"tool": "cad_document_newSheetFromTemplate", "arguments": {"templateName": "3"}},
  {"tool": "cad_sheet_addViewport", "arguments": {"drawingId": "current", "x": 50, "y": 50, "width": 300, "height": 200}}
]

User: "list sheet templates"
[{"tool": "cad_document_listSheetTemplates", "arguments": {}}]

User: "list viewports on this sheet"
[{"tool": "cad_sheet_listViewports", "arguments": {}}]

User: "save this sheet as template named MyLayout"
[{"tool": "cad_document_saveSheetAsTemplate", "arguments": {"name": "MyLayout"}}]

User: "switch to sheet mode"
[{"tool": "cad_document_switchMode", "arguments": {"mode": "sheet"}}]

Remember: Output ONLY the JSON array. No explanations. No markdown code blocks.`;

  return prompt;
}

/**
 * Parse Claude's response as JSON tool calls
 */
function parseToolCalls(response: string): McpToolCall[] | null {
  // Clean the response
  let cleaned = response.trim();

  // Remove markdown code blocks if present
  cleaned = cleaned.replace(/^```(?:json)?\n?/gm, '');
  cleaned = cleaned.replace(/```$/gm, '');
  cleaned = cleaned.trim();

  // Try to find JSON array in the response
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  try {
    const parsed = JSON.parse(cleaned);

    // Ensure it's an array
    if (!Array.isArray(parsed)) {
      return [parsed as McpToolCall];
    }

    return parsed as McpToolCall[];
  } catch {
    return null;
  }
}

/**
 * Execute a natural language CAD command via Claude
 */
export async function executeClaudeCadCommand(userPrompt: string): Promise<{
  success: boolean;
  code?: string;
  error?: string;
  result?: any;
}> {
  try {
    // Generate system prompt dynamically with current API
    const systemPrompt = generateSystemPrompt();

    // Call Claude CLI with the CAD system prompt
    const fullPrompt = `${systemPrompt}\n\nUser request: ${userPrompt}`;

    const result = await invoke<ShellResult>('execute_shell', {
      program: 'claude',
      args: ['--print', fullPrompt],
    });

    if (!result.success || result.code !== 0) {
      return {
        success: false,
        error: result.stderr || 'Claude CLI failed',
      };
    }

    const response = result.stdout.trim();

    // Parse the JSON tool calls
    const toolCalls = parseToolCalls(response);

    if (!toolCalls || toolCalls.length === 0) {
      return {
        success: false,
        code: response,
        error: 'Claude did not return valid tool calls. Try rephrasing your request.',
      };
    }

    // Execute each tool call
    const results: any[] = [];
    let hasError = false;
    let errorMessage = '';

    for (const call of toolCalls) {
      if (!call.tool || typeof call.tool !== 'string') {
        hasError = true;
        errorMessage = 'Invalid tool call format';
        break;
      }

      const mcpResult = await executeMcpTool({
        name: call.tool,
        arguments: call.arguments || {},
      });

      if (mcpResult.isError) {
        hasError = true;
        errorMessage = mcpResult.content[0]?.text || 'Tool execution failed';
        break;
      }

      results.push(mcpResult);
    }

    if (hasError) {
      return {
        success: false,
        code: JSON.stringify(toolCalls, null, 2),
        error: errorMessage,
      };
    }

    return {
      success: true,
      code: JSON.stringify(toolCalls, null, 2),
      result: results,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to call Claude: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get the current system prompt (for debugging/display)
 */
export function getCadSystemPrompt(): string {
  return generateSystemPrompt();
}
