import './styles/merged.css';
import { MergedTitleBar } from './components/merged/MergedTitleBar';
import { MergedRibbon } from './components/merged/MergedRibbon';

/**
 * Slice 1.5 root component — the shell window only contains the
 * TitleBar + Ribbon. The wgpu canvas lives in a separate sibling
 * window (route B two-window architecture). See docs/superpowers/specs/
 * 2026-04-22-open2d-merge-slice1-design.md.
 */
export default function MergedApp() {
  return (
    <div className="merged-app">
      <MergedTitleBar />
      <MergedRibbon />
    </div>
  );
}
