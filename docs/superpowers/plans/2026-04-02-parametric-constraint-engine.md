# Parametric Constraint Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a constraint graph engine with formula evaluator, properties panel UI, visual constraints on canvas, and migration of existing parametric profile types.

**Architecture:** A Directed Acyclic Graph (DAG) drives parameter evaluation. Each parameter is a node; formulas create edges. Topological sort determines solve order. A custom formula parser supports trig, unit conversion, and cross-object references (`@Object.param`). The engine integrates into the existing Zustand store via a new `constraintSlice` and renders constraint overlays via a new `ConstraintLayer`.

**Tech Stack:** TypeScript, Vitest, React, Zustand (with Immer), Canvas 2D

**Spec:** `docs/superpowers/specs/2026-04-02-parametric-constraint-engine-design.md`

---

## File Map

### New Files

| File | Responsibility |
|---|---|
| `src/types/constraints.ts` | All constraint type definitions (Parameter, ConstraintNode, ConstraintGraph, etc.) |
| `src/engine/constraints/FormulaLexer.ts` | Tokenizer: string → token stream with unit recognition |
| `src/engine/constraints/FormulaParser.ts` | Recursive descent parser: tokens → AST |
| `src/engine/constraints/FormulaEvaluator.ts` | AST walker: evaluate with variable context + built-in functions |
| `src/engine/constraints/ConstraintGraph.ts` | DAG: add/remove nodes, cycle detection, topological sort, dirty propagation |
| `src/engine/constraints/ConstraintSolver.ts` | Orchestrator: dirty tracking, solve loop, geometry rebuild trigger |
| `src/engine/constraints/ReferenceResolver.ts` | Resolve `@Object.param` and `@global.x` to parameter IDs |
| `src/state/slices/constraintSlice.ts` | Zustand slice: global params, constraint graph state, actions |
| `src/components/panels/ParameterPanel.tsx` | Properties panel section for parametric parameters |
| `src/components/panels/FormulaInput.tsx` | Inline formula editor with autocomplete |
| `src/engine/renderer/layers/ConstraintLayer.ts` | Canvas overlay: vertices, edge dimensions, constraint lines |
| `src/services/parametric/constraintMigration.ts` | Convert existing profileTemplates to ShapeConstraintGraph |
| `src/engine/constraints/__tests__/FormulaLexer.test.ts` | Lexer tests |
| `src/engine/constraints/__tests__/FormulaParser.test.ts` | Parser tests |
| `src/engine/constraints/__tests__/FormulaEvaluator.test.ts` | Evaluator tests |
| `src/engine/constraints/__tests__/ConstraintGraph.test.ts` | Graph tests |
| `src/engine/constraints/__tests__/ConstraintSolver.test.ts` | Solver integration tests |
| `src/engine/constraints/__tests__/ReferenceResolver.test.ts` | Reference resolver tests |

### Modified Files

| File | Change |
|---|---|
| `src/types/parametric.ts` | Add `constraintGraph?: ShapeConstraintGraph` to `BaseParametricShape` |
| `src/state/slices/parametricSlice.ts` | Wire constraint solver into shape update actions |
| `src/engine/renderer/core/ParametricRenderer.ts` | Delegate to ConstraintLayer when shape has constraintGraph |
| `src/services/parametric/geometryGenerators.ts` | Add constraint-based geometry generation path |

---

## Task 1: Type Definitions

**Files:**
- Create: `src/types/constraints.ts`

- [ ] **Step 1: Create constraint type definitions**

```typescript
// src/types/constraints.ts
import type { Point } from './geometry';

// ── Parameter ──────────────────────────────────────────────

export type ParameterValueType = 'number' | 'integer' | 'boolean' | 'string';

export type ParameterUnit =
  | 'mm' | 'm' | 'in' | 'ft'
  | 'deg' | 'rad'
  | 'ratio' | 'none'
  | 'mm2' | 'mm3' | 'mm4'
  | 'kg' | 'kN' | 'MPa';

export interface Parameter {
  id: string;
  name: string;
  value: number | boolean | string;
  formula?: string;
  unit: ParameterUnit;
  min?: number;
  max?: number;
  group?: string;
  isReadOnly?: boolean;
  type: ParameterValueType;
}

// ── Constraint Graph ───────────────────────────────────────

export interface ConstraintError {
  type: 'syntax' | 'reference' | 'cycle' | 'range' | 'type';
  message: string;
  details?: string;
}

export interface ConstraintNode {
  parameterId: string;
  ownerId: string;
  dependencies: string[];
  formula?: string;
  isDirty: boolean;
  error?: ConstraintError;
}

export interface ConstraintGraph {
  nodes: Record<string, ConstraintNode>;
  solveOrder: string[];
  globalParameters: Record<string, Parameter>;
  isDirty: boolean;
}

// ── Parametric Geometry ────────────────────────────────────

export interface ParametricVertex {
  id: string;
  xParamId: string;
  yParamId: string;
}

export interface ParametricEdge {
  id: string;
  startVertexId: string;
  endVertexId: string;
  type: 'line' | 'arc';
  lengthParamId?: string;
  angleParamId?: string;
  bulge?: number;
}

export interface ShapeConstraintGraph {
  parameters: Parameter[];
  vertices: ParametricVertex[];
  edges: ParametricEdge[];
  constraintGraph: ConstraintGraph;
}

// ── Formula AST ────────────────────────────────────────────

export type TokenType =
  | 'number' | 'string' | 'boolean' | 'identifier' | 'operator'
  | 'lparen' | 'rparen' | 'comma' | 'dot' | 'at' | 'unit'
  | 'comparison' | 'logical' | 'not' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

export type ASTNode =
  | NumberLiteral
  | BooleanLiteral
  | StringLiteral
  | Identifier
  | UnaryExpression
  | BinaryExpression
  | FunctionCall
  | CrossReference
  | ConditionalExpression;

export interface NumberLiteral {
  kind: 'number';
  value: number;
  unit?: ParameterUnit;
}

export interface BooleanLiteral {
  kind: 'boolean';
  value: boolean;
}

export interface StringLiteral {
  kind: 'string';
  value: string;
}

export interface Identifier {
  kind: 'identifier';
  name: string;
}

export interface UnaryExpression {
  kind: 'unary';
  operator: string;
  operand: ASTNode;
}

export interface BinaryExpression {
  kind: 'binary';
  operator: string;
  left: ASTNode;
  right: ASTNode;
}

export interface FunctionCall {
  kind: 'call';
  name: string;
  args: ASTNode[];
}

export interface CrossReference {
  kind: 'crossref';
  objectName: string;
  paramName: string;
}

export interface ConditionalExpression {
  kind: 'conditional';
  condition: ASTNode;
  consequent: ASTNode;
  alternate: ASTNode;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/constraints.ts
git commit -m "feat(constraints): add type definitions for parametric constraint engine"
```

---

## Task 2: Formula Lexer

**Files:**
- Create: `src/engine/constraints/__tests__/FormulaLexer.test.ts`
- Create: `src/engine/constraints/FormulaLexer.ts`

- [ ] **Step 1: Write failing lexer tests**

```typescript
// src/engine/constraints/__tests__/FormulaLexer.test.ts
import { describe, it, expect } from 'vitest';
import { tokenize } from '../FormulaLexer';

describe('FormulaLexer', () => {
  describe('numbers', () => {
    it('tokenizes integers', () => {
      const tokens = tokenize('42');
      expect(tokens).toEqual([
        { type: 'number', value: '42', position: 0 },
        { type: 'eof', value: '', position: 2 },
      ]);
    });

    it('tokenizes decimals', () => {
      const tokens = tokenize('3.14');
      expect(tokens).toEqual([
        { type: 'number', value: '3.14', position: 0 },
        { type: 'eof', value: '', position: 4 },
      ]);
    });

    it('tokenizes scientific notation', () => {
      const tokens = tokenize('1e-3');
      expect(tokens).toEqual([
        { type: 'number', value: '1e-3', position: 0 },
        { type: 'eof', value: '', position: 4 },
      ]);
    });
  });

  describe('units', () => {
    it('tokenizes number with mm unit', () => {
      const tokens = tokenize('150mm');
      expect(tokens).toEqual([
        { type: 'number', value: '150', position: 0 },
        { type: 'unit', value: 'mm', position: 3 },
        { type: 'eof', value: '', position: 5 },
      ]);
    });

    it('tokenizes number with m unit', () => {
      const tokens = tokenize('0.3m');
      expect(tokens).toEqual([
        { type: 'number', value: '0.3', position: 0 },
        { type: 'unit', value: 'm', position: 3 },
        { type: 'eof', value: '', position: 4 },
      ]);
    });

    it('tokenizes number with in unit', () => {
      const tokens = tokenize('6in');
      expect(tokens).toEqual([
        { type: 'number', value: '6', position: 0 },
        { type: 'unit', value: 'in', position: 1 },
        { type: 'eof', value: '', position: 3 },
      ]);
    });

    it('tokenizes number with deg unit', () => {
      const tokens = tokenize('45deg');
      expect(tokens).toEqual([
        { type: 'number', value: '45', position: 0 },
        { type: 'unit', value: 'deg', position: 2 },
        { type: 'eof', value: '', position: 5 },
      ]);
    });

    it('tokenizes number with rad unit', () => {
      const tokens = tokenize('0.785rad');
      expect(tokens).toEqual([
        { type: 'number', value: '0.785', position: 0 },
        { type: 'unit', value: 'rad', position: 5 },
        { type: 'eof', value: '', position: 8 },
      ]);
    });
  });

  describe('operators', () => {
    it('tokenizes arithmetic operators', () => {
      const tokens = tokenize('a + b * c');
      const types = tokens.map(t => t.type);
      expect(types).toEqual(['identifier', 'operator', 'identifier', 'operator', 'identifier', 'eof']);
    });

    it('tokenizes power operator', () => {
      const tokens = tokenize('x ** 2');
      expect(tokens[1]).toEqual({ type: 'operator', value: '**', position: 2 });
    });

    it('tokenizes modulo operator', () => {
      const tokens = tokenize('a % b');
      expect(tokens[1]).toEqual({ type: 'operator', value: '%', position: 2 });
    });
  });

  describe('comparison operators', () => {
    it('tokenizes == and !=', () => {
      const tokens = tokenize('a == b');
      expect(tokens[1]).toEqual({ type: 'comparison', value: '==', position: 2 });
    });

    it('tokenizes <= and >=', () => {
      const tokens = tokenize('a <= b');
      expect(tokens[1]).toEqual({ type: 'comparison', value: '<=', position: 2 });
    });

    it('tokenizes < and >', () => {
      const tokens = tokenize('a > b');
      expect(tokens[1]).toEqual({ type: 'comparison', value: '>', position: 2 });
    });
  });

  describe('logical operators', () => {
    it('tokenizes && and ||', () => {
      const tokens = tokenize('a && b || c');
      expect(tokens[1]).toEqual({ type: 'logical', value: '&&', position: 2 });
      expect(tokens[3]).toEqual({ type: 'logical', value: '||', position: 7 });
    });

    it('tokenizes ! as not', () => {
      const tokens = tokenize('!a');
      expect(tokens[0]).toEqual({ type: 'not', value: '!', position: 0 });
    });
  });

  describe('identifiers and keywords', () => {
    it('tokenizes identifiers', () => {
      const tokens = tokenize('flangeWidth');
      expect(tokens[0]).toEqual({ type: 'identifier', value: 'flangeWidth', position: 0 });
    });

    it('tokenizes true and false as booleans', () => {
      const tokens = tokenize('true');
      expect(tokens[0]).toEqual({ type: 'boolean', value: 'true', position: 0 });
    });

    it('tokenizes constants as identifiers', () => {
      const tokens = tokenize('PI');
      expect(tokens[0]).toEqual({ type: 'identifier', value: 'PI', position: 0 });
    });
  });

  describe('cross-object references', () => {
    it('tokenizes @Object.param', () => {
      const tokens = tokenize('@HEA300.width');
      expect(tokens).toEqual([
        { type: 'at', value: '@', position: 0 },
        { type: 'identifier', value: 'HEA300', position: 1 },
        { type: 'dot', value: '.', position: 7 },
        { type: 'identifier', value: 'width', position: 8 },
        { type: 'eof', value: '', position: 13 },
      ]);
    });

    it('tokenizes @global.param', () => {
      const tokens = tokenize('@global.verdiepingshoogte');
      expect(tokens[1]).toEqual({ type: 'identifier', value: 'global', position: 1 });
    });
  });

  describe('complex expressions', () => {
    it('tokenizes a full formula', () => {
      const tokens = tokenize('max(8, height / 40)');
      const values = tokens.map(t => t.value);
      expect(values).toEqual(['max', '(', '8', ',', 'height', '/', '40', ')', '']);
    });

    it('tokenizes formula with cross-ref', () => {
      const tokens = tokenize('@Kolom1.width / 2');
      const values = tokens.map(t => t.value);
      expect(values).toEqual(['@', 'Kolom1', '.', 'width', '/', '2', '']);
    });
  });

  describe('strings', () => {
    it('tokenizes double-quoted strings', () => {
      const tokens = tokenize('"HEA300"');
      expect(tokens[0]).toEqual({ type: 'string', value: 'HEA300', position: 0 });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/constraints/__tests__/FormulaLexer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the lexer**

```typescript
// src/engine/constraints/FormulaLexer.ts
import type { Token, TokenType, ParameterUnit } from '../../types/constraints';

