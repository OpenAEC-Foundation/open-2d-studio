/**
 * Parameter Validation Utilities
 *
 * Validates command parameters against schemas.
 */

import type { ParamSchema, PointInput } from './types';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized: Record<string, unknown>;
}

/**
 * Normalize a point input to {x, y} format
 */
export function normalizePoint(input: PointInput): { x: number; y: number } {
  if (Array.isArray(input)) {
    return { x: input[0], y: input[1] };
  }
  return input;
}

/**
 * Normalize an array of points
 */
export function normalizePoints(inputs: PointInput[]): { x: number; y: number }[] {
  return inputs.map(normalizePoint);
}

/**
 * Check if value is a valid point
 */
export function isValidPoint(value: unknown): value is PointInput {
  if (Array.isArray(value)) {
    return value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number';
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return typeof obj.x === 'number' && typeof obj.y === 'number';
  }
  return false;
}

/**
 * Check if value is a valid array of points
 */
export function isValidPoints(value: unknown): value is PointInput[] {
  if (!Array.isArray(value)) return false;
  return value.every(isValidPoint);
}

/**
 * Validate a single parameter against its schema
 */
function validateParam(
  name: string,
  value: unknown,
  schema: ParamSchema,
  errors: string[],
  warnings: string[]
): unknown {
  // Check required
  if (value === undefined || value === null) {
    if (schema.required) {
      errors.push(`Parameter '${name}' is required`);
      return undefined;
    }
    return schema.default;
  }

  // Type validation
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`Parameter '${name}' must be a string`);
        return undefined;
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`Parameter '${name}' must be one of: ${schema.enum.join(', ')}`);
        return undefined;
      }
      return value;

    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        errors.push(`Parameter '${name}' must be a number`);
        return undefined;
      }
      if (schema.min !== undefined && value < schema.min) {
        errors.push(`Parameter '${name}' must be >= ${schema.min}`);
        return undefined;
      }
      if (schema.max !== undefined && value > schema.max) {
        errors.push(`Parameter '${name}' must be <= ${schema.max}`);
        return undefined;
      }
      return value;

    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`Parameter '${name}' must be a boolean`);
        return undefined;
      }
      return value;

    case 'point':
      if (!isValidPoint(value)) {
        errors.push(`Parameter '${name}' must be a point ({x, y} or [x, y])`);
        return undefined;
      }
      return normalizePoint(value);

    case 'points':
      if (!isValidPoints(value)) {
        errors.push(`Parameter '${name}' must be an array of points`);
        return undefined;
      }
      return normalizePoints(value);

    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`Parameter '${name}' must be an object`);
        return undefined;
      }
      // Validate nested properties if defined
      if (schema.properties) {
        const obj = value as Record<string, unknown>;
        const result: Record<string, unknown> = {};
        for (const prop of schema.properties) {
          result[prop.name] = validateParam(
            `${name}.${prop.name}`,
            obj[prop.name],
            prop,
            errors,
            warnings
          );
        }
        return result;
      }
      return value;

    case 'array':
      if (!Array.isArray(value)) {
        errors.push(`Parameter '${name}' must be an array`);
        return undefined;
      }
      // Validate items if schema defined
      if (schema.items) {
        return value.map((item, i) =>
          validateParam(`${name}[${i}]`, item, schema.items!, errors, warnings)
        );
      }
      return value;

    case 'any':
      return value;

    default:
      warnings.push(`Unknown type '${schema.type}' for parameter '${name}'`);
      return value;
  }
}

/**
 * Validate all parameters against schemas
 */
export function validateParams(
  params: Record<string, unknown>,
  schemas: ParamSchema[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalized: Record<string, unknown> = {};

  // Validate each schema
  for (const schema of schemas) {
    normalized[schema.name] = validateParam(
      schema.name,
      params[schema.name],
      schema,
      errors,
      warnings
    );
  }

  // Check for unknown parameters
  const knownParams = new Set(schemas.map(s => s.name));
  for (const key of Object.keys(params)) {
    if (!knownParams.has(key)) {
      warnings.push(`Unknown parameter '${key}'`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalized,
  };
}

/**
 * Quick validation helper - throws on error
 */
export function assertValidParams(
  params: Record<string, unknown>,
  schemas: ParamSchema[]
): Record<string, unknown> {
  const result = validateParams(params, schemas);
  if (!result.valid) {
    throw new Error(`Validation failed: ${result.errors.join('; ')}`);
  }
  return result.normalized;
}
