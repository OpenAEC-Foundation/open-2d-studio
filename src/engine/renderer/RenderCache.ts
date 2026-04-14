/**
 * RenderCache - OffscreenCanvas-based render cache for O(1) pan
 *
 * Caches the full scene render to an OffscreenCanvas. During pan, the cached
 * image is translated rather than re-rendering all shapes. A full re-render
 * is only triggered when zoom changes or shapes are added/removed/modified.
 */

export interface CacheViewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export class RenderCache {
  private cache: OffscreenCanvas | null = null;
  private cacheCtx: OffscreenCanvasRenderingContext2D | null = null;
  private cacheViewport: CacheViewport | null = null;
  private cacheShapeHash: string = '';
  private cacheWidth = 0;
  private cacheHeight = 0;

  /** Whether OffscreenCanvas is supported in this environment */
  private readonly supported: boolean;

  constructor() {
    this.supported = typeof OffscreenCanvas !== 'undefined';
  }

  /**
   * Check if the cache is valid for the current state.
   * Cache is valid when zoom AND shape hash both match the cached snapshot.
   * Pan-only changes are handled by translating the cached image (still "valid").
   */
  isValid(zoom: number, shapeHash: string): boolean {
    if (!this.supported || !this.cache || !this.cacheViewport) return false;
    if (this.cacheWidth === 0 || this.cacheHeight === 0) return false;
    return this.cacheViewport.zoom === zoom && this.cacheShapeHash === shapeHash;
  }

  /**
   * Ensure the internal OffscreenCanvas matches the given dimensions.
   * Resizes (and thus invalidates) the cache when the canvas size changes.
   */
  ensureSize(width: number, height: number): void {
    if (!this.supported) return;
    if (width === this.cacheWidth && height === this.cacheHeight) return;

    this.cacheWidth = width;
    this.cacheHeight = height;

    try {
      this.cache = new OffscreenCanvas(width, height);
      this.cacheCtx = this.cache.getContext('2d');
    } catch {
      // OffscreenCanvas creation failed — disable caching
      this.cache = null;
      this.cacheCtx = null;
    }

    // Size changed → previous cache is stale
    this.cacheViewport = null;
    this.cacheShapeHash = '';
  }

  /**
   * Capture the current contents of sourceCanvas into the OffscreenCanvas.
   * Call this after a full render cycle to store the result.
   */
  capture(
    sourceCanvas: HTMLCanvasElement,
    viewport: CacheViewport,
    shapeHash: string,
  ): void {
    if (!this.supported || !this.cache || !this.cacheCtx) return;
    if (sourceCanvas.width !== this.cacheWidth || sourceCanvas.height !== this.cacheHeight) {
      this.ensureSize(sourceCanvas.width, sourceCanvas.height);
      if (!this.cache || !this.cacheCtx) return;
    }

    try {
      this.cacheCtx.clearRect(0, 0, this.cacheWidth, this.cacheHeight);
      this.cacheCtx.drawImage(sourceCanvas, 0, 0);
      this.cacheViewport = { ...viewport };
      this.cacheShapeHash = shapeHash;
    } catch {
      // drawImage can throw if the source canvas is zero-sized
      this.invalidate();
    }
  }

  /**
   * Draw the cached image to targetCtx, shifted by the pan delta between the
   * cached viewport and the current viewport.
   *
   * Returns `true` when the cache was used (caller should skip the full render).
   * Returns `false` on a cache miss — caller must do a full render.
   */
  drawCached(
    targetCtx: CanvasRenderingContext2D,
    currentViewport: CacheViewport,
  ): boolean {
    if (!this.supported || !this.cache || !this.cacheViewport) return false;

    const deltaX = currentViewport.offsetX - this.cacheViewport.offsetX;
    const deltaY = currentViewport.offsetY - this.cacheViewport.offsetY;

    try {
      // Clear the canvas first to prevent ghosting artifacts
      targetCtx.clearRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
      targetCtx.drawImage(this.cache, deltaX, deltaY);
    } catch {
      this.invalidate();
      return false;
    }

    return true;
  }

  /**
   * Invalidate the cache — the next frame will perform a full render.
   */
  invalidate(): void {
    this.cacheViewport = null;
    this.cacheShapeHash = '';
  }
}
