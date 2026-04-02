import { parse } from './FormulaParser';
import type { ASTNode, ParameterUnit } from '../../types/constraints';

// ── EvaluationError ───────────────────────────────────────────────────────────

export class EvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationError';
  }
}

// ── Unit conversion ───────────────────────────────────────────────────────────

// Multiply by these factors to normalise into mm (length) or degrees (angle).
const LENGTH_TO_MM: Partial<Record<ParameterUnit, number>> = {
  mm: 1,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

const ANGLE_TO_DEG: Partial<Record<ParameterUnit, number>> = {
  deg: 1,
  rad: 180 / Math.PI,
};

function applyUnit(value: number, unit: ParameterUnit | undefined): number {
  if (unit === undefined) return value;
  const lengthFactor = LENGTH_TO_MM[unit];
  if (lengthFactor !== undefined) return value * lengthFactor;
  const angleFactor = ANGLE_TO_DEG[unit];
  if (angleFactor !== undefined) return value * angleFactor;
  // Units like ratio, none, mm2, mm3, mm4, kg, kN, MPa — pass through
  return value;
}

// ── Built-in constants ────────────────────────────────────────────────────────

const CONSTANTS: Record<string, number> = {
  PI: Math.PI,
  TAU: Math.PI * 2,
  E: Math.E,
  SQRT2: Math.SQRT2,
};

// ── Helper: convert degrees ↔ radians ─────────────────────────────────────────

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// ── Built-in functions ────────────────────────────────────────────────────────

type FnArgs = Array<number | boolean | string>;

const FUNCTIONS: Record<string, (...args: FnArgs) => number | boolean | string> = {
  // Trig (input degrees, output degrees for inverse trig)
  sin: (x) => Math.sin((x as number) * DEG_TO_RAD),
  cos: (x) => Math.cos((x as number) * DEG_TO_RAD),
  tan: (x) => Math.tan((x as number) * DEG_TO_RAD),
  asin: (x) => Math.asin(x as number) * RAD_TO_DEG,
  acos: (x) => Math.acos(x as number) * RAD_TO_DEG,
  atan: (x) => Math.atan(x as number) * RAD_TO_DEG,
  atan2: (y, x) => Math.atan2(y as number, x as number) * RAD_TO_DEG,

  // General math
  sqrt: (x) => Math.sqrt(x as number),
  pow: (base, exp) => Math.pow(base as number, exp as number),
  exp: (x) => Math.exp(x as number),
  ln: (x) => Math.log(x as number),
  log10: (x) => Math.log10(x as number),
  abs: (x) => Math.abs(x as number),
  sign: (x) => Math.sign(x as number),

  // Rounding
  round: (x, digits?) => {
    if (digits === undefined) return Math.round(x as number);
    const factor = Math.pow(10, digits as number);
    return Math.round((x as number) * factor) / factor;
  },
  floor: (x) => Math.floor(x as number),
  ceil: (x) => Math.ceil(x as number),

  // Multi-arg
  min: (...args) => Math.min(...(args as number[])),
  max: (...args) => Math.max(...(args as number[])),

  // Range / interpolation
  clamp: (value, lo, hi) =>
    Math.min(Math.max(value as number, lo as number), hi as number),
  lerp: (a, b, t) => (a as number) + ((b as number) - (a as number)) * (t as number),
  map: (value, inMin, inMax, outMin, outMax) => {
    const v = value as number;
    const iMin = inMin as number;
    const iMax = inMax as number;
    const oMin = outMin as number;
    const oMax = outMax as number;
    return oMin + ((v - iMin) / (iMax - iMin)) * (oMax - oMin);
  },

  // Conditional / selection (non-short-circuit version; `if` is special-cased)
  select: (index, ...choices) => {
    const i = index as number;
    if (i < 0 || i >= choices.length) {
      throw new EvaluationError(
        `select: index ${i} out of range (0..${choices.length - 1})`
      );
    }
    return choices[i];
  },
};

// ── evaluateAST ───────────────────────────────────────────────────────────────

export function evaluateAST(
  ast: ASTNode,
  context: Record<string, number | boolean | string>
): number | boolean | string {
  switch (ast.kind) {
    // ── Literals ────────────────────────────────────────────────────────────

    case 'number':
      return applyUnit(ast.value, ast.unit);

    case 'boolean':
      return ast.value;

    case 'string':
      return ast.value;

    // ── Identifier ──────────────────────────────────────────────────────────

    case 'identifier': {
      const name = ast.name;
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) {
        return CONSTANTS[name];
      }
      if (Object.prototype.hasOwnProperty.call(context, name)) {
        return context[name];
      }
      throw new EvaluationError(`Unknown identifier: '${name}'`);
    }

    // ── Cross reference ──────────────────────────────────────────────────────

    case 'crossref':
      throw new EvaluationError(
        `Cross-reference '@${ast.objectName}.${ast.paramName}' must be resolved before evaluation`
      );

    // ── Unary expressions ────────────────────────────────────────────────────

    case 'unary': {
      const val = evaluateAST(ast.operand, context);
      if (ast.operator === '-') {
        if (typeof val !== 'number') {
          throw new EvaluationError(`Unary '-' requires a number, got ${typeof val}`);
        }
        return -val;
      }
      if (ast.operator === '!') {
        if (typeof val !== 'boolean') {
          throw new EvaluationError(`Unary '!' requires a boolean, got ${typeof val}`);
        }
        return !val;
      }
      throw new EvaluationError(`Unknown unary operator: '${ast.operator}'`);
    }

    // ── Binary expressions ───────────────────────────────────────────────────

    case 'binary': {
      const op = ast.operator;

      // Short-circuit logical operators
      if (op === '&&') {
        const l = evaluateAST(ast.left, context);
        if (!l) return false;
        const r = evaluateAST(ast.right, context);
        return Boolean(r);
      }
      if (op === '||') {
        const l = evaluateAST(ast.left, context);
        if (l) return true;
        const r = evaluateAST(ast.right, context);
        return Boolean(r);
      }

      const left = evaluateAST(ast.left, context);
      const right = evaluateAST(ast.right, context);

      switch (op) {
        case '+':
          if (typeof left === 'string' || typeof right === 'string') {
            return String(left) + String(right);
          }
          return (left as number) + (right as number);
        case '-':
          return (left as number) - (right as number);
        case '*':
          return (left as number) * (right as number);
        case '/':
          if ((right as number) === 0) {
            throw new EvaluationError('Division by zero');
          }
          return (left as number) / (right as number);
        case '%':
          return (left as number) % (right as number);
        case '**':
          return Math.pow(left as number, right as number);
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '<':
          return (left as number) < (right as number);
        case '>':
          return (left as number) > (right as number);
        case '<=':
          return (left as number) <= (right as number);
        case '>=':
          return (left as number) >= (right as number);
        default:
          throw new EvaluationError(`Unknown binary operator: '${op}'`);
      }
    }

    // ── Conditional expression ────────────────────────────────────────────────

    case 'conditional': {
      const cond = evaluateAST(ast.condition, context);
      return cond
        ? evaluateAST(ast.consequent, context)
        : evaluateAST(ast.alternate, context);
    }

    // ── Function call ─────────────────────────────────────────────────────────

    case 'call': {
      const name = ast.name;

      // Special-case 'if' for proper short-circuit evaluation
      if (name === 'if') {
        if (ast.args.length !== 3) {
          throw new EvaluationError(`if() requires exactly 3 arguments`);
        }
        const cond = evaluateAST(ast.args[0], context);
        return cond
          ? evaluateAST(ast.args[1], context)
          : evaluateAST(ast.args[2], context);
      }

      const fn = FUNCTIONS[name];
      if (!fn) {
        throw new EvaluationError(`Unknown function: '${name}'`);
      }

      const args = ast.args.map((arg) => evaluateAST(arg, context));
      return fn(...args);
    }

    default: {
      // TypeScript exhaustiveness guard
      const _exhaustive: never = ast;
      throw new EvaluationError(`Unknown AST node kind: ${(_exhaustive as ASTNode).kind}`);
    }
  }
}

// ── evaluate ──────────────────────────────────────────────────────────────────

/**
 * Parse a formula string and evaluate it against the given context.
 * Throws ParseError for syntax errors, EvaluationError for runtime errors.
 */
export function evaluate(
  input: string,
  context: Record<string, number | boolean | string>
): number | boolean | string {
  const ast = parse(input);
  return evaluateAST(ast, context);
}
