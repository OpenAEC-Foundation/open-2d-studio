import type { Parameter, ConstraintError, ASTNode } from '../../types/constraints';
import { ConstraintGraphEngine } from './ConstraintGraph';
import { ReferenceResolver } from './ReferenceResolver';
import { evaluateAST } from './FormulaEvaluator';
import { parse } from './FormulaParser';

// ── Cross-reference rewriting ─────────────────────────────────────────────────

/**
 * Generate a context key for a cross-object reference.
 * The format   __xref__<objectName>__<paramName>   is unlikely to collide with
 * user-defined parameter names.
 */
function xrefKey(objectName: string, paramName: string): string {
  return `__xref__${objectName}__${paramName}`;
}

/**
 * Recursively replace CrossReference AST nodes with Identifier nodes so that
 * the standard FormulaEvaluator can process the resulting AST.
 * The identifier name matches the key used in the evaluation context.
 */
function rewriteCrossRefs(node: ASTNode): ASTNode {
  switch (node.kind) {
    case 'crossref':
      return { kind: 'identifier', name: xrefKey(node.objectName, node.paramName) };
    case 'unary':
      return { ...node, operand: rewriteCrossRefs(node.operand) };
    case 'binary':
      return { ...node, left: rewriteCrossRefs(node.left), right: rewriteCrossRefs(node.right) };
    case 'call':
      return { ...node, args: node.args.map(rewriteCrossRefs) };
    case 'conditional':
      return {
        ...node,
        condition: rewriteCrossRefs(node.condition),
        consequent: rewriteCrossRefs(node.consequent),
        alternate: rewriteCrossRefs(node.alternate),
      };
    default:
      return node;
  }
}

// ── ConstraintSolver ──────────────────────────────────────────────────────────

export class ConstraintSolver {
  /** All parameters indexed by their id */
  private parameters: Map<string, Parameter> = new Map();

  /** shapeId → set of paramIds owned by that shape */
  private shapeParams: Map<string, Set<string>> = new Map();

  /** shapeId → objectName (display name used in cross-object refs) */
  private shapeObjectNames: Map<string, string> = new Map();

  /** Global parameter ids (these are also present in `parameters`) */
  private globalParamIds: Set<string> = new Set();

  /** Directed acyclic graph of parameter dependencies */
  private graph: ConstraintGraphEngine = new ConstraintGraphEngine();

  /** Resolves parameter names / cross-object references to parameter ids */
  private resolver: ReferenceResolver = new ReferenceResolver();

  /** Evaluation errors keyed by paramId */
  private errors: Map<string, ConstraintError> = new Map();

  /**
   * Last-known resolved values, used to detect which parameters actually
   * changed after a solve so we can return the correct set of shapeIds.
   */
  private previousValues: Map<string, number | boolean | string> = new Map();

  // ── Shape management ───────────────────────────────────────────────────────

  addShape(shapeId: string, objectName: string, params: Parameter[]): void {
    // Register with resolver first so dependency extraction can see the params
    this.resolver.registerShape(shapeId, objectName, params);
    this.shapeObjectNames.set(shapeId, objectName);

    const paramIds = new Set<string>();
    for (const param of params) {
      this.parameters.set(param.id, { ...param });
      paramIds.add(param.id);
    }
    this.shapeParams.set(shapeId, paramIds);

    // Add graph nodes; extract dependencies from formulas
    for (const param of params) {
      const deps = param.formula
        ? this.resolver.extractDependencies(param.formula, shapeId)
        : [];
      this.graph.addNode(param.id, shapeId, deps, param.formula);
      // Mark dirty so the first solve evaluates them
      this.graph.markDirty(param.id);
    }
  }

  removeShape(shapeId: string): void {
    const paramIds = this.shapeParams.get(shapeId);
    if (paramIds) {
      for (const id of paramIds) {
        this.parameters.delete(id);
        this.errors.delete(id);
        this.previousValues.delete(id);
      }
    }
    this.shapeParams.delete(shapeId);
    this.shapeObjectNames.delete(shapeId);
    this.resolver.unregisterShape(shapeId);
    this.graph.removeNodesByOwner(shapeId);
  }

  // ── Global parameters ──────────────────────────────────────────────────────

  addGlobalParameter(param: Parameter): void {
    this.parameters.set(param.id, { ...param });
    this.globalParamIds.add(param.id);
    this.resolver.registerGlobal(param);
    // Globals live under the synthetic owner '__global__'
    this.graph.addNode(param.id, '__global__', [], param.formula);
    this.graph.markDirty(param.id);
  }

  // ── Parameter / formula setters ────────────────────────────────────────────

  setParameterValue(paramId: string, value: number | boolean | string): void {
    const param = this.parameters.get(paramId);
    if (!param) return;
    param.value = value;
    param.formula = undefined;
    this.graph.setFormula(paramId, undefined, []);
    this.graph.markDirty(paramId);
  }

