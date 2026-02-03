/**
 * Command Registry
 *
 * Central registry for all commands. Handles registration,
 * lookup, validation, and execution.
 */

import type {
  Command,
  CommandResponse,
  CommandDefinition,
  CommandContext,
  ParamSchema,
} from './types';
import { validateParams } from './validation';

/**
 * Generate command key from command/action/entity
 */
function getCommandKey(command: string, action: string, entity?: string): string {
  return entity ? `${command}:${action}:${entity}` : `${command}:${action}`;
}

/**
 * Generate MCP tool name from command definition
 */
function getMcpToolName(def: CommandDefinition): string {
  if (def.mcpToolName) return def.mcpToolName;
  return def.entity
    ? `cad_${def.command}_${def.action}_${def.entity}`
    : `cad_${def.command}_${def.action}`;
}

/**
 * Command Registry class
 */
export class CommandRegistry {
  private commands = new Map<string, CommandDefinition>();
  private context: CommandContext | null = null;

  /**
   * Initialize the registry with context
   */
  init(context: CommandContext): void {
    this.context = context;
  }

  /**
   * Register a command definition
   */
  register(definition: CommandDefinition): void {
    const key = getCommandKey(definition.command, definition.action, definition.entity);
    if (this.commands.has(key)) {
      console.warn(`Command ${key} is being overwritten`);
    }
    this.commands.set(key, definition);
  }

  /**
   * Register multiple commands at once
   */
  registerAll(definitions: CommandDefinition[]): void {
    for (const def of definitions) {
      this.register(def);
    }
  }

  /**
   * Get a command definition
   */
  get(command: string, action: string, entity?: string): CommandDefinition | undefined {
    const key = getCommandKey(command, action, entity);
    return this.commands.get(key);
  }

  /**
   * Check if a command exists
   */
  has(command: string, action: string, entity?: string): boolean {
    const key = getCommandKey(command, action, entity);
    return this.commands.has(key);
  }

  /**
   * Execute a command
   */
  async execute(cmd: Command): Promise<CommandResponse> {
    const startTime = performance.now();

    if (!this.context) {
      return {
        success: false,
        error: 'Command registry not initialized',
      };
    }

    // Look up command definition
    const definition = this.get(cmd.command, cmd.action, cmd.entity);
    if (!definition) {
      return {
        success: false,
        error: `Unknown command: ${cmd.command}/${cmd.action}${cmd.entity ? `/${cmd.entity}` : ''}`,
      };
    }

    // Validate parameters
    const validation = validateParams(cmd.params, definition.params);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.errors.join('; '),
        warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
      };
    }

    try {
      // Execute with or without transaction
      let response: CommandResponse;

      if (cmd.transaction && definition.modifiesState !== false) {
        response = await this.context.transactions.run(cmd.transaction, () =>
          definition.handler(validation.normalized, this.context!)
        );
      } else {
        response = await definition.handler(validation.normalized, this.context);
      }

      // Add execution time and warnings
      response.executionTime = performance.now() - startTime;
      if (validation.warnings.length > 0) {
        response.warnings = [...(response.warnings || []), ...validation.warnings];
      }

      return response;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime: performance.now() - startTime,
      };
    }
  }

  /**
   * List all registered commands
   */
  list(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /**
   * List commands by category
   */
  listByCategory(category: string): CommandDefinition[] {
    return this.list().filter(def => def.command === category);
  }

  /**
   * Get command info for documentation/listing
   */
  getCommandInfo(): Array<{
    command: string;
    action: string;
    entity?: string;
    description: string;
    mcpToolName: string;
    params: ParamSchema[];
  }> {
    return this.list().map(def => ({
      command: def.command,
      action: def.action,
      entity: def.entity,
      description: def.description,
      mcpToolName: getMcpToolName(def),
      params: def.params,
    }));
  }

  /**
   * Get MCP tool definitions
   */
  getMcpTools(): Array<{
    name: string;
    description: string;
    inputSchema: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  }> {
    return this.list().map(def => ({
      name: getMcpToolName(def),
      description: def.description,
      inputSchema: this.schemaToJsonSchema(def.params),
    }));
  }

  /**
   * Convert param schemas to JSON Schema format (for MCP)
   */
  private schemaToJsonSchema(params: ParamSchema[]): {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  } {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of params) {
      properties[param.name] = this.paramToJsonSchema(param);
      if (param.required) {
        required.push(param.name);
      }
    }

    return {
      type: 'object',
      properties,
      required,
    };
  }

  /**
   * Convert a single param schema to JSON Schema
   */
  private paramToJsonSchema(param: ParamSchema): Record<string, unknown> {
    const schema: Record<string, unknown> = {};

    if (param.description) {
      schema.description = param.description;
    }

    switch (param.type) {
      case 'string':
        schema.type = 'string';
        if (param.enum) schema.enum = param.enum;
        break;
      case 'number':
        schema.type = 'number';
        if (param.min !== undefined) schema.minimum = param.min;
        if (param.max !== undefined) schema.maximum = param.max;
        break;
      case 'boolean':
        schema.type = 'boolean';
        break;
      case 'point':
        schema.oneOf = [
          {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            required: ['x', 'y'],
          },
          {
            type: 'array',
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2,
          },
        ];
        break;
      case 'points':
        schema.type = 'array';
        schema.items = {
          oneOf: [
            {
              type: 'object',
              properties: { x: { type: 'number' }, y: { type: 'number' } },
              required: ['x', 'y'],
            },
            {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2,
            },
          ],
        };
        break;
      case 'object':
        schema.type = 'object';
        if (param.properties) {
          schema.properties = {};
          schema.required = [];
          for (const prop of param.properties) {
            (schema.properties as Record<string, unknown>)[prop.name] = this.paramToJsonSchema(prop);
            if (prop.required) {
              (schema.required as string[]).push(prop.name);
            }
          }
        }
        break;
      case 'array':
        schema.type = 'array';
        if (param.items) {
          schema.items = this.paramToJsonSchema(param.items);
        }
        break;
      case 'any':
        // No type constraint
        break;
    }

    if (param.default !== undefined) {
      schema.default = param.default;
    }

    return schema;
  }
}

/**
 * Global registry instance
 */
export const commandRegistry = new CommandRegistry();