const UNITS: Set<string> = new Set(['mm', 'm', 'in', 'ft', 'deg', 'rad', 'mm2', 'mm3', 'mm4', 'kg', 'kN', 'MPa']);
const KEYWORDS: Record<string, TokenType> = { true: 'boolean', false: 'boolean' };

export class LexerError extends Error {
  constructor(message: string, public position: number) {
    super(message);
    this.name = 'LexerError';
  }
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < input.length) {
    // Skip whitespace
    if (/\s/.test(input[pos])) { pos++; continue; }

    const start = pos;
    const ch = input[pos];

    // String literal
    if (ch === '"' || ch === "'") {
      pos++;
      let str = '';
      while (pos < input.length && input[pos] !== ch) {
        if (input[pos] === '\\') { pos++; }
        str += input[pos];
        pos++;
      }
      if (pos >= input.length) throw new LexerError('Unterminated string', start);
      pos++; // closing quote
      tokens.push({ type: 'string', value: str, position: start });
      continue;
    }

    // Number (including scientific notation)
    if (/[0-9]/.test(ch) || (ch === '.' && pos + 1 < input.length && /[0-9]/.test(input[pos + 1]))) {
      let num = '';
      while (pos < input.length && /[0-9.]/.test(input[pos])) { num += input[pos]; pos++; }
      // Scientific notation
      if (pos < input.length && (input[pos] === 'e' || input[pos] === 'E')) {
        num += input[pos]; pos++;
        if (pos < input.length && (input[pos] === '+' || input[pos] === '-')) { num += input[pos]; pos++; }
        while (pos < input.length && /[0-9]/.test(input[pos])) { num += input[pos]; pos++; }
      }
      tokens.push({ type: 'number', value: num, position: start });

      // Check for unit suffix immediately after number
      const unitStart = pos;
      let unitCandidate = '';
      while (pos < input.length && /[a-zA-Z]/.test(input[pos])) { unitCandidate += input[pos]; pos++; }
      if (unitCandidate && UNITS.has(unitCandidate)) {
        tokens.push({ type: 'unit', value: unitCandidate, position: unitStart });
      } else {
        pos = unitStart; // rewind — not a unit
      }
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(ch)) {
      let id = '';
      while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) { id += input[pos]; pos++; }
      const kwType = KEYWORDS[id];
      tokens.push({ type: kwType || 'identifier', value: id, position: start });
      continue;
    }

    // Two-character operators
    if (pos + 1 < input.length) {
      const two = input[pos] + input[pos + 1];
      if (two === '**') { tokens.push({ type: 'operator', value: '**', position: start }); pos += 2; continue; }
      if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
        tokens.push({ type: 'comparison', value: two, position: start }); pos += 2; continue;
      }
      if (two === '&&' || two === '||') {
        tokens.push({ type: 'logical', value: two, position: start }); pos += 2; continue;
      }
    }

    // Single-character tokens
    if ('+-*/%'.includes(ch)) { tokens.push({ type: 'operator', value: ch, position: start }); pos++; continue; }
    if (ch === '<' || ch === '>') { tokens.push({ type: 'comparison', value: ch, position: start }); pos++; continue; }
    if (ch === '!') { tokens.push({ type: 'not', value: '!', position: start }); pos++; continue; }
    if (ch === '(') { tokens.push({ type: 'lparen', value: '(', position: start }); pos++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen', value: ')', position: start }); pos++; continue; }
    if (ch === ',') { tokens.push({ type: 'comma', value: ',', position: start }); pos++; continue; }
    if (ch === '.') { tokens.push({ type: 'dot', value: '.', position: start }); pos++; continue; }
    if (ch === '@') { tokens.push({ type: 'at', value: '@', position: start }); pos++; continue; }

    throw new LexerError(`Unexpected character: ${ch}`, pos);
  }

  tokens.push({ type: 'eof', value: '', position: pos });
  return tokens;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/constraints/__tests__/FormulaLexer.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/constraints/FormulaLexer.ts src/engine/constraints/__tests__/FormulaLexer.test.ts
git commit -m "feat(constraints): add formula lexer with unit recognition"
```

---

## Task 3: Formula Parser

**Files:**
- Create: `src/engine/constraints/__tests__/FormulaParser.test.ts`
- Create: `src/engine/constraints/FormulaParser.ts`

- [ ] **Step 1: Write failing parser tests**

```typescript
// src/engine/constraints/__tests__/FormulaParser.test.ts
import { describe, it, expect } from 'vitest';
import { parse, ParseError } from '../FormulaParser';

