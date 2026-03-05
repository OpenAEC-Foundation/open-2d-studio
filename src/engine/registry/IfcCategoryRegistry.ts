/**
 * IfcCategoryRegistry — maps shape types to IFC entity class names.
 *
 * Extensions register their shape-type → IFC category mappings here.
 * Core `getIfcCategory()` checks the registry before falling back to defaults.
 */

type IfcCategoryFn = (shape: any) => string;

class IfcCategoryRegistry {
  private handlers = new Map<string, string | IfcCategoryFn>();

  register(shapeType: string, category: string | IfcCategoryFn): void {
    this.handlers.set(shapeType, category);
  }

  unregister(shapeType: string): void {
    this.handlers.delete(shapeType);
  }

  getCategory(shape: { type: string }): string | undefined {
    const handler = this.handlers.get(shape.type);
    if (handler === undefined) return undefined;
    return typeof handler === 'function' ? handler(shape) : handler;
  }
}

export const ifcCategoryRegistry = new IfcCategoryRegistry();
