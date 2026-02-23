/**
 * BimViewer — 3D IFC viewer using @thatopen/components
 * Completely isolated from the 2D Canvas. Renders as an overlay (like IfcDashboard).
 * Only visible when the 3D tab is active (show3DView === true).
 */

import { useRef, useEffect, useState, memo } from 'react';
import * as OBC from '@thatopen/components';
import * as OBCF from '@thatopen/components-front';
import * as FRAGS from '@thatopen/fragments';
import * as THREE from 'three';
import { useAppStore } from '../../state/appStore';

/** Convert IFC STEP text to Uint8Array for the loader */
function textToBuffer(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export const BimViewer = memo(function BimViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const componentsRef = useRef<OBC.Components | null>(null);
  const worldRef = useRef<any>(null);
  const loadedContentRef = useRef<string>('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const ifcContent = useAppStore(s => s.ifcContent);
  const viewMode3D = useAppStore(s => s.viewMode3D);

  // Trigger IFC regeneration on mount if content is empty
  useEffect(() => {
    if (!ifcContent) {
      const state = useAppStore.getState();
      if (state.shapes.length > 0) {
        state.regenerateIFC();
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize @thatopen/components once on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;

    const init = async () => {
      try {
        console.log('[BimViewer] 1/8 Creating components...');
        const components = new OBC.Components();
        if (disposed) { components.dispose(); return; }
        componentsRef.current = components;

        console.log('[BimViewer] 2/8 Creating world (scene + renderer + camera)...');
        const worlds = components.get(OBC.Worlds);
        const world = worlds.create<
          OBC.SimpleScene,
          OBC.OrthoPerspectiveCamera,
          OBC.SimpleRenderer
        >();
        worldRef.current = world;

        world.scene = new OBC.SimpleScene(components);
        world.scene.setup();
        (world.scene as any).three.background = null;
        world.renderer = new OBC.SimpleRenderer(components, container);
        world.camera = new OBC.OrthoPerspectiveCamera(components);

        console.log('[BimViewer] 3/8 Init components + grid...');
        components.init();
        components.get(OBC.Grids).create(world);
        await world.camera.controls.setLookAt(15, 10, 15, 0, 0, 0);

        console.log('[BimViewer] 4/8 Setting up IFC loader (WASM: web-ifc@0.0.75)...');
        const ifcLoader = components.get(OBC.IfcLoader);
        await ifcLoader.setup({
          autoSetWasm: false,
          wasm: {
            path: 'https://unpkg.com/web-ifc@0.0.75/',
            absolute: true,
          },
        });
        console.log('[BimViewer] 5/8 IFC loader ready');

        console.log('[BimViewer] 6/8 Initializing FragmentsManager (worker: /worker.mjs)...');
        const fragments = components.get(OBC.FragmentsManager);
        console.log('[BimViewer]   fragments.initialized:', fragments.initialized);
        fragments.init('/worker.mjs');
        console.log('[BimViewer]   fragments.initialized after init:', fragments.initialized);

        console.log('[BimViewer] 7/8 Setting up model listeners...');
        const hasCoreMaterials = !!fragments.core?.models?.materials?.list?.onItemSet;
        const hasListOnItemSet = !!fragments.list?.onItemSet;
        console.log('[BimViewer]   core.models.materials.list.onItemSet:', hasCoreMaterials);
        console.log('[BimViewer]   list.onItemSet:', hasListOnItemSet);

        if (hasCoreMaterials) {
          fragments.core!.models.materials.list.onItemSet.add(({ value: material }: any) => {
            if (!('isLodMaterial' in material && material.isLodMaterial)) {
              material.polygonOffset = true;
              material.polygonOffsetUnits = 1;
              material.polygonOffsetFactor = Math.random();
            }
          });
        }

        if (hasListOnItemSet) {
          fragments.list!.onItemSet.add(({ value: model }: any) => {
            console.log('[BimViewer] Model added via onItemSet:', model);
            model.useCamera(world.camera.three);
            (world.scene as any).three.add(model.object);
            if (fragments.core?.update) {
              fragments.core.update(true);
            }
          });
        }

        console.log('[BimViewer] 8/9 Setting up Highlighter for element selection...');
        try {
          const highlighter = components.get(OBCF.Highlighter);
          highlighter.setup({
            world,
            autoHighlightOnClick: true,
            selectEnabled: true,
            selectMaterialDefinition: {
              color: new THREE.Color(0x4ade80),
              opacity: 0.6,
              transparent: true,
              renderedFaces: FRAGS.RenderedFaces.TWO,
            },
          });
          highlighter.zoomToSelection = false;
          highlighter.multiple = 'ctrlKey';

          // Sync 3D selection → 2D selection via IFC GUID mapping
          highlighter.events.select.onHighlight.add((fragmentIdMap: OBC.ModelIdMap) => {
            const store = useAppStore.getState();
            const selectedIds: string[] = [];

            // Map fragment express IDs back to shape IDs via ifcEntityId
            for (const [_fragmentId, expressIds] of Object.entries(fragmentIdMap)) {
              for (const expressId of expressIds) {
                // Find shape that has this express ID in its metadata
                const shape = store.shapes.find(s => {
                  const eid = (s as any).ifcExpressId;
                  return eid !== undefined && eid === expressId;
                });
                if (shape) {
                  selectedIds.push(shape.id);
                }
              }
            }

            if (selectedIds.length > 0) {
              store.selectShapes(selectedIds);
            }
          });

          highlighter.events.select.onClear.add(() => {
            useAppStore.getState().deselectAll();
          });
        } catch (hlErr) {
          console.warn('[BimViewer] Highlighter setup failed (selection disabled):', hlErr);
        }

        console.log('[BimViewer] 9/9 Init complete! Ready to load IFC.');
        if (!disposed) {
          setStatus('ready');
        }
      } catch (err) {
        console.error('[BimViewer] Init error:', err);
        console.error('[BimViewer] Stack:', err instanceof Error ? err.stack : '');
        if (!disposed) {
          setStatus('error');
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      }
    };

    init();

    return () => {
      disposed = true;
      if (componentsRef.current) {
        try { componentsRef.current.dispose(); } catch { /* ignore */ }
        componentsRef.current = null;
        worldRef.current = null;
      }
    };
  }, []);

  // Load/reload IFC content when it changes
  useEffect(() => {
    if (status !== 'ready' || !componentsRef.current) return;
    if (!ifcContent || ifcContent === loadedContentRef.current) return;

    const loadIfc = async () => {
      try {
        setStatus('loading');
        const components = componentsRef.current!;
        const world = worldRef.current;

        console.log('[BimViewer] Loading IFC content (%d chars, %d KB)...',
          ifcContent.length, Math.round(ifcContent.length / 1024));

        const ifcLoader = components.get(OBC.IfcLoader);
        const fragments = components.get(OBC.FragmentsManager);
        console.log('[BimViewer]   fragments.initialized:', fragments.initialized);

        const buffer = textToBuffer(ifcContent);
        console.log('[BimViewer]   Buffer: %d bytes, calling ifcLoader.load()...', buffer.length);
        const model = await ifcLoader.load(buffer, true, 'model');
        console.log('[BimViewer]   Model loaded:', model);
        console.log('[BimViewer]   model.object:', model.object);
        console.log('[BimViewer]   model.useCamera:', typeof model.useCamera);

        // Explicitly add model to scene and camera
        if (world) {
          if (model.useCamera) model.useCamera(world.camera.three);
          if (model.object) {
            (world.scene as any).three.add(model.object);
            console.log('[BimViewer]   Added model.object to scene');
          }
        }

        loadedContentRef.current = ifcContent;

        // Fit camera to model
        if (world?.camera?.controls) {
          setTimeout(() => {
            try {
              world.camera.controls.fitToSphere(world.scene.three, true);
              console.log('[BimViewer]   Camera fitted to scene');
            } catch (e) {
              console.warn('[BimViewer]   fitToSphere failed:', e);
            }
          }, 200);
        }

        console.log('[BimViewer] IFC load complete!');
        setStatus('ready');
      } catch (err) {
        console.error('[BimViewer] IFC load error:', err);
        console.error('[BimViewer] Stack:', err instanceof Error ? err.stack : '');
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    };

    loadIfc();
  }, [ifcContent, status]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        background: '#1a1a2e',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header bar */}
      <div style={{
        height: 32,
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 12,
        background: 'var(--theme-surface)',
        borderBottom: '1px solid var(--theme-border)',
        flexShrink: 0,
        fontSize: 12,
        color: 'var(--theme-text)',
      }}>
        <span style={{ fontWeight: 600 }}>3D View</span>
        <span style={{ fontSize: 10, color: 'var(--theme-text-dim)' }}>
          @thatopen/components
        </span>
        <span style={{
          fontSize: 10,
          color: status === 'error' ? '#f87171' : status === 'loading' ? '#facc15' : '#4ade80',
          fontFamily: 'monospace',
        }}>
          {status === 'loading' ? 'Loading IFC...' :
           status === 'error' ? `Error: ${errorMsg.slice(0, 60)}` :
           status === 'ready' && loadedContentRef.current ? 'Model loaded' :
           'No model — generate IFC first'}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--theme-text-muted)', fontFamily: 'monospace' }}>
          Mode: {viewMode3D}
        </span>
      </div>

      {/* 3D viewport container — @thatopen attaches its canvas here */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
        }}
      />
    </div>
  );
});
