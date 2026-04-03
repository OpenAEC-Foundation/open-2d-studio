/**
 * Constraint Migration Service
 *
 * Converts existing ProfileTemplate + ParameterValues into a ShapeConstraintGraph,
 * allowing existing parametric shapes to participate in the constraint engine.
 */

import type { Parameter, ShapeConstraintGraph } from '../../types/constraints';
import type { ProfileType, ParameterValues, BaseParametricShape } from '../../types/parametric';
import { PROFILE_TEMPLATES } from './profileTemplates';

// ============================================================================
// Migration Helpers
// ============================================================================

/**
 * Map a profile parameter type string to a ParameterValueType.
 * Profile templates use 'number' | 'string' | 'boolean' | 'select';
 * the constraint system uses 'number' | 'integer' | 'boolean' | 'string'.
 */
function mapParamType(type: string): 'number' | 'integer' | 'boolean' | 'string' {
  switch (type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'select':
      return 'string';
    default:
      return 'string';
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Convert an existing ProfileTemplate + ParameterValues pair into a
 * ShapeConstraintGraph.  All parameters are created as free (no formula),
 * carrying min/max/value from the template definition and current values.
 *
 * @param shapeId        The unique id of the owning shape (used to namespace parameter ids).
 * @param profileType    The profile type key, e.g. 'i-beam'.
 * @param parameterValues Current parameter values for the shape.
 * @returns A fully-populated ShapeConstraintGraph ready to register with ConstraintSolver.
 */
export function migrateProfileToConstraintGraph(
  shapeId: string,
  profileType: ProfileType,
  parameterValues: ParameterValues
): ShapeConstraintGraph {
  const template = PROFILE_TEMPLATES[profileType];

  const parameters: Parameter[] = (template?.parameters ?? []).map((def) => {
    // Resolve the current value: prefer the supplied parameterValues, fall back to default
    const rawValue = parameterValues[def.id] ?? def.defaultValue;
    const value: number | boolean | string =
      typeof rawValue === 'number' || typeof rawValue === 'boolean'
        ? rawValue
        : String(rawValue);

    // Build a constraint-engine Parameter — no formula, just a free param
    const param: Parameter = {
      id: `${shapeId}__${def.id}`,
      name: def.id,
      value,
      unit: (def.unit as Parameter['unit']) ?? 'none',
      type: mapParamType(def.type),
      group: def.group,
      isReadOnly: def.readOnly,
    };

    if (typeof def.min === 'number') param.min = def.min;
    if (typeof def.max === 'number') param.max = def.max;

    return param;
  });

  return {
    parameters,
    vertices: [],
    edges: [],
    constraintGraph: {
      nodes: {},
      solveOrder: [],
      globalParameters: {},
      isDirty: false,
    },
  };
}

/**
 * Check whether a shape already has a constraint graph attached.
 *
 * @param shape Any BaseParametricShape (ProfileParametricShape, etc.)
 * @returns true if shape.constraintGraph is defined and has parameters.
 */
export function isMigrated(shape: BaseParametricShape): boolean {
  return (
    shape.constraintGraph !== undefined &&
    shape.constraintGraph.parameters.length > 0
  );
}
