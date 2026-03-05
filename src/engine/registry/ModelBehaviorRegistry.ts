export type PreAddFn = (shape: any, allShapes: any[], drawings: any[], layers: any[]) => any[] | null;
export type PostDeleteFn = (shape: any, allShapes: any[]) => { deleteIds: string[]; updates: Map<string, Record<string, any>> };

class ModelBehaviorRegistry {
  private preAddHandlers = new Map<string, PreAddFn>();
  private postDeleteHandlers = new Map<string, PostDeleteFn>();

  registerPreAdd(type: string, fn: PreAddFn): void { this.preAddHandlers.set(type, fn); }
  registerPostDelete(type: string, fn: PostDeleteFn): void { this.postDeleteHandlers.set(type, fn); }
  unregisterPreAdd(type: string): void { this.preAddHandlers.delete(type); }
  unregisterPostDelete(type: string): void { this.postDeleteHandlers.delete(type); }
  getPreAdd(type: string): PreAddFn | undefined { return this.preAddHandlers.get(type); }
  getPostDelete(type: string): PostDeleteFn | undefined { return this.postDeleteHandlers.get(type); }
}

export const modelBehaviorRegistry = new ModelBehaviorRegistry();
