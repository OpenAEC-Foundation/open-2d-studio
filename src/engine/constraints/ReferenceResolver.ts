import { parse } from './FormulaParser';
import type { ASTNode, Parameter } from '../../types/constraints';

// ── ReferenceResolveError ──────────────────────────────────────────────────────

export class ReferenceResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceResolveError';
  }
}

// ── Internal types ─────────────────────────────────────────────────────────────

interface ShapeEntry {
  shapeId: string;
  objectName: string;
  paramsByName: Map<string, string>; // param.name → param.id
}

// ── Constants to skip in extractDependencies ──────────────────────────────────

const BUILTIN_CONSTANTS = new Set(['PI', 'TAU', 'E', 'SQRT2']);

// Built-in function names supported by FormulaEvaluator
const BUILTIN_FUNCTIONS = new Set([
  'abs', 'ceil', 'floor', 'round', 'sqrt', 'cbrt',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'log', 'log2', 'log10', 'exp',
  'min', 'max', 'clamp', 'sign', 'pow', 'hypot',
  'if',
]);

// ── ReferenceResolver ──────────────────────────────────────────────────────────

export class ReferenceResolver {
  private shapesByName: Map<string, ShapeEntry> = new Map();
  private shapesById: Map<string, ShapeEntry> = new Map();
  private globalParams: Map<string, string> = new Map(); // param.name → param.id

  // ── Registration ────────────────────────────────────────────────────────────

  registerShape(shapeId: string, objectName: string, parameters: Parameter[]): void {
    const paramsByName = new Map<string, string>();
    for (const p of parameters) {
      paramsByName.set(p.name, p.id);
    }
    const entry: ShapeEntry = { shapeId, objectName, paramsByName };
    this.shapesById.set(shapeId, entry);
    this.shapesByName.set(objectName, entry);
  }

  unregisterShape(shapeId: string): void {
    const entry = this.shapesById.get(shapeId);
    if (entry) {
      this.shapesById.delete(shapeId);
      this.shapesByName.delete(entry.objectName);
    }
  }

  registerGlobal(param: Parameter): void {
    this.globalParams.set(param.name, param.id);
  }

  unregisterGlobal(paramName: string): void {
    this.globalParams.delete(paramName);
  }

  // ── Resolution ──────────────────────────────────────────────────────────────

  resolveLocal(shapeId: string, paramName: string): string {
    const entry = this.shapesById.get(shapeId);
    if (!entry) {
      throw new ReferenceResolveError(`Unknown shape id: "${shapeId}"`);
    }
    const paramId = entry.paramsByName.get(paramName);
    if (paramId === undefined) {
      throw new ReferenceResolveError(
        `Unknown parameter "${paramName}" in shape "${shapeId}" (object: "${entry.objectName}")`
      );
    }
    return paramId;
  }

  resolveCrossRef(objectName: string, paramName: string): string {
    if (objectName === 'global') {
      return this.resolveGlobal(paramName);
    }
    const entry = this.shapesByName.get(objectName);
    if (!entry) {
      throw new ReferenceResolveError(`Unknown object name: "${objectName}"`);
    }
    const paramId = entry.paramsByName.get(paramName);
    if (paramId === undefined) {
      throw new ReferenceResolveError(
        `Unknown parameter "${paramName}" in object "${objectName}"`
      );
    }
    return paramId;
  }

  resolveGlobal(paramName: string): string {
    const paramId = this.globalParams.get(paramName);
    if (paramId === undefined) {
      throw new ReferenceResolveError(`Unknown global parameter: "${paramName}"`);
    }
    return paramId;
  }

  // ── Dependency extraction ────────────────────────────────────────────────────

  extractDependencies(formula: string, ownerShapeId: string): string[] {
    let ast: ASTNode;
    try {
      ast = parse(formula);
    } catch {
      return [];
    }

    const deps = new Set<string>();

    const walk = (node: ASTNode): void => {
      switch (node.kind) {
        case 'identifier': {
          const name = node.name;
          // Skip constants and built-in function names
          if (BUILTIN_CONSTANTS.has(name) || BUILTIN_FUNCTIONS.has(name)) break;
          try {
            const paramId = this.resolveLocal(ownerShapeId, name);
            deps.add(paramId);
          } catch {
            // Unresolvable identifier — skip
          }
          break;
        }
        case 'crossref': {
          try {
            const paramId = this.resolveCrossRef(node.objectName, node.paramName);
            deps.add(paramId);
          } catch {
            // Unresolvable cross-reference — skip
          }
          break;
        }
        case 'unary':
          walk(node.operand);
          break;
        case 'binary':
          walk(node.left);
          walk(node.right);
          break;
        case 'call':
          for (const arg of node.args) walk(arg);
          break;
        case 'conditional':
          walk(node.condition);
          walk(node.consequent);
          walk(node.alternate);
          break;
        // number, boolean, string — no deps
        default:
          break;
      }
    };

    walk(ast);
    return Array.from(deps);
  }

  // ── Evaluation context ──────────────────────────────────────────────────────

  buildEvalContext(
    ownerShapeId: string,
    paramValues: Map<string, number | boolean | string>
  ): Record<string, number | boolean | string> {
    const ctx: Record<string, number | boolean | string> = {};

    // Add local params by name
    const entry = this.shapesById.get(ownerShapeId);
    if (entry) {
      for (const [paramName, paramId] of entry.paramsByName) {
        const value = paramValues.get(paramId);
        if (value !== undefined) {
          ctx[paramName] = value;
        }
      }
    }

    // Add cross-object refs as @ObjectName.paramName keys
    for (const [, shapeEntry] of this.shapesById) {
      if (shapeEntry.shapeId === ownerShapeId) continue;
      for (const [paramName, paramId] of shapeEntry.paramsByName) {
        const value = paramValues.get(paramId);
        if (value !== undefined) {
          const key = `@${shapeEntry.objectName}.${paramName}`;
          ctx[key] = value;
        }
      }
    }

    // Add global params as @global.paramName keys
    for (const [paramName, paramId] of this.globalParams) {
      const value = paramValues.get(paramId);
      if (value !== undefined) {
        ctx[`@global.${paramName}`] = value;
      }
    }

    return ctx;
  }
}
