import type { ComponentDefinition } from '../../types/component';

// ── Cycle error ───────────────────────────────────────────────

export class NestingCycleError extends Error {
  cyclePath: string[];

  constructor(cyclePath: string[]) {
    super(`Nesting cycle detected: ${cyclePath.join(' → ')}`);
    this.name = 'NestingCycleError';
    this.cyclePath = cyclePath;
  }
}

// ── Nesting resolver ──────────────────────────────────────────

export class NestingResolver {
  private readonly definitions: Map<string, ComponentDefinition>;

  constructor(definitions: Map<string, ComponentDefinition>) {
    this.definitions = definitions;
  }

  /**
   * Validates that defId does not participate in any nesting cycle.
   * Throws NestingCycleError if a cycle is detected.
   */
  validateNesting(defId: string): void {
    // visiting: current DFS path (ordered for cycle path reporting)
    const visiting = new Set<string>();
    // visited: fully processed nodes (no cycle reachable from here)
    const visited = new Set<string>();

    this._dfs(defId, visiting, visited, [defId]);
  }

  /**
   * Returns the maximum nesting depth reachable from defId.
   * 0 means the component has no nested components.
   */
  getNestingDepth(defId: string): number {
    // Uses memoization to avoid redundant work.
    const cache = new Map<string, number>();
    return this._depth(defId, cache, new Set());
  }

  // ── Private helpers ────────────────────────────────────────

  private _dfs(
    currentId: string,
    visiting: Set<string>,
    visited: Set<string>,
    path: string[],
  ): void {
    if (visited.has(currentId)) return; // already fully processed, safe
    if (visiting.has(currentId)) {
      // Cycle detected — build the cycle portion of the path
      const cycleStart = path.indexOf(currentId);
      const cyclePath = path.slice(cycleStart);
      throw new NestingCycleError(cyclePath);
    }

    const def = this.definitions.get(currentId);
    if (!def) return; // unknown definition — treat as leaf

    visiting.add(currentId);

    for (const nested of def.nestedComponents) {
      this._dfs(nested.definitionId, visiting, visited, [...path, nested.definitionId]);
    }

    visiting.delete(currentId);
    visited.add(currentId);
  }

  private _depth(
    defId: string,
    cache: Map<string, number>,
    visiting: Set<string>,
  ): number {
    if (cache.has(defId)) return cache.get(defId)!;
    if (visiting.has(defId)) return 0; // cycle guard — return 0 to avoid infinite recursion

    const def = this.definitions.get(defId);
    if (!def || def.nestedComponents.length === 0) {
      cache.set(defId, 0);
      return 0;
    }

    visiting.add(defId);

    let maxChildDepth = 0;
    for (const nested of def.nestedComponents) {
      const childDepth = this._depth(nested.definitionId, cache, visiting);
      if (childDepth > maxChildDepth) maxChildDepth = childDepth;
    }

    visiting.delete(defId);

    const depth = 1 + maxChildDepth;
    cache.set(defId, depth);
    return depth;
  }
}