describe('FormulaParser', () => {
  describe('literals', () => {
    it('parses number literal', () => {
      expect(parse('42')).toEqual({ kind: 'number', value: 42, unit: undefined });
    });

    it('parses number with unit', () => {
      expect(parse('150mm')).toEqual({ kind: 'number', value: 150, unit: 'mm' });
    });

    it('parses boolean literal', () => {
      expect(parse('true')).toEqual({ kind: 'boolean', value: true });
    });

    it('parses string literal', () => {
      expect(parse('"hello"')).toEqual({ kind: 'string', value: 'hello' });
    });
  });

  describe('identifiers', () => {
    it('parses simple identifier', () => {
      expect(parse('height')).toEqual({ kind: 'identifier', name: 'height' });
    });
  });

  describe('arithmetic', () => {
    it('parses addition', () => {
      const ast = parse('a + b');
      expect(ast).toEqual({
        kind: 'binary',
        operator: '+',
        left: { kind: 'identifier', name: 'a' },
        right: { kind: 'identifier', name: 'b' },
      });
    });

    it('respects operator precedence: * before +', () => {
      const ast = parse('a + b * c');
      expect(ast.kind).toBe('binary');
      expect((ast as any).operator).toBe('+');
      expect((ast as any).right.operator).toBe('*');
    });

    it('parses power operator', () => {
      const ast = parse('x ** 2');
      expect(ast).toEqual({
        kind: 'binary',
        operator: '**',
        left: { kind: 'identifier', name: 'x' },
        right: { kind: 'number', value: 2, unit: undefined },
      });
    });

    it('parses unary minus', () => {
      const ast = parse('-x');
      expect(ast).toEqual({
        kind: 'unary',
        operator: '-',
        operand: { kind: 'identifier', name: 'x' },
      });
    });

    it('parses parenthesized expression', () => {
      const ast = parse('(a + b) * c');
      expect((ast as any).operator).toBe('*');
      expect((ast as any).left.operator).toBe('+');
    });
  });

  describe('comparison and logical', () => {
    it('parses comparison', () => {
      const ast = parse('height > 200');
      expect(ast).toEqual({
        kind: 'binary',
        operator: '>',
        left: { kind: 'identifier', name: 'height' },
        right: { kind: 'number', value: 200, unit: undefined },
      });
    });

    it('parses logical and', () => {
      const ast = parse('a > 0 && b > 0');
      expect((ast as any).operator).toBe('&&');
    });

    it('parses logical not', () => {
      const ast = parse('!a');
      expect(ast).toEqual({
        kind: 'unary',
        operator: '!',
        operand: { kind: 'identifier', name: 'a' },
      });
    });
  });

  describe('function calls', () => {
    it('parses single-arg function', () => {
      expect(parse('sin(45)')).toEqual({
        kind: 'call',
        name: 'sin',
        args: [{ kind: 'number', value: 45, unit: undefined }],
      });
    });

    it('parses multi-arg function', () => {
      const ast = parse('max(8, height / 40)');
      expect(ast.kind).toBe('call');
      expect((ast as any).name).toBe('max');
      expect((ast as any).args).toHaveLength(2);
    });

    it('parses nested function calls', () => {
      const ast = parse('max(abs(x), abs(y))');
      expect(ast.kind).toBe('call');
      expect((ast as any).args[0].kind).toBe('call');
    });
  });

  describe('cross-object references', () => {
    it('parses @Object.param', () => {
      expect(parse('@HEA300.width')).toEqual({
        kind: 'crossref',
        objectName: 'HEA300',
        paramName: 'width',
      });
    });

    it('parses @global.param', () => {
      expect(parse('@global.verdiepingshoogte')).toEqual({
        kind: 'crossref',
        objectName: 'global',
        paramName: 'verdiepingshoogte',
      });
    });

    it('parses cross-ref in expression', () => {
      const ast = parse('@Kolom1.width / 2');
      expect((ast as any).operator).toBe('/');
      expect((ast as any).left.kind).toBe('crossref');
    });
  });

  describe('complex formulas from spec', () => {
    it('parses: height * 0.5', () => {
      const ast = parse('height * 0.5');
      expect(ast.kind).toBe('binary');
    });

    it('parses: max(8, height / 40)', () => {
      const ast = parse('max(8, height / 40)');
      expect(ast.kind).toBe('call');
    });

    it('parses: 2 * flangeWidth * flangeThickness + (height - 2 * flangeThickness) * webThickness', () => {
      const ast = parse('2 * flangeWidth * flangeThickness + (height - 2 * flangeThickness) * webThickness');
      expect(ast.kind).toBe('binary');
      expect((ast as any).operator).toBe('+');
    });

    it('parses: clamp(thickness * 0.3, 3, 15)', () => {
      const ast = parse('clamp(thickness * 0.3, 3, 15)');
      expect(ast.kind).toBe('call');
      expect((ast as any).args).toHaveLength(3);
    });
  });

  describe('errors', () => {
    it('throws on unexpected token', () => {
      expect(() => parse('+')).toThrow(ParseError);
    });

    it('throws on unclosed parenthesis', () => {
      expect(() => parse('(a + b')).toThrow(ParseError);
    });

    it('throws on empty input', () => {
      expect(() => parse('')).toThrow(ParseError);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/constraints/__tests__/FormulaParser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the parser**

```typescript
// src/engine/constraints/FormulaParser.ts
import type { Token, TokenType, ASTNode, ParameterUnit } from '../../types/constraints';
import { tokenize } from './FormulaLexer';

export class ParseError extends Error {
  constructor(message: string, public position: number) {
    super(message);
    this.name = 'ParseError';
  }
}

export function parse(input: string): ASTNode {
  const tokens = tokenize(input);
  let pos = 0;

  function peek(): Token { return tokens[pos]; }
  function advance(): Token { return tokens[pos++]; }

  function expect(type: TokenType, value?: string): Token {
    const t = peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new ParseError(`Expected ${type}${value ? ` '${value}'` : ''}, got ${t.type} '${t.value}'`, t.position);
    }
    return advance();
  }

  function parseExpression(): ASTNode {
    return parseLogicalOr();
  }

  function parseLogicalOr(): ASTNode {
    let left = parseLogicalAnd();
    while (peek().type === 'logical' && peek().value === '||') {
      const op = advance().value;
      left = { kind: 'binary', operator: op, left, right: parseLogicalAnd() };
    }
    return left;
  }

  function parseLogicalAnd(): ASTNode {
    let left = parseComparison();
    while (peek().type === 'logical' && peek().value === '&&') {
      const op = advance().value;
      left = { kind: 'binary', operator: op, left, right: parseComparison() };
    }
    return left;
  }

  function parseComparison(): ASTNode {
    let left = parseAddition();
    while (peek().type === 'comparison') {
      const op = advance().value;
      left = { kind: 'binary', operator: op, left, right: parseAddition() };
    }
    return left;
  }

  function parseAddition(): ASTNode {
    let left = parseMultiplication();
    while (peek().type === 'operator' && (peek().value === '+' || peek().value === '-')) {
      const op = advance().value;
      left = { kind: 'binary', operator: op, left, right: parseMultiplication() };
    }
    return left;
  }

  function parseMultiplication(): ASTNode {
    let left = parsePower();
    while (peek().type === 'operator' && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
      const op = advance().value;
      left = { kind: 'binary', operator: op, left, right: parsePower() };
    }
    return left;
  }

  function parsePower(): ASTNode {
    let left = parseUnary();
    if (peek().type === 'operator' && peek().value === '**') {
      const op = advance().value;
      left = { kind: 'binary', operator: op, left, right: parseUnary() };
    }
    return left;
  }

  function parseUnary(): ASTNode {
    if (peek().type === 'operator' && peek().value === '-') {
      advance();
      return { kind: 'unary', operator: '-', operand: parseUnary() };
    }
    if (peek().type === 'not') {
      advance();
      return { kind: 'unary', operator: '!', operand: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): ASTNode {
    const t = peek();

    // Number literal (with optional unit)
    if (t.type === 'number') {
      advance();
      const numVal = parseFloat(t.value);
      let unit: ParameterUnit | undefined;
      if (peek().type === 'unit') {
        unit = advance().value as ParameterUnit;
      }
      return { kind: 'number', value: numVal, unit };
    }

    // Boolean literal
    if (t.type === 'boolean') {
      advance();
      return { kind: 'boolean', value: t.value === 'true' };
    }

    // String literal
    if (t.type === 'string') {
      advance();
      return { kind: 'string', value: t.value };
    }

    // Cross-object reference: @Object.param
    if (t.type === 'at') {
      advance();
      const obj = expect('identifier');
      expect('dot');
      const param = expect('identifier');
      return { kind: 'crossref', objectName: obj.value, paramName: param.value };
    }

    // Parenthesized expression
    if (t.type === 'lparen') {
      advance();
      const expr = parseExpression();
      expect('rparen');
      return expr;
    }

    // Identifier or function call
    if (t.type === 'identifier') {
      advance();
      // Check if function call
      if (peek().type === 'lparen') {
        advance(); // consume '('
        const args: ASTNode[] = [];
        if (peek().type !== 'rparen') {
          args.push(parseExpression());
          while (peek().type === 'comma') {
            advance();
            args.push(parseExpression());
          }
        }
        expect('rparen');
        return { kind: 'call', name: t.value, args };
      }
      return { kind: 'identifier', name: t.value };
    }

    throw new ParseError(`Unexpected token: ${t.type} '${t.value}'`, t.position);
  }

  const ast = parseExpression();
  if (peek().type !== 'eof') {
    throw new ParseError(`Unexpected token after expression: ${peek().value}`, peek().position);
  }
  return ast;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/constraints/__tests__/FormulaParser.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/constraints/FormulaParser.ts src/engine/constraints/__tests__/FormulaParser.test.ts
git commit -m "feat(constraints): add recursive descent formula parser"
```

---

## Task 4: Formula Evaluator

**Files:**
- Create: `src/engine/constraints/__tests__/FormulaEvaluator.test.ts`
- Create: `src/engine/constraints/FormulaEvaluator.ts`

- [ ] **Step 1: Write failing evaluator tests**

```typescript
// src/engine/constraints/__tests__/FormulaEvaluator.test.ts
import { describe, it, expect } from 'vitest';
import { evaluate, EvaluationError } from '../FormulaEvaluator';

describe('FormulaEvaluator', () => {
  describe('arithmetic', () => {
    it('evaluates number literal', () => {
      expect(evaluate('42', {})).toBe(42);
    });

    it('evaluates addition', () => {
      expect(evaluate('10 + 20', {})).toBe(30);
    });

    it('evaluates complex arithmetic', () => {
      expect(evaluate('2 * 3 + 4', {})).toBe(10);
    });

    it('evaluates power', () => {
      expect(evaluate('2 ** 3', {})).toBe(8);
    });

    it('evaluates modulo', () => {
      expect(evaluate('10 % 3', {})).toBe(1);
    });

    it('evaluates unary minus', () => {
      expect(evaluate('-5', {})).toBe(-5);
    });

    it('evaluates parentheses', () => {
      expect(evaluate('(2 + 3) * 4', {})).toBe(20);
    });
  });

  describe('unit conversion', () => {
    it('converts mm (identity)', () => {
      expect(evaluate('150mm', {})).toBe(150);
    });

    it('converts m to mm', () => {
      expect(evaluate('0.15m', {})).toBe(150);
    });

    it('converts in to mm', () => {
      expect(evaluate('1in', {})).toBeCloseTo(25.4);
    });

    it('converts ft to mm', () => {
      expect(evaluate('1ft', {})).toBeCloseTo(304.8);
    });

    it('converts rad to deg', () => {
      expect(evaluate('3.14159265rad', {})).toBeCloseTo(180, 3);
    });

    it('keeps deg as-is', () => {
      expect(evaluate('45deg', {})).toBe(45);
    });
  });

  describe('variables', () => {
    it('resolves variable from context', () => {
      expect(evaluate('height', { height: 300 })).toBe(300);
    });

    it('uses variable in expression', () => {
      expect(evaluate('height * 0.5', { height: 300 })).toBe(150);
    });

    it('throws on undefined variable', () => {
      expect(() => evaluate('unknown', {})).toThrow(EvaluationError);
    });
  });

  describe('comparison and logical', () => {
    it('evaluates greater than', () => {
      expect(evaluate('10 > 5', {})).toBe(true);
    });

    it('evaluates equality', () => {
      expect(evaluate('10 == 10', {})).toBe(true);
    });

    it('evaluates logical and', () => {
      expect(evaluate('true && false', {})).toBe(false);
    });

    it('evaluates logical not', () => {
      expect(evaluate('!true', {})).toBe(false);
    });
  });

  describe('built-in functions — trigonometry', () => {
    it('evaluates sin(90) in degrees', () => {
      expect(evaluate('sin(90)', {})).toBeCloseTo(1);
    });

    it('evaluates cos(0) in degrees', () => {
      expect(evaluate('cos(0)', {})).toBeCloseTo(1);
    });

    it('evaluates tan(45) in degrees', () => {
      expect(evaluate('tan(45)', {})).toBeCloseTo(1);
    });

    it('evaluates asin(1) returns degrees', () => {
      expect(evaluate('asin(1)', {})).toBeCloseTo(90);
    });

    it('evaluates atan2(1, 1) returns degrees', () => {
      expect(evaluate('atan2(1, 1)', {})).toBeCloseTo(45);
    });
  });

  describe('built-in functions — math', () => {
    it('evaluates sqrt', () => {
      expect(evaluate('sqrt(16)', {})).toBe(4);
    });

    it('evaluates abs', () => {
      expect(evaluate('abs(-5)', {})).toBe(5);
    });

    it('evaluates pow', () => {
      expect(evaluate('pow(2, 10)', {})).toBe(1024);
    });

    it('evaluates exp', () => {
      expect(evaluate('exp(0)', {})).toBe(1);
    });

    it('evaluates ln', () => {
      expect(evaluate('ln(1)', {})).toBe(0);
    });

    it('evaluates log10', () => {
      expect(evaluate('log10(100)', {})).toBe(2);
    });

    it('evaluates sign', () => {
      expect(evaluate('sign(-5)', {})).toBe(-1);
    });
  });

  describe('built-in functions — rounding & range', () => {
    it('evaluates round', () => {
      expect(evaluate('round(3.7)', {})).toBe(4);
    });

    it('evaluates round with decimals', () => {
      expect(evaluate('round(3.14159, 2)', {})).toBeCloseTo(3.14);
    });

    it('evaluates floor', () => {
      expect(evaluate('floor(3.7)', {})).toBe(3);
    });

    it('evaluates ceil', () => {
      expect(evaluate('ceil(3.2)', {})).toBe(4);
    });

    it('evaluates min', () => {
      expect(evaluate('min(5, 3, 8)', {})).toBe(3);
    });

    it('evaluates max', () => {
      expect(evaluate('max(5, 3, 8)', {})).toBe(8);
    });

    it('evaluates clamp', () => {
      expect(evaluate('clamp(15, 0, 10)', {})).toBe(10);
    });

    it('evaluates lerp', () => {
      expect(evaluate('lerp(0, 100, 0.5)', {})).toBe(50);
    });

    it('evaluates map', () => {
      expect(evaluate('map(5, 0, 10, 0, 100)', {})).toBe(50);
    });
  });

  describe('built-in functions — conditional', () => {
    it('evaluates if(true)', () => {
      expect(evaluate('if(true, 10, 20)', {})).toBe(10);
    });

    it('evaluates if(false)', () => {
      expect(evaluate('if(false, 10, 20)', {})).toBe(20);
    });

    it('evaluates if with comparison', () => {
      expect(evaluate('if(height > 200, 12, 8)', { height: 300 })).toBe(12);
    });

    it('evaluates select', () => {
      expect(evaluate('select(1, 10, 20, 30)', {})).toBe(20);
    });
  });

  describe('constants', () => {
    it('evaluates PI', () => {
      expect(evaluate('PI', {})).toBeCloseTo(3.14159265);
    });

    it('evaluates TAU', () => {
      expect(evaluate('TAU', {})).toBeCloseTo(6.28318530);
    });

    it('evaluates E', () => {
      expect(evaluate('E', {})).toBeCloseTo(2.71828182);
    });

    it('evaluates SQRT2', () => {
      expect(evaluate('SQRT2', {})).toBeCloseTo(1.41421356);
    });
  });

  describe('spec formulas', () => {
    const ctx = { height: 300, flangeWidth: 150, flangeThickness: 14, webThickness: 8, thickness: 20 };

    it('evaluates: height * 0.5', () => {
      expect(evaluate('height * 0.5', ctx)).toBe(150);
    });

    it('evaluates: max(8, height / 40)', () => {
      expect(evaluate('max(8, height / 40)', ctx)).toBe(8);
    });

    it('evaluates: if(height > 200, 12, 8)', () => {
      expect(evaluate('if(height > 200, 12, 8)', ctx)).toBe(12);
    });

    it('evaluates: clamp(thickness * 0.3, 3, 15)', () => {
      expect(evaluate('clamp(thickness * 0.3, 3, 15)', ctx)).toBe(6);
    });

    it('evaluates: 2 * flangeWidth * flangeThickness + (height - 2 * flangeThickness) * webThickness', () => {
      const result = evaluate(
        '2 * flangeWidth * flangeThickness + (height - 2 * flangeThickness) * webThickness',
        ctx
      );
      expect(result).toBe(2 * 150 * 14 + (300 - 2 * 14) * 8);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/constraints/__tests__/FormulaEvaluator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the evaluator**

```typescript
// src/engine/constraints/FormulaEvaluator.ts
import type { ASTNode, ParameterUnit } from '../../types/constraints';
import { parse } from './FormulaParser';

export class EvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationError';
  }
}

type EvalContext = Record<string, number | boolean | string>;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const UNIT_TO_MM: Record<string, number> = {
  mm: 1,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

const UNIT_TO_DEG: Record<string, number> = {
  deg: 1,
  rad: RAD_TO_DEG,
};

function convertUnit(value: number, unit: ParameterUnit): number {
  if (unit in UNIT_TO_MM) return value * UNIT_TO_MM[unit];
  if (unit in UNIT_TO_DEG) return value * UNIT_TO_DEG[unit];
  return value;
}

const CONSTANTS: Record<string, number> = {
  PI: Math.PI,
  TAU: 2 * Math.PI,
  E: Math.E,
  SQRT2: Math.SQRT2,
};

const FUNCTIONS: Record<string, (...args: number[]) => number | boolean> = {
  // Trigonometry (input in degrees)
  sin: (x) => Math.sin(x * DEG_TO_RAD),
  cos: (x) => Math.cos(x * DEG_TO_RAD),
  tan: (x) => Math.tan(x * DEG_TO_RAD),
  asin: (x) => Math.asin(x) * RAD_TO_DEG,
  acos: (x) => Math.acos(x) * RAD_TO_DEG,
  atan: (x) => Math.atan(x) * RAD_TO_DEG,
  atan2: (y, x) => Math.atan2(y, x) * RAD_TO_DEG,

  // Math
  sqrt: Math.sqrt,
  pow: Math.pow,
  exp: Math.exp,
  ln: Math.log,
  log10: Math.log10,
  abs: Math.abs,
  sign: Math.sign,

  // Rounding & range
  round: (x, d?: number) => {
    if (d === undefined) return Math.round(x);
    const f = 10 ** d;
    return Math.round(x * f) / f;
  },
  floor: Math.floor,
  ceil: Math.ceil,
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
  lerp: (a, b, t) => a + (b - a) * t,
  map: (x, inMin, inMax, outMin, outMax) =>
    outMin + ((x - inMin) / (inMax - inMin)) * (outMax - outMin),

  // Conditional
  select: (index, ...values) => values[Math.round(index)] ?? values[values.length - 1],
};

function evalNode(node: ASTNode, ctx: EvalContext): number | boolean | string {
  switch (node.kind) {
    case 'number': {
      const val = node.value;
      return node.unit ? convertUnit(val, node.unit) : val;
    }

    case 'boolean':
      return node.value;

    case 'string':
      return node.value;

    case 'identifier': {
      if (node.name in CONSTANTS) return CONSTANTS[node.name];
      if (node.name in ctx) return ctx[node.name];
      throw new EvaluationError(`Undefined variable: ${node.name}`);
    }

    case 'crossref':
      throw new EvaluationError(
        `Cross-reference @${node.objectName}.${node.paramName} must be resolved before evaluation`
      );

    case 'unary': {
      const operand = evalNode(node.operand, ctx);
      if (node.operator === '-') return -(operand as number);
      if (node.operator === '!') return !operand;
      throw new EvaluationError(`Unknown unary operator: ${node.operator}`);
    }

    case 'binary': {
      const left = evalNode(node.left, ctx);
      const right = evalNode(node.right, ctx);
      const l = left as number;
      const r = right as number;

      switch (node.operator) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': {
          if (r === 0) throw new EvaluationError('Division by zero');
          return l / r;
        }
        case '%': return l % r;
        case '**': return l ** r;
        case '==': return left === right;
        case '!=': return left !== right;
        case '<': return l < r;
        case '>': return l > r;
        case '<=': return l <= r;
        case '>=': return l >= r;
        case '&&': return !!(left && right);
        case '||': return !!(left || right);
        default: throw new EvaluationError(`Unknown operator: ${node.operator}`);
      }
    }

    case 'call': {
      const name = node.name;

      // Special handling for 'if' — it's not a regular function (short-circuit)
      if (name === 'if') {
        if (node.args.length !== 3) throw new EvaluationError('if() requires 3 arguments');
        const condition = evalNode(node.args[0], ctx);
        return condition ? evalNode(node.args[1], ctx) : evalNode(node.args[2], ctx);
      }

      const fn = FUNCTIONS[name];
      if (!fn) throw new EvaluationError(`Unknown function: ${name}`);

      const args = node.args.map(a => evalNode(a, ctx) as number);
      return fn(...args);
    }

    case 'conditional': {
      const cond = evalNode(node.condition, ctx);
      return cond ? evalNode(node.consequent, ctx) : evalNode(node.alternate, ctx);
    }

    default:
      throw new EvaluationError(`Unknown AST node kind: ${(node as any).kind}`);
  }
}

export function evaluate(
  input: string,
  context: EvalContext,
): number | boolean | string {
  const ast = parse(input);
  return evalNode(ast, context);
}

export function evaluateAST(
  ast: ASTNode,
  context: EvalContext,
): number | boolean | string {
  return evalNode(ast, context);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/constraints/__tests__/FormulaEvaluator.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/constraints/FormulaEvaluator.ts src/engine/constraints/__tests__/FormulaEvaluator.test.ts
git commit -m "feat(constraints): add formula evaluator with trig, units, and built-in functions"
```

---

## Task 5: Constraint Graph (DAG)

**Files:**
- Create: `src/engine/constraints/__tests__/ConstraintGraph.test.ts`
- Create: `src/engine/constraints/ConstraintGraph.ts`

- [ ] **Step 1: Write failing graph tests**

```typescript
// src/engine/constraints/__tests__/ConstraintGraph.test.ts
import { describe, it, expect } from 'vitest';
import { ConstraintGraphEngine, CycleError } from '../ConstraintGraph';

describe('ConstraintGraphEngine', () => {
  describe('addNode', () => {
    it('adds a node', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('p1', 'shape1', [], undefined);
      expect(g.getNode('p1')).toBeDefined();
      expect(g.getNode('p1')!.ownerId).toBe('shape1');
    });
  });

  describe('removeNode', () => {
    it('removes a node', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('p1', 'shape1', [], undefined);
      g.removeNode('p1');
      expect(g.getNode('p1')).toBeUndefined();
    });

    it('cleans up references from dependents', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('p1', 's1', [], undefined);
      g.addNode('p2', 's1', ['p1'], 'p1 * 2');
      g.removeNode('p1');
      expect(g.getNode('p2')!.error).toBeDefined();
    });
  });

  describe('setFormula', () => {
    it('sets formula and updates dependencies', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('height', 's1', [], undefined);
      g.addNode('width', 's1', [], undefined);
      g.setFormula('width', 'height * 0.5', ['height']);
      expect(g.getNode('width')!.dependencies).toEqual(['height']);
    });

    it('clears formula', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('height', 's1', [], undefined);
      g.addNode('width', 's1', ['height'], 'height * 0.5');
      g.setFormula('width', undefined, []);
      expect(g.getNode('width')!.formula).toBeUndefined();
      expect(g.getNode('width')!.dependencies).toEqual([]);
    });
  });

  describe('cycle detection', () => {
    it('detects direct cycle (A -> B -> A)', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('a', 's1', [], undefined);
      g.addNode('b', 's1', ['a'], 'a * 2');
      expect(() => g.setFormula('a', 'b + 1', ['b'])).toThrow(CycleError);
    });

    it('detects indirect cycle (A -> B -> C -> A)', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('a', 's1', [], undefined);
      g.addNode('b', 's1', ['a'], 'a * 2');
      g.addNode('c', 's1', ['b'], 'b + 1');
      expect(() => g.setFormula('a', 'c * 3', ['c'])).toThrow(CycleError);
    });

    it('includes cycle path in error', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('a', 's1', [], undefined);
      g.addNode('b', 's1', ['a'], 'a');
      try {
        g.setFormula('a', 'b', ['b']);
      } catch (e) {
        expect((e as CycleError).cyclePath).toContain('a');
        expect((e as CycleError).cyclePath).toContain('b');
      }
    });

    it('allows valid dependency chain', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('a', 's1', [], undefined);
      g.addNode('b', 's1', ['a'], 'a * 2');
      g.addNode('c', 's1', ['b'], 'b + 1');
      // Should not throw
      expect(g.getNode('c')!.dependencies).toEqual(['b']);
    });
  });

  describe('topological sort', () => {
    it('returns nodes in dependency order', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('a', 's1', [], undefined);
      g.addNode('b', 's1', ['a'], 'a * 2');
      g.addNode('c', 's1', ['b'], 'b + 1');
      const order = g.getSolveOrder();
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    });

    it('caches solve order', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('a', 's1', [], undefined);
      g.addNode('b', 's1', ['a'], 'a');
      const order1 = g.getSolveOrder();
      const order2 = g.getSolveOrder();
      expect(order1).toBe(order2); // same reference = cached
    });

    it('invalidates cache on structure change', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('a', 's1', [], undefined);
      g.addNode('b', 's1', [], undefined);
      const order1 = g.getSolveOrder();
      g.setFormula('b', 'a', ['a']);
      const order2 = g.getSolveOrder();
      expect(order1).not.toBe(order2);
    });
  });

  describe('dirty propagation', () => {
    it('marks downstream nodes as dirty', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('a', 's1', [], undefined);
      g.addNode('b', 's1', ['a'], 'a * 2');
      g.addNode('c', 's1', ['b'], 'b + 1');
      g.clearAllDirty();
      g.markDirty('a');
      expect(g.getNode('a')!.isDirty).toBe(true);
      expect(g.getNode('b')!.isDirty).toBe(true);
      expect(g.getNode('c')!.isDirty).toBe(true);
    });

    it('does not mark unrelated nodes as dirty', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('a', 's1', [], undefined);
      g.addNode('b', 's1', ['a'], 'a * 2');
      g.addNode('x', 's2', [], undefined);
      g.clearAllDirty();
      g.markDirty('a');
      expect(g.getNode('x')!.isDirty).toBe(false);
    });

    it('returns dirty nodes in solve order', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('a', 's1', [], undefined);
      g.addNode('b', 's1', ['a'], 'a');
      g.addNode('c', 's1', ['b'], 'b');
      g.addNode('x', 's2', [], undefined);
      g.clearAllDirty();
      g.markDirty('a');
      const dirty = g.getDirtySolveOrder();
      expect(dirty).toContain('a');
      expect(dirty).toContain('b');
      expect(dirty).toContain('c');
      expect(dirty).not.toContain('x');
    });
  });

  describe('getNodesByOwner', () => {
    it('returns all nodes for a shape', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('p1', 'shape1', [], undefined);
      g.addNode('p2', 'shape1', [], undefined);
      g.addNode('p3', 'shape2', [], undefined);
      const nodes = g.getNodesByOwner('shape1');
      expect(nodes.map(n => n.parameterId)).toEqual(['p1', 'p2']);
    });
  });

  describe('removeNodesByOwner', () => {
    it('removes all nodes for a shape', () => {
      const g = new ConstraintGraphEngine();
      g.addNode('p1', 'shape1', [], undefined);
      g.addNode('p2', 'shape1', [], undefined);
      g.addNode('p3', 'shape2', [], undefined);
      g.removeNodesByOwner('shape1');
      expect(g.getNode('p1')).toBeUndefined();
      expect(g.getNode('p2')).toBeUndefined();
      expect(g.getNode('p3')).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/constraints/__tests__/ConstraintGraph.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the constraint graph**

```typescript
// src/engine/constraints/ConstraintGraph.ts
import type { ConstraintNode } from '../../types/constraints';

export class CycleError extends Error {
  constructor(message: string, public cyclePath: string[]) {
    super(message);
    this.name = 'CycleError';
  }
}

export class ConstraintGraphEngine {
  private nodes: Map<string, ConstraintNode> = new Map();
  private reverseEdges: Map<string, Set<string>> = new Map(); // paramId → set of dependents
  private cachedSolveOrder: string[] | null = null;

  addNode(parameterId: string, ownerId: string, dependencies: string[], formula: string | undefined): void {
    this.nodes.set(parameterId, {
      parameterId,
      ownerId,
      dependencies: [...dependencies],
      formula,
      isDirty: true,
      error: undefined,
    });

    for (const dep of dependencies) {
      if (!this.reverseEdges.has(dep)) this.reverseEdges.set(dep, new Set());
      this.reverseEdges.get(dep)!.add(parameterId);
    }

    this.cachedSolveOrder = null;
  }

  removeNode(parameterId: string): void {
    const node = this.nodes.get(parameterId);
    if (!node) return;

    // Remove from reverse edges of its dependencies
    for (const dep of node.dependencies) {
      this.reverseEdges.get(dep)?.delete(parameterId);
    }

    // Mark dependents as error (broken reference)
    const dependents = this.reverseEdges.get(parameterId);
    if (dependents) {
      for (const depId of dependents) {
        const depNode = this.nodes.get(depId);
        if (depNode) {
          depNode.error = {
            type: 'reference',
            message: `Referenced parameter '${parameterId}' was removed`,
          };
        }
      }
      this.reverseEdges.delete(parameterId);
    }

    this.nodes.delete(parameterId);
    this.cachedSolveOrder = null;
  }

  removeNodesByOwner(ownerId: string): void {
    const toRemove: string[] = [];
    for (const [id, node] of this.nodes) {
      if (node.ownerId === ownerId) toRemove.push(id);
    }
    for (const id of toRemove) {
      this.removeNode(id);
    }
  }

  getNode(parameterId: string): ConstraintNode | undefined {
    return this.nodes.get(parameterId);
  }

  getNodesByOwner(ownerId: string): ConstraintNode[] {
    const result: ConstraintNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.ownerId === ownerId) result.push(node);
    }
    return result;
  }

  setFormula(parameterId: string, formula: string | undefined, dependencies: string[]): void {
    const node = this.nodes.get(parameterId);
    if (!node) throw new Error(`Node not found: ${parameterId}`);

    // Check for cycles before committing
    if (dependencies.length > 0) {
      this.detectCycle(parameterId, dependencies);
    }

    // Remove old reverse edges
    for (const dep of node.dependencies) {
      this.reverseEdges.get(dep)?.delete(parameterId);
    }

    // Update node
    node.formula = formula;
    node.dependencies = [...dependencies];
    node.error = undefined;

    // Add new reverse edges
    for (const dep of dependencies) {
      if (!this.reverseEdges.has(dep)) this.reverseEdges.set(dep, new Set());
      this.reverseEdges.get(dep)!.add(parameterId);
    }

    this.cachedSolveOrder = null;
    this.markDirty(parameterId);
  }

  private detectCycle(fromId: string, newDependencies: string[]): void {
    // DFS from each new dependency to see if we can reach fromId
    const visited = new Set<string>();
    const path: string[] = [];

    const dfs = (current: string): boolean => {
      if (current === fromId) {
        path.push(current);
        return true; // cycle found
      }
      if (visited.has(current)) return false;
      visited.add(current);
      path.push(current);

      const node = this.nodes.get(current);
      if (node) {
        for (const dep of node.dependencies) {
          if (dfs(dep)) return true;
        }
      }

      path.pop();
      return false;
    };

    for (const dep of newDependencies) {
      visited.clear();
      path.length = 0;
      if (dfs(dep)) {
        const cyclePath = [...path, fromId];
        throw new CycleError(
          `Circular dependency detected: ${cyclePath.join(' -> ')}`,
          cyclePath,
        );
      }
    }
  }

  getSolveOrder(): string[] {
    if (this.cachedSolveOrder) return this.cachedSolveOrder;

    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) return; // cycle — should not happen if detectCycle works
      visiting.add(id);

      const node = this.nodes.get(id);
      if (node) {
        for (const dep of node.dependencies) {
          visit(dep);
        }
      }

      visiting.delete(id);
      visited.add(id);
      sorted.push(id);
    };

    for (const id of this.nodes.keys()) {
      visit(id);
    }

    this.cachedSolveOrder = sorted;
    return this.cachedSolveOrder;
  }

  markDirty(parameterId: string): void {
    const node = this.nodes.get(parameterId);
    if (!node) return;
    node.isDirty = true;

    // Propagate to dependents
    const dependents = this.reverseEdges.get(parameterId);
    if (dependents) {
      for (const depId of dependents) {
        const depNode = this.nodes.get(depId);
        if (depNode && !depNode.isDirty) {
          this.markDirty(depId);
        }
      }
    }
  }

  clearAllDirty(): void {
    for (const node of this.nodes.values()) {
      node.isDirty = false;
    }
  }

  getDirtySolveOrder(): string[] {
    const order = this.getSolveOrder();
    return order.filter(id => this.nodes.get(id)?.isDirty);
  }

  serialize(): Record<string, ConstraintNode> {
    const result: Record<string, ConstraintNode> = {};
    for (const [id, node] of this.nodes) {
      result[id] = { ...node };
    }
    return result;
  }

  static deserialize(data: Record<string, ConstraintNode>): ConstraintGraphEngine {
    const g = new ConstraintGraphEngine();
    for (const [id, node] of Object.entries(data)) {
      g.addNode(id, node.ownerId, node.dependencies, node.formula);
      const n = g.getNode(id)!;
      n.isDirty = node.isDirty;
      n.error = node.error;
    }
    return g;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/constraints/__tests__/ConstraintGraph.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/constraints/ConstraintGraph.ts src/engine/constraints/__tests__/ConstraintGraph.test.ts
git commit -m "feat(constraints): add constraint graph with cycle detection and topological sort"
```

---

## Task 6: Reference Resolver

**Files:**
- Create: `src/engine/constraints/__tests__/ReferenceResolver.test.ts`
- Create: `src/engine/constraints/ReferenceResolver.ts`

- [ ] **Step 1: Write failing reference resolver tests**

```typescript
// src/engine/constraints/__tests__/ReferenceResolver.test.ts
import { describe, it, expect } from 'vitest';
import { ReferenceResolver, ReferenceError } from '../ReferenceResolver';
import type { Parameter } from '../../../types/constraints';

function makeParam(id: string, name: string, value: number): Parameter {
  return { id, name, value, unit: 'mm', type: 'number' };
}

describe('ReferenceResolver', () => {
  describe('resolveLocalParam', () => {
    it('resolves a local parameter by name', () => {
      const resolver = new ReferenceResolver();
      const params = [makeParam('s1_height', 'height', 300)];
      resolver.registerShape('s1', 'MyBeam', params);
      expect(resolver.resolveLocal('s1', 'height')).toBe('s1_height');
    });

    it('throws on unknown local param', () => {
      const resolver = new ReferenceResolver();
      resolver.registerShape('s1', 'MyBeam', []);
      expect(() => resolver.resolveLocal('s1', 'unknown')).toThrow(ReferenceError);
    });
  });

  describe('resolveCrossRef', () => {
    it('resolves @ObjectName.param', () => {
      const resolver = new ReferenceResolver();
      const params = [makeParam('s1_width', 'width', 400)];
      resolver.registerShape('s1', 'Kolom1', params);
      expect(resolver.resolveCrossRef('Kolom1', 'width')).toBe('s1_width');
    });

    it('throws on unknown object name', () => {
      const resolver = new ReferenceResolver();
      expect(() => resolver.resolveCrossRef('Unknown', 'width')).toThrow(ReferenceError);
    });

    it('throws on unknown param of known object', () => {
      const resolver = new ReferenceResolver();
      resolver.registerShape('s1', 'Kolom1', [makeParam('s1_w', 'width', 400)]);
      expect(() => resolver.resolveCrossRef('Kolom1', 'unknown')).toThrow(ReferenceError);
    });
  });

  describe('resolveGlobal', () => {
    it('resolves @global.param', () => {
      const resolver = new ReferenceResolver();
      resolver.registerGlobal(makeParam('g_vh', 'verdiepingshoogte', 3200));
      expect(resolver.resolveGlobal('verdiepingshoogte')).toBe('g_vh');
    });

    it('throws on unknown global param', () => {
      const resolver = new ReferenceResolver();
      expect(() => resolver.resolveGlobal('unknown')).toThrow(ReferenceError);
    });
  });

  describe('extractDependencies', () => {
    it('extracts local identifiers', () => {
      const resolver = new ReferenceResolver();
      const params = [
        makeParam('s1_h', 'height', 300),
        makeParam('s1_w', 'width', 150),
      ];
      resolver.registerShape('s1', 'Beam1', params);
      const deps = resolver.extractDependencies('height * 0.5', 's1');
      expect(deps).toEqual(['s1_h']);
    });

    it('extracts cross-object references', () => {
      const resolver = new ReferenceResolver();
      resolver.registerShape('s1', 'Beam1', [makeParam('s1_h', 'height', 300)]);
      resolver.registerShape('s2', 'Kolom1', [makeParam('s2_w', 'width', 400)]);
      const deps = resolver.extractDependencies('@Kolom1.width / 2', 's1');
      expect(deps).toEqual(['s2_w']);
    });

    it('extracts global references', () => {
      const resolver = new ReferenceResolver();
      resolver.registerShape('s1', 'Beam1', [makeParam('s1_h', 'height', 300)]);
      resolver.registerGlobal(makeParam('g_vh', 'verdiepingshoogte', 3200));
      const deps = resolver.extractDependencies('@global.verdiepingshoogte - 50', 's1');
      expect(deps).toEqual(['g_vh']);
    });

    it('extracts mixed dependencies', () => {
      const resolver = new ReferenceResolver();
      resolver.registerShape('s1', 'Beam1', [makeParam('s1_h', 'height', 300)]);
      resolver.registerShape('s2', 'Kolom1', [makeParam('s2_w', 'width', 400)]);
      resolver.registerGlobal(makeParam('g_vh', 'verdiepingshoogte', 3200));
      const deps = resolver.extractDependencies('height + @Kolom1.width + @global.verdiepingshoogte', 's1');
      expect(deps).toContain('s1_h');
      expect(deps).toContain('s2_w');
      expect(deps).toContain('g_vh');
    });
  });

  describe('unregisterShape', () => {
    it('removes shape from registry', () => {
      const resolver = new ReferenceResolver();
      resolver.registerShape('s1', 'Beam1', [makeParam('s1_h', 'height', 300)]);
      resolver.unregisterShape('s1');
      expect(() => resolver.resolveCrossRef('Beam1', 'height')).toThrow(ReferenceError);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/constraints/__tests__/ReferenceResolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the reference resolver**

```typescript
// src/engine/constraints/ReferenceResolver.ts
import type { ASTNode, Parameter } from '../../types/constraints';
import { parse } from './FormulaParser';

export class ReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceError';
  }
}

interface ShapeEntry {
  shapeId: string;
  objectName: string;
  paramsByName: Map<string, string>; // paramName → parameterId
}

export class ReferenceResolver {
  private shapesByName: Map<string, ShapeEntry> = new Map(); // objectName → ShapeEntry
  private shapesById: Map<string, ShapeEntry> = new Map();   // shapeId → ShapeEntry
  private globalParams: Map<string, string> = new Map();      // paramName → parameterId

  registerShape(shapeId: string, objectName: string, parameters: Parameter[]): void {
    const paramsByName = new Map<string, string>();
    for (const p of parameters) {
      paramsByName.set(p.name, p.id);
    }
    const entry: ShapeEntry = { shapeId, objectName, paramsByName };
    this.shapesByName.set(objectName, entry);
    this.shapesById.set(shapeId, entry);
  }

  unregisterShape(shapeId: string): void {
    const entry = this.shapesById.get(shapeId);
    if (entry) {
      this.shapesByName.delete(entry.objectName);
      this.shapesById.delete(shapeId);
    }
  }

  registerGlobal(param: Parameter): void {
    this.globalParams.set(param.name, param.id);
  }

  unregisterGlobal(paramName: string): void {
    this.globalParams.delete(paramName);
  }

  resolveLocal(shapeId: string, paramName: string): string {
    const entry = this.shapesById.get(shapeId);
    if (!entry) throw new ReferenceError(`Shape not found: ${shapeId}`);
    const paramId = entry.paramsByName.get(paramName);
    if (!paramId) throw new ReferenceError(`Parameter '${paramName}' not found on shape '${entry.objectName}'`);
    return paramId;
  }

  resolveCrossRef(objectName: string, paramName: string): string {
    if (objectName === 'global') return this.resolveGlobal(paramName);
    const entry = this.shapesByName.get(objectName);
    if (!entry) throw new ReferenceError(`Object not found: @${objectName}`);
    const paramId = entry.paramsByName.get(paramName);
    if (!paramId) throw new ReferenceError(`Parameter '${paramName}' not found on @${objectName}`);
    return paramId;
  }

  resolveGlobal(paramName: string): string {
    const paramId = this.globalParams.get(paramName);
    if (!paramId) throw new ReferenceError(`Global parameter not found: @global.${paramName}`);
    return paramId;
  }

  extractDependencies(formula: string, ownerShapeId: string): string[] {
    const ast = parse(formula);
    const deps: string[] = [];
    this.walkAST(ast, ownerShapeId, deps);
    return [...new Set(deps)]; // deduplicate
  }

  private walkAST(node: ASTNode, ownerShapeId: string, deps: string[]): void {
    switch (node.kind) {
      case 'identifier': {
        // Skip constants and built-in function names
        const constants = new Set(['PI', 'TAU', 'E', 'SQRT2', 'true', 'false']);
        if (constants.has(node.name)) return;
        try {
          deps.push(this.resolveLocal(ownerShapeId, node.name));
        } catch {
          // Unknown identifier — will be caught during evaluation
        }
        break;
      }
      case 'crossref':
        try {
          deps.push(this.resolveCrossRef(node.objectName, node.paramName));
        } catch {
          // Unknown reference — will be caught during evaluation
        }
        break;
      case 'binary':
        this.walkAST(node.left, ownerShapeId, deps);
        this.walkAST(node.right, ownerShapeId, deps);
        break;
      case 'unary':
        this.walkAST(node.operand, ownerShapeId, deps);
        break;
      case 'call':
        for (const arg of node.args) this.walkAST(arg, ownerShapeId, deps);
        break;
      case 'conditional':
        this.walkAST(node.condition, ownerShapeId, deps);
        this.walkAST(node.consequent, ownerShapeId, deps);
        this.walkAST(node.alternate, ownerShapeId, deps);
        break;
      // number, boolean, string — no dependencies
    }
  }

  buildEvalContext(
    ownerShapeId: string,
    paramValues: Map<string, number | boolean | string>,
  ): Record<string, number | boolean | string> {
    const ctx: Record<string, number | boolean | string> = {};
    const entry = this.shapesById.get(ownerShapeId);
    if (entry) {
      for (const [name, paramId] of entry.paramsByName) {
        const val = paramValues.get(paramId);
        if (val !== undefined) ctx[name] = val;
      }
    }
    // Add globals
    for (const [name, paramId] of this.globalParams) {
      const val = paramValues.get(paramId);
      if (val !== undefined) ctx[`@global.${name}`] = val;
    }
    return ctx;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/constraints/__tests__/ReferenceResolver.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/constraints/ReferenceResolver.ts src/engine/constraints/__tests__/ReferenceResolver.test.ts
git commit -m "feat(constraints): add reference resolver for local, cross-object, and global params"
```

---

## Task 7: Constraint Solver

**Files:**
- Create: `src/engine/constraints/__tests__/ConstraintSolver.test.ts`
- Create: `src/engine/constraints/ConstraintSolver.ts`

- [ ] **Step 1: Write failing solver tests**

```typescript
// src/engine/constraints/__tests__/ConstraintSolver.test.ts
import { describe, it, expect } from 'vitest';
import { ConstraintSolver } from '../ConstraintSolver';
import type { Parameter } from '../../../types/constraints';

function makeParam(id: string, name: string, value: number, formula?: string): Parameter {
  return { id, name, value, unit: 'mm', type: 'number', formula };
}

describe('ConstraintSolver', () => {
  describe('solve — simple chain', () => {
    it('evaluates dependent parameters in order', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Beam1', [
        makeParam('s1_h', 'height', 300),
        makeParam('s1_w', 'flangeWidth', 0, 'height * 0.5'),
        makeParam('s1_tw', 'webThick', 0, 'max(8, height / 40)'),
      ]);
      solver.solve();
      expect(solver.getValue('s1_w')).toBe(150);
      expect(solver.getValue('s1_tw')).toBe(8);
    });
  });

  describe('solve — cross-object reference', () => {
    it('resolves @Object.param across shapes', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Kolom1', [
        makeParam('s1_w', 'width', 400),
      ]);
      solver.addShape('s2', 'Beam1', [
        makeParam('s2_offset', 'offset', 0, '@Kolom1.width / 2'),
      ]);
      solver.solve();
      expect(solver.getValue('s2_offset')).toBe(200);
    });
  });

  describe('solve — global parameters', () => {
    it('resolves @global.param', () => {
      const solver = new ConstraintSolver();
      solver.addGlobalParameter(makeParam('g_vh', 'verdiepingshoogte', 3200));
      solver.addShape('s1', 'Beam1', [
        makeParam('s1_h', 'totalHeight', 0, '@global.verdiepingshoogte - 50'),
      ]);
      solver.solve();
      expect(solver.getValue('s1_h')).toBe(3150);
    });
  });

  describe('solve — incremental (dirty tracking)', () => {
    it('only recalculates dirty nodes', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Beam1', [
        makeParam('s1_h', 'height', 300),
        makeParam('s1_w', 'flangeWidth', 0, 'height * 0.5'),
      ]);
      solver.solve();
      expect(solver.getValue('s1_w')).toBe(150);

      // Change height → flangeWidth should update
      solver.setParameterValue('s1_h', 400);
      solver.solve();
      expect(solver.getValue('s1_w')).toBe(200);
    });
  });

  describe('setFormula', () => {
    it('adds a formula to a free parameter', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Beam1', [
        makeParam('s1_h', 'height', 300),
        makeParam('s1_w', 'flangeWidth', 150),
      ]);
      solver.setFormula('s1_w', 'height * 0.5');
      solver.solve();
      expect(solver.getValue('s1_w')).toBe(150);
    });

    it('rejects circular formula', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Beam1', [
        makeParam('s1_a', 'a', 0, 'b'),
        makeParam('s1_b', 'b', 10),
      ]);
      solver.solve();
      expect(() => solver.setFormula('s1_b', 'a')).toThrow();
    });
  });

  describe('removeShape', () => {
    it('removes shape and marks broken refs', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Kolom1', [makeParam('s1_w', 'width', 400)]);
      solver.addShape('s2', 'Beam1', [makeParam('s2_o', 'offset', 0, '@Kolom1.width / 2')]);
      solver.solve();
      expect(solver.getValue('s2_o')).toBe(200);

      solver.removeShape('s1');
      expect(solver.getError('s2_o')).toBeDefined();
    });
  });

  describe('validation', () => {
    it('clamps to min/max', () => {
      const solver = new ConstraintSolver();
      const p = makeParam('s1_h', 'height', 0, '5000');
      p.min = 10;
      p.max = 1000;
      solver.addShape('s1', 'Beam1', [p]);
      solver.solve();
      expect(solver.getValue('s1_h')).toBe(1000);
    });
  });

  describe('getChangedShapeIds', () => {
    it('returns only shapes with changed values after solve', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Beam1', [
        makeParam('s1_h', 'height', 300),
        makeParam('s1_w', 'flangeWidth', 0, 'height * 0.5'),
      ]);
      solver.addShape('s2', 'Kolom1', [makeParam('s2_w', 'width', 400)]);
      solver.solve();

      solver.setParameterValue('s1_h', 400);
      const changed = solver.solve();
      expect(changed).toContain('s1');
      expect(changed).not.toContain('s2');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/constraints/__tests__/ConstraintSolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the constraint solver**

```typescript
// src/engine/constraints/ConstraintSolver.ts
import type { Parameter, ConstraintError } from '../../types/constraints';
import { ConstraintGraphEngine, CycleError } from './ConstraintGraph';
import { ReferenceResolver, ReferenceError as RefError } from './ReferenceResolver';
import { evaluate } from './FormulaEvaluator';

export class ConstraintSolver {
  private graph = new ConstraintGraphEngine();
  private resolver = new ReferenceResolver();
  private parameters: Map<string, Parameter> = new Map();
  private previousValues: Map<string, number | boolean | string> = new Map();

  addShape(shapeId: string, objectName: string, params: Parameter[]): void {
    this.resolver.registerShape(shapeId, objectName, params);
    for (const p of params) {
      this.parameters.set(p.id, { ...p });
      const deps = p.formula ? this.resolver.extractDependencies(p.formula, shapeId) : [];
      this.graph.addNode(p.id, shapeId, deps, p.formula);
    }
  }

  removeShape(shapeId: string): void {
    this.graph.removeNodesByOwner(shapeId);
    // Remove parameters owned by this shape
    for (const [id, param] of this.parameters) {
      if (this.graph.getNode(id) === undefined) {
        // Node was removed — check if other nodes referenced it
        this.parameters.delete(id);
      }
    }
    this.resolver.unregisterShape(shapeId);
  }

  addGlobalParameter(param: Parameter): void {
    this.parameters.set(param.id, { ...param });
    this.resolver.registerGlobal(param);
    this.graph.addNode(param.id, '__global__', [], param.formula);
  }

  setParameterValue(paramId: string, value: number | boolean | string): void {
    const param = this.parameters.get(paramId);
    if (!param) throw new Error(`Parameter not found: ${paramId}`);
    param.value = value;
    this.graph.markDirty(paramId);
  }

  setFormula(paramId: string, formula: string): void {
    const param = this.parameters.get(paramId);
    if (!param) throw new Error(`Parameter not found: ${paramId}`);

    const node = this.graph.getNode(paramId);
    if (!node) throw new Error(`Graph node not found: ${paramId}`);

    const deps = this.resolver.extractDependencies(formula, node.ownerId);

    // This throws CycleError if circular
    this.graph.setFormula(paramId, formula, deps);
    param.formula = formula;
  }

  getValue(paramId: string): number | boolean | string {
    const param = this.parameters.get(paramId);
    if (!param) throw new Error(`Parameter not found: ${paramId}`);
    return param.value;
  }

  getError(paramId: string): ConstraintError | undefined {
    return this.graph.getNode(paramId)?.error;
  }

  /** Solve all dirty nodes. Returns set of shapeIds whose values changed. */
  solve(): Set<string> {
    // Snapshot previous values
    this.previousValues.clear();
    for (const [id, p] of this.parameters) {
      this.previousValues.set(id, p.value);
    }

    const dirtyOrder = this.graph.getDirtySolveOrder();
    const changedShapeIds = new Set<string>();

    for (const paramId of dirtyOrder) {
      const node = this.graph.getNode(paramId);
      if (!node) continue;

      const param = this.parameters.get(paramId);
      if (!param) continue;

      if (node.formula) {
        try {
          // Build evaluation context: resolve all dependency names to their current values
          const ctx: Record<string, number | boolean | string> = {};

          // Add local params (by name) for the owner shape
          const ownerNodes = this.graph.getNodesByOwner(node.ownerId);
          for (const ownerNode of ownerNodes) {
            const ownerParam = this.parameters.get(ownerNode.parameterId);
            if (ownerParam) ctx[ownerParam.name] = ownerParam.value;
          }

          // Add cross-references: parse formula for @refs and resolve their values
          for (const depId of node.dependencies) {
            const depParam = this.parameters.get(depId);
            if (depParam) {
              const depNode = this.graph.getNode(depId);
              if (depNode && depNode.ownerId !== node.ownerId) {
                // Cross-object: find the object name and add as @Object.param
                // For simplicity, also add by raw name since the evaluator uses local names
                ctx[depParam.name] = depParam.value;
              }
            }
          }

          const result = evaluate(node.formula, ctx);
          let finalValue = result;

          // Validate min/max for numbers
          if (param.type === 'number' || param.type === 'integer') {
            let num = finalValue as number;
            if (param.min !== undefined && num < param.min) num = param.min;
            if (param.max !== undefined && num > param.max) num = param.max;
            if (param.type === 'integer') num = Math.round(num);
            finalValue = num;
          }

          param.value = finalValue;
          node.error = undefined;
        } catch (e) {
          node.error = {
            type: e instanceof RefError ? 'reference' : 'syntax',
            message: (e as Error).message,
          };
        }
      }

      // Check if value actually changed
      if (param.value !== this.previousValues.get(paramId)) {
        changedShapeIds.add(node.ownerId);
      }

      node.isDirty = false;
    }

    return changedShapeIds;
  }

  getGraph(): ConstraintGraphEngine {
    return this.graph;
  }

  getParameter(paramId: string): Parameter | undefined {
    return this.parameters.get(paramId);
  }

  getAllParametersForShape(shapeId: string): Parameter[] {
    const nodes = this.graph.getNodesByOwner(shapeId);
    return nodes.map(n => this.parameters.get(n.parameterId)).filter(Boolean) as Parameter[];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/constraints/__tests__/ConstraintSolver.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/constraints/ConstraintSolver.ts src/engine/constraints/__tests__/ConstraintSolver.test.ts
git commit -m "feat(constraints): add constraint solver with dirty tracking and cross-object refs"
```

---

## Task 8: Constraint State Slice

**Files:**
- Create: `src/state/slices/constraintSlice.ts`
- Modify: `src/types/parametric.ts`

- [ ] **Step 1: Add constraintGraph field to ParametricShape**

Add this to the `BaseParametricShape` interface in `src/types/parametric.ts`:

```typescript
// Add import at top of file:
import type { ShapeConstraintGraph } from './constraints';

// Add to BaseParametricShape interface, after the metadata field:
  constraintGraph?: ShapeConstraintGraph;
```

- [ ] **Step 2: Create the constraint slice**

```typescript
// src/state/slices/constraintSlice.ts
import type { StateCreator } from 'zustand';
import type { Parameter, ConstraintError } from '../../types/constraints';
import { ConstraintSolver } from '../../engine/constraints/ConstraintSolver';

export interface ConstraintState {
  constraintSolver: ConstraintSolver;
  globalParameters: Parameter[];
}

export interface ConstraintActions {
  // Global parameters
  addGlobalParameter: (param: Parameter) => void;
  updateGlobalParameter: (paramId: string, value: number | boolean | string) => void;
  removeGlobalParameter: (paramId: string) => void;

  // Shape constraint management
  registerShapeConstraints: (shapeId: string, objectName: string, params: Parameter[]) => void;
  unregisterShapeConstraints: (shapeId: string) => void;

  // Parameter editing
  setParameterValue: (paramId: string, value: number | boolean | string) => void;
  setParameterFormula: (paramId: string, formula: string) => void;
  clearParameterFormula: (paramId: string) => void;

  // Solve
  solveConstraints: () => Set<string>;

  // Query
  getParameterValue: (paramId: string) => number | boolean | string | undefined;
  getParameterError: (paramId: string) => ConstraintError | undefined;
  getShapeParameters: (shapeId: string) => Parameter[];
}

export type ConstraintSlice = ConstraintState & ConstraintActions;

export const createConstraintSlice: StateCreator<ConstraintSlice, [], [], ConstraintSlice> = (set, get) => ({
  constraintSolver: new ConstraintSolver(),
  globalParameters: [],

  addGlobalParameter: (param) => {
    get().constraintSolver.addGlobalParameter(param);
    set((state) => ({
      globalParameters: [...state.globalParameters, param],
    }));
  },

  updateGlobalParameter: (paramId, value) => {
    get().constraintSolver.setParameterValue(paramId, value);
    set((state) => ({
      globalParameters: state.globalParameters.map(p =>
        p.id === paramId ? { ...p, value } : p
      ),
    }));
  },

  removeGlobalParameter: (paramId) => {
    set((state) => ({
      globalParameters: state.globalParameters.filter(p => p.id !== paramId),
    }));
  },

  registerShapeConstraints: (shapeId, objectName, params) => {
    get().constraintSolver.addShape(shapeId, objectName, params);
  },

  unregisterShapeConstraints: (shapeId) => {
    get().constraintSolver.removeShape(shapeId);
  },

  setParameterValue: (paramId, value) => {
    get().constraintSolver.setParameterValue(paramId, value);
  },

  setParameterFormula: (paramId, formula) => {
    get().constraintSolver.setFormula(paramId, formula);
  },

  clearParameterFormula: (paramId) => {
    const solver = get().constraintSolver;
    const graph = solver.getGraph();
    graph.setFormula(paramId, undefined, []);
  },

  solveConstraints: () => {
    return get().constraintSolver.solve();
  },

  getParameterValue: (paramId) => {
    try {
      return get().constraintSolver.getValue(paramId);
    } catch {
      return undefined;
    }
  },

  getParameterError: (paramId) => {
    return get().constraintSolver.getError(paramId);
  },

  getShapeParameters: (shapeId) => {
    return get().constraintSolver.getAllParametersForShape(shapeId);
  },
});
```

- [ ] **Step 3: Commit**

```bash
git add src/types/parametric.ts src/state/slices/constraintSlice.ts
git commit -m "feat(constraints): add constraint state slice and extend ParametricShape type"
```

---

## Task 9: Constraint Migration Service

**Files:**
- Create: `src/services/parametric/constraintMigration.ts`

- [ ] **Step 1: Implement the migration service**

This service converts existing `ProfileTemplate` + `ParameterValues` into a `ShapeConstraintGraph`.

```typescript
// src/services/parametric/constraintMigration.ts
import type { Parameter, ParametricVertex, ParametricEdge, ShapeConstraintGraph, ConstraintGraph } from '../../types/constraints';
import type { ParameterDefinition, ParameterValues, ProfileType } from '../../types/parametric';
import { PROFILE_TEMPLATES } from './profileTemplates';

let idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}_${++idCounter}`;
}

