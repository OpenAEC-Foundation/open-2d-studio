// Point is imported for future use in parametric geometry implementations (vertex coordinates, etc.)
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

/**
 * Represents a point in parametric space where coordinates (x, y) are
 * defined by parameters rather than fixed values. Point type imported
 * for reference and future geometric calculations.
 */
export type ParametricPoint = Point & { parametric: true };

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