  /**
   * Assign a formula to an existing parameter.
   * Throws `CycleError` if the formula creates a circular dependency.
   */
  setFormula(paramId: string, formula: string): void {
    const param = this.parameters.get(paramId);
    if (!param) return;

    const node = this.graph.getNode(paramId);
    if (!node) return;
    const ownerId = node.ownerId;

    const deps = this.resolver.extractDependencies(formula, ownerId);

    // May throw CycleError
    this.graph.setFormula(paramId, formula, deps);

    param.formula = formula;
    this.graph.markDirty(paramId);
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  getValue(paramId: string): number | boolean | string {
    const param = this.parameters.get(paramId);
    if (!param) throw new Error(`Unknown parameter: "${paramId}"`);
    return param.value;
  }

  getError(paramId: string): ConstraintError | undefined {
    return this.errors.get(paramId);
  }

  getGraph(): ConstraintGraphEngine {
    return this.graph;
  }

  getParameter(paramId: string): Parameter | undefined {
    const p = this.parameters.get(paramId);
    return p ? { ...p } : undefined;
  }

  getAllParametersForShape(shapeId: string): Parameter[] {
    const ids = this.shapeParams.get(shapeId);
    if (!ids) return [];
    const result: Parameter[] = [];
    for (const id of ids) {
      const p = this.parameters.get(id);
      if (p) result.push({ ...p });
    }
    return result;
  }

  // ── Solve ──────────────────────────────────────────────────────────────────

  /**
   * Evaluate all dirty parameters in dependency (topological) order.
   * Returns the set of shapeIds whose parameter values actually changed.
   */
  solve(): Set<string> {
    const changedShapes = new Set<string>();
    const dirtyOrder = this.graph.getDirtySolveOrder();

    for (const paramId of dirtyOrder) {
      const param = this.parameters.get(paramId);
      if (!param) continue;

      const node = this.graph.getNode(paramId);
      if (!node) continue;

      if (!param.formula) {
        // Free parameter — value was set directly, just track if it changed
        this._recordChange(paramId, param.value, node.ownerId, changedShapes);
        this.errors.delete(paramId);
        continue;
      }

      // Build evaluation context
      let evalContext: Record<string, number | boolean | string>;
      try {
        evalContext = this._buildEvalContext(node.ownerId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.errors.set(paramId, { type: 'reference', message: msg });
        continue;
      }

      // Parse formula, rewrite cross-refs, evaluate
      let newValue: number | boolean | string;
      try {
        const ast = parse(param.formula);
        const rewritten = rewriteCrossRefs(ast);
        newValue = evaluateAST(rewritten, evalContext);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.errors.set(paramId, { type: this._classifyError(msg), message: msg });
        continue;
      }

      // Apply min / max clamping for numbers
      if (typeof newValue === 'number') {
        if (param.min !== undefined && newValue < param.min) newValue = param.min;
        if (param.max !== undefined && newValue > param.max) newValue = param.max;
      }

      this.errors.delete(paramId);
      param.value = newValue;
      this._recordChange(paramId, newValue, node.ownerId, changedShapes);
    }

    this.graph.clearAllDirty();
    return changedShapes;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Build the evaluation context for a parameter owned by `ownerId`.
   *
   * Context keys:
   *  - `<paramName>` for every parameter of the owning shape
   *  - `xrefKey(objectName, paramName)` for every parameter of other shapes
   *  - `xrefKey('global', paramName)` for every global parameter
   */
  private _buildEvalContext(
    ownerId: string
  ): Record<string, number | boolean | string> {
    const ctx: Record<string, number | boolean | string> = {};

    // Local params (by name)
    if (ownerId !== '__global__') {
      const localIds = this.shapeParams.get(ownerId);
      if (localIds) {
        for (const id of localIds) {
          const p = this.parameters.get(id);
          if (p) ctx[p.name] = p.value;
        }
      }
    }

    // Cross-object params from other shapes
    for (const [shapeId, paramIds] of this.shapeParams) {
      if (shapeId === ownerId) continue;
      const objectName = this.shapeObjectNames.get(shapeId);
      if (!objectName) continue;
      for (const id of paramIds) {
        const p = this.parameters.get(id);
        if (p) ctx[xrefKey(objectName, p.name)] = p.value;
      }
    }

    // Global params
    for (const id of this.globalParamIds) {
      const p = this.parameters.get(id);
      if (p) ctx[xrefKey('global', p.name)] = p.value;
    }

    return ctx;
  }

  private _recordChange(
    paramId: string,
    newValue: number | boolean | string,
    ownerId: string,
    changedShapes: Set<string>
  ): void {
    const prev = this.previousValues.get(paramId);
    if (prev !== newValue) {
      this.previousValues.set(paramId, newValue);
      if (ownerId !== '__global__') {
        changedShapes.add(ownerId);
      }
    }
  }

  private _classifyError(msg: string): ConstraintError['type'] {
    const lower = msg.toLowerCase();
    if (lower.includes('cycle')) return 'cycle';
    if (lower.includes('syntax') || lower.includes('parse') || lower.includes('expected')) return 'syntax';
    if (lower.includes('reference') || lower.includes('unknown') || lower.includes('no longer')) return 'reference';
    return 'type';
  }
}