export function resetIdCounter(): void {
  idCounter = 0;
}

/**
 * Convert a ProfileTemplate's ParameterDefinitions + current values
 * into a ShapeConstraintGraph with free parameters (no formulas).
 * This is the baseline migration — users can then add formulas.
 */
export function migrateProfileToConstraintGraph(
  shapeId: string,
  profileType: ProfileType,
  parameterValues: ParameterValues,
): ShapeConstraintGraph {
  const templateEntry = PROFILE_TEMPLATES.get(profileType);
  if (!templateEntry) {
    throw new Error(`Unknown profile type: ${profileType}`);
  }

  const template = templateEntry.template;
  const parameters: Parameter[] = [];
  const nodes: Record<string, { parameterId: string; ownerId: string; dependencies: string[]; formula?: string; isDirty: boolean }> = {};

  for (const paramDef of template.parameters) {
    const paramId = `${shapeId}_${paramDef.id}`;
    const currentValue = parameterValues[paramDef.id] ?? paramDef.defaultValue;

    const param: Parameter = {
      id: paramId,
      name: paramDef.id,
      value: currentValue,
      unit: (paramDef.unit as Parameter['unit']) || 'mm',
      type: paramDef.type === 'select' ? 'string' : paramDef.type as Parameter['type'],
      min: paramDef.min,
      max: paramDef.max,
      group: paramDef.group,
      isReadOnly: paramDef.readOnly,
      formula: paramDef.formula,
    };

    parameters.push(param);

    nodes[paramId] = {
      parameterId: paramId,
      ownerId: shapeId,
      dependencies: paramDef.dependencies?.map(d => `${shapeId}_${d}`) ?? [],
      formula: paramDef.formula,
      isDirty: true,
    };
  }

  const constraintGraph: ConstraintGraph = {
    nodes,
    solveOrder: [],
    globalParameters: {},
    isDirty: true,
  };

  return {
    parameters,
    vertices: [], // Vertices will be populated when geometry is generated
    edges: [],
    constraintGraph,
  };
}

