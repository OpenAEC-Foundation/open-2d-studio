import './styles/merged.css';
import { MergedTitleBar } from './components/merged/MergedTitleBar';
import { MergedRibbon } from './components/merged/MergedRibbon';

/**
 * Slice 1 root component — visual shell over a transparent canvas.
 * No state, no IPC, no interaction. See docs/superpowers/specs/
 * 2026-04-22-open2d-merge-slice1-design.md.
 */
export default function MergedApp() {
  return (
    <div className="merged-app">
      <MergedTitleBar />
      <MergedRibbon />
      <div className="merged-canvas-region" />
    </div>
  );
}