/**
 * Check if a ParametricShape has been migrated to the constraint system.
 */
export function isMigrated(shape: { constraintGraph?: ShapeConstraintGraph }): boolean {
  return shape.constraintGraph !== undefined && shape.constraintGraph.parameters.length > 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/parametric/constraintMigration.ts
git commit -m "feat(constraints): add migration service for existing profile templates"
```

---

## Task 10: ParameterPanel UI Component

**Files:**
- Create: `src/components/panels/FormulaInput.tsx`
- Create: `src/components/panels/ParameterPanel.tsx`

- [ ] **Step 1: Create FormulaInput component**

```tsx
// src/components/panels/FormulaInput.tsx
import React, { useState, useRef, useEffect } from 'react';

interface FormulaInputProps {
  value: number | boolean | string;
  formula?: string;
  isReadOnly?: boolean;
  hasError?: boolean;
  errorMessage?: string;
  unit?: string;
  onChange: (value: number | string) => void;
  onFormulaChange: (formula: string) => void;
  onFormulaClear: () => void;
}

export const FormulaInput: React.FC<FormulaInputProps> = ({
  value,
  formula,
  isReadOnly,
  hasError,
  errorMessage,
  unit,
  onChange,
  onFormulaChange,
  onFormulaClear,
}) => {
  const [editMode, setEditMode] = useState<'value' | 'formula'>(formula ? 'formula' : 'value');
  const [inputText, setInputText] = useState(formula || String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editMode === 'formula') {
      setInputText(formula || '');
    } else {
      setInputText(String(value));
    }
  }, [value, formula, editMode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (editMode === 'formula') {
        if (inputText.trim() === '') {
          onFormulaClear();
          setEditMode('value');
        } else {
          onFormulaChange(inputText);
        }
      } else {
        const num = parseFloat(inputText);
        if (!isNaN(num)) onChange(num);
      }
      inputRef.current?.blur();
    }
    if (e.key === 'Escape') {
      setInputText(editMode === 'formula' ? (formula || '') : String(value));
      inputRef.current?.blur();
    }
  };

  const handleFocus = () => {
    // If text starts with '=', switch to formula mode
    if (inputText.startsWith('=')) {
      setEditMode('formula');
      setInputText(inputText.slice(1));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    if (text.startsWith('=') && editMode === 'value') {
      setEditMode('formula');
      setInputText(text.slice(1));
      return;
    }
    setInputText(text);
  };

  const toggleMode = () => {
    if (isReadOnly) return;
    if (editMode === 'formula') {
      onFormulaClear();
      setEditMode('value');
      setInputText(String(value));
    } else {
      setEditMode('formula');
      setInputText(formula || '');
    }
  };

  const borderColor = hasError ? '#ef4444' : formula ? '#22c55e' : '#374151';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {!isReadOnly && (
        <button
          onClick={toggleMode}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 14,
            padding: 0,
            opacity: formula ? 1 : 0.4,
          }}
          title={formula ? 'Clear formula' : 'Add formula'}
        >
          {formula ? '\u{1F517}' : '\u{1F517}'}
        </button>
      )}
      {isReadOnly && (
        <span style={{ fontSize: 14, opacity: 0.4 }}>{'\u{1F512}'}</span>
      )}
      <input
        ref={inputRef}
        value={inputText}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        disabled={isReadOnly}
        style={{
          flex: 1,
          background: isReadOnly ? '#1f2937' : '#111827',
          color: isReadOnly ? '#6b7280' : hasError ? '#ef4444' : '#e5e7eb',
          border: `1px solid ${borderColor}`,
          borderRadius: 4,
          padding: '2px 6px',
          fontSize: 13,
          fontFamily: editMode === 'formula' ? 'monospace' : 'inherit',
        }}
        title={errorMessage || (formula ? `Formula: ${formula}` : undefined)}
      />
      {formula && (
        <span style={{ color: '#9ca3af', fontSize: 12, minWidth: 50, textAlign: 'right' }}>
          {typeof value === 'number' ? value.toFixed(1) : String(value)}
          {unit && unit !== 'none' ? unit : ''}
        </span>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Create ParameterPanel component**

```tsx
// src/components/panels/ParameterPanel.tsx
import React, { useMemo } from 'react';
import { FormulaInput } from './FormulaInput';
import type { Parameter, ConstraintError } from '../../types/constraints';

interface ParameterPanelProps {
  parameters: Parameter[];
  errors: Map<string, ConstraintError | undefined>;
  onValueChange: (paramId: string, value: number | boolean | string) => void;
  onFormulaChange: (paramId: string, formula: string) => void;
  onFormulaClear: (paramId: string) => void;
  onAddParameter?: () => void;
}

export const ParameterPanel: React.FC<ParameterPanelProps> = ({
  parameters,
  errors,
  onValueChange,
  onFormulaChange,
  onFormulaClear,
  onAddParameter,
}) => {
  // Group parameters by their group field
  const grouped = useMemo(() => {
    const groups = new Map<string, Parameter[]>();
    for (const param of parameters) {
      const groupName = param.group || 'General';
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName)!.push(param);
    }
    return groups;
  }, [parameters]);

  if (parameters.length === 0) return null;

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{
        padding: '6px 8px',
        fontWeight: 600,
        color: '#d1d5db',
        borderBottom: '1px solid #374151',
      }}>
        Parameters
      </div>

      {Array.from(grouped.entries()).map(([groupName, params]) => (
        <div key={groupName}>
          <div style={{
            padding: '4px 8px',
            fontSize: 11,
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            background: '#0f172a',
          }}>
            {groupName}
          </div>

          {params.map(param => {
            const error = errors.get(param.id);
            return (
              <div key={param.id} style={{
                display: 'flex',
                alignItems: 'center',
                padding: '3px 8px',
                gap: 8,
              }}>
                <span style={{
                  minWidth: 100,
                  color: '#9ca3af',
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {param.name}
                </span>
                <div style={{ flex: 1 }}>
                  <FormulaInput
                    value={param.value}
                    formula={param.formula}
                    isReadOnly={param.isReadOnly}
                    hasError={!!error}
                    errorMessage={error?.message}
                    unit={param.unit !== 'none' ? param.unit : undefined}
                    onChange={(v) => onValueChange(param.id, v)}
                    onFormulaChange={(f) => onFormulaChange(param.id, f)}
                    onFormulaClear={() => onFormulaClear(param.id)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {onAddParameter && (
        <div
          onClick={onAddParameter}
          style={{
            padding: '6px 8px',
            color: '#60a5fa',
            cursor: 'pointer',
            fontSize: 12,
            textAlign: 'center',
            borderTop: '1px solid #1e293b',
          }}
        >
          + Parameter toevoegen
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Commit**

```bash
git add src/components/panels/FormulaInput.tsx src/components/panels/ParameterPanel.tsx
git commit -m "feat(constraints): add ParameterPanel and FormulaInput UI components"
```

---

## Task 11: Constraint Overlay Layer

**Files:**
- Create: `src/engine/renderer/layers/ConstraintLayer.ts`

- [ ] **Step 1: Implement the canvas constraint overlay**

```typescript
// src/engine/renderer/layers/ConstraintLayer.ts
import { BaseRenderer } from '../core/BaseRenderer';
import type { Parameter, ParametricVertex, ParametricEdge, ShapeConstraintGraph } from '../../../types/constraints';

const COLORS = {
  free: '#3b82f6',        // blue — editable
  constrained: '#22c55e', // green — formula
  error: '#ef4444',       // red — error
  locked: '#6b7280',      // gray — readonly
};

export class ConstraintLayer extends BaseRenderer {

  drawConstraintOverlay(
    constraintGraph: ShapeConstraintGraph,
    position: { x: number; y: number },
    rotation: number,
    scale: number,
  ): void {
    const ctx = this.ctx;
    const zoom = this.viewport.zoom;
    const paramMap = new Map(constraintGraph.parameters.map(p => [p.id, p]));

    ctx.save();

    // Draw vertices
    for (const vertex of constraintGraph.vertices) {
      const xParam = paramMap.get(vertex.xParamId);
      const yParam = paramMap.get(vertex.yParamId);
      if (!xParam || !yParam) continue;

      const vx = xParam.value as number;
      const vy = yParam.value as number;

      // Transform to world coords
      const cos = Math.cos((rotation * Math.PI) / 180);
      const sin = Math.sin((rotation * Math.PI) / 180);
      const worldX = position.x + (vx * cos - vy * sin) * scale;
      const worldY = position.y + (vx * sin + vy * cos) * scale;

      const screenPos = this.worldToScreen(worldX, worldY);
      const radius = 4;

      const isFree = !xParam.formula && !yParam.formula;
      const hasError = xParam.isReadOnly || yParam.isReadOnly;

      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = hasError ? COLORS.locked : isFree ? COLORS.free : COLORS.constrained;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw edge dimension labels
    for (const edge of constraintGraph.edges) {
      if (!edge.lengthParamId) continue;
      const lengthParam = paramMap.get(edge.lengthParamId);
      if (!lengthParam) continue;

      const startVertex = constraintGraph.vertices.find(v => v.id === edge.startVertexId);
      const endVertex = constraintGraph.vertices.find(v => v.id === edge.endVertexId);
      if (!startVertex || !endVertex) continue;

      const sx = paramMap.get(startVertex.xParamId)?.value as number;
      const sy = paramMap.get(startVertex.yParamId)?.value as number;
      const ex = paramMap.get(endVertex.xParamId)?.value as number;
      const ey = paramMap.get(endVertex.yParamId)?.value as number;

      if (sx === undefined || sy === undefined || ex === undefined || ey === undefined) continue;

      // Midpoint for label
      const cos = Math.cos((rotation * Math.PI) / 180);
      const sin = Math.sin((rotation * Math.PI) / 180);
      const mx = position.x + (((sx + ex) / 2) * cos - ((sy + ey) / 2) * sin) * scale;
      const my = position.y + (((sx + ex) / 2) * sin + ((sy + ey) / 2) * cos) * scale;

      const screenMid = this.worldToScreen(mx, my);
      const label = `${lengthParam.name}: ${(lengthParam.value as number).toFixed(1)}`;
      const color = lengthParam.formula ? COLORS.constrained : COLORS.free;

      ctx.font = `${Math.max(10, 11 / zoom)}px monospace`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';

      // Background
      const metrics = ctx.measureText(label);
      const padding = 2;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(
        screenMid.x - metrics.width / 2 - padding,
        screenMid.y - 14 - padding,
        metrics.width + padding * 2,
        14 + padding * 2,
      );

      ctx.fillStyle = color;
      ctx.fillText(label, screenMid.x, screenMid.y);
    }

    ctx.restore();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/renderer/layers/ConstraintLayer.ts
git commit -m "feat(constraints): add canvas constraint overlay layer"
```

---

## Task 12: Integration — Wire into ParametricRenderer

**Files:**
- Modify: `src/engine/renderer/core/ParametricRenderer.ts`

- [ ] **Step 1: Add constraint overlay rendering**

At the end of the `drawProfileShape` method, add constraint overlay rendering when a shape has a `constraintGraph`:

```typescript
// Add import at top of ParametricRenderer.ts:
import { ConstraintLayer } from '../layers/ConstraintLayer';

// Add property to ParametricRenderer class:
private constraintLayer: ConstraintLayer | null = null;

// Add method:
setConstraintLayer(layer: ConstraintLayer): void {
  this.constraintLayer = layer;
}

// At the end of drawProfileShape(), before the closing brace, add:
    // Draw constraint overlay if shape has constraint graph and is selected
    if (isSelected && shape.constraintGraph && this.constraintLayer) {
      this.constraintLayer.drawConstraintOverlay(
        shape.constraintGraph,
        shape.position,
        shape.rotation,
        shape.scale,
      );
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/renderer/core/ParametricRenderer.ts
git commit -m "feat(constraints): integrate constraint overlay into ParametricRenderer"
```

---

## Task 13: Integration — Run All Tests

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS (existing + new constraint tests)

- [ ] **Step 2: Run TypeScript compiler check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds (warnings about chunk size are OK)

- [ ] **Step 4: Commit any fixes if needed**

If tests or type checks revealed issues, fix them and commit:

```bash
git add -A
git commit -m "fix(constraints): resolve integration issues from full test suite"
```

---

## Summary

| Task | Component | Estimated Steps |
|---|---|---|
| 1 | Type definitions | 2 |
| 2 | Formula Lexer | 5 |
| 3 | Formula Parser | 5 |
| 4 | Formula Evaluator | 5 |
| 5 | Constraint Graph (DAG) | 5 |
| 6 | Reference Resolver | 5 |
| 7 | Constraint Solver | 5 |
| 8 | Constraint State Slice | 3 |
| 9 | Constraint Migration | 2 |
| 10 | Parameter Panel UI | 3 |
| 11 | Constraint Overlay Layer | 2 |
| 12 | Renderer Integration | 2 |
| 13 | Full Integration Test | 4 |
| **Total** | | **48 steps** |
