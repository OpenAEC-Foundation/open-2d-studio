// Open 2D Viewer — Layout Mockup v2 (single-file React component).
//
// Purpose: visual target for the Rust egui port. Iterate on this
// mockup in the browser (http://localhost:7778/); once we're happy
// with the layout, pixel-match it inside `kernel/crates/superui/`.
//
// Reference: pixel-perfect 1.0 React app (open-2d-studio-main).
// Key files mirrored:
//   src/components/layout/Ribbon/Ribbon.tsx + .css
//   src/components/layout/TitleBar/TitleBar.tsx
//   src/components/layout/StatusBar/StatusBar.tsx
//   src/components/layout/FileTabBar/FileTabBar.tsx
//   src/components/panels/NavigationPanel.tsx
//   src/components/panels/RightPanelLayout.tsx
//   src/styles/globals.css   (--theme-* vars for the "default" theme)
//
// Design tokens (use these exact values when porting to Rust):
//   colors (default warm-brown theme):
//     bg            = #3E3636  (canvas-area, ribbon content)
//     surface       = #4A4242  (titlebar, ribbon top-row, statusbar, panel)
//     surface-hi    = #564E4E  (elevated surface, dropdowns)
//     accent        = #D97706  (File tab fill, active button, logo)
//     accent-hov    = #B45309
//     border        = rgba(217,119,6,0.25)
//     border-light  = rgba(217,119,6,0.15)
//     hover         = rgba(217,119,6,0.10)
//     text          = #F5F0EB
//     text-dim      = rgba(245,240,235,0.6)
//     text-muted    = rgba(245,240,235,0.4)
//     close-red     = #c42b1c   (Windows window-close hover)
//     layer reds    = #FF4040    layer greens = #66CC66
//     layer cyans   = #33CCCC    layer yellow = #FFCC33
//   metrics (match 1.0 css):
//     titlebar h     = 32
//     ribbon tabstrip= 28           (ribbon-tabs)
//     ribbon content = 94           (ribbon-content-container)
//     file tab strip = 30           (FileTabBar)
//     statusbar h    = 24
//     left dock w    = 192 default  (NavigationPanel: 140..500)
//     right panel w  = 256 default  (RightPanelLayout: 180..500)
//     ribbon btn (L) = 66h, 54 minW, icon 28 + label 10px
//     ribbon btn (M) = 32h, 74 minW, icon 20 + label 11px (stack of 2)
//     ribbon btn (S) = 22h, 70 minW, icon 16 + label 11px (stack of 3)
//     group label    = 9px uppercase, 0.3px letter-spacing, muted
//     group sep      = 1px border-right (light)
//     group min-w    = 50

const { useState, useRef, useEffect } = React;

const Token = {
  bg:          '#3E3636',
  surface:     '#4A4242',
  surfaceHi:   '#564E4E',
  accent:      '#D97706',
  accentHov:   '#B45309',
  accentSoft:  'rgba(217,119,6,0.18)',
  hover:       'rgba(217,119,6,0.10)',
  border:      'rgba(217,119,6,0.25)',
  borderLight: 'rgba(217,119,6,0.15)',
  text:        '#F5F0EB',
  textDim:     'rgba(245,240,235,0.6)',
  textMuted:   'rgba(245,240,235,0.4)',
  closeRed:    '#c42b1c',
};

// -------------------------------------------------------------------------
// Icon library — mostly Lucide path data, plus custom drafting glyphs
// -------------------------------------------------------------------------

const Icon = ({ d, size = 16, stroke = 'currentColor', strokeWidth = 1.6 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
       strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

// Lucide path snippets
const Lucide = {
  undo:     'M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13',
  redo:     'M21 7v6h-6M3 17a9 9 0 0 1 15-6.7L21 13',
  newFile:  'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 18v-6 M9 15h6',
  folder:   'M4 4h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  folderOp: 'M6 14l1.5-2.9a2 2 0 0 1 1.8-1.1h8.7a2 2 0 0 1 2 2.4l-1 4a2 2 0 0 1-2 1.6H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2',
  save:     'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8',
  saveAs:   'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M12 11v6 M9 14l3 3 3-3',
  printer:  'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z',
  gear:     'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  caret:    'M6 9l6 6 6-6',
  chevR:    'M9 6l6 6-6 6',
  chevD:    'M6 9l6 6 6-6',
  cursor:   'M3 3l7 19 2.5-9 9-2.5z',
  hand:     'M18 11V6a2 2 0 0 0-4 0v5 M14 10V4a2 2 0 0 0-4 0v6 M10 10.5V6a2 2 0 0 0-4 0v8 M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.5-2.5l-7-12c-.7-1.2-.2-2.7 1-3.4 1.2-.7 2.7-.2 3.4 1l3.7 6.3',
  fit:      'M3 7V3h4 M21 7V3h-4 M3 17v4h4 M21 17v4h-4',
  zoomIn:   ['M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'M21 21l-4.3-4.3', 'M11 8v6', 'M8 11h6'],
  zoomOut:  ['M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'M21 21l-4.3-4.3', 'M8 11h6'],
  zoomPrev: ['M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'M21 21l-4.3-4.3', 'M14 8l-3 3 3 3', 'M11 11h4'],
  grid:     'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  sun:      'M12 4v2 M12 18v2 M4 12H2 M22 12h-2 M5.6 5.6l1.4 1.4 M17 17l1.4 1.4 M5.6 18.4l1.4-1.4 M17 7l1.4-1.4 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  layers:   'M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
  layersOff:'M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M3 3l18 18',
  panelR:   'M3 4h18v16H3z M15 4v16',
  panelL:   'M3 4h18v16H3z M9 4v16',
  drawings: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h4',
  sheets:   'M3 5h18v3H3z M3 11h11v3H3z M16 11h5v9h-5z M3 16h11v4H3z',
  palette:  'M12 2a10 10 0 0 0 0 20c1.7 0 3-1.3 3-3 0-.8-.3-1.5-.8-2-.5-.5-.8-1.2-.8-2 0-1.7 1.3-3 3-3h2A4 4 0 0 0 22 8c0-3.3-4.5-6-10-6z M6 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M9.5 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M14.5 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M18 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  exportFd: 'M4 4h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M12 12v6 M9 15l3 3 3-3',
  folderTr: 'M4 4h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M9 13l2 2 4-4',
  check2:   'M5 12l4 4 10-10',
  xmark:    'M18 6L6 18 M6 6l12 12',
  search:   'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0 M21 21l-4.3-4.3',
  eye:      'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff:   'M17 17C15.6 17.7 14 18 12 18c-6.5 0-10-7-10-7s1.4-2.7 4-4.7 M9 5.5A10 10 0 0 1 12 5c6.5 0 10 7 10 7s-.7 1.4-2 3 M9.9 9.9a3 3 0 1 0 4.2 4.2 M3 3l18 18',
  lock:     'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  unlock:   'M5 11h14v10H5z M8 11V7a4 4 0 0 1 7-2.5',
  trash:    'M3 6h18 M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14 M10 11v6 M14 11v6 M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  terminal: 'M4 17l6-6-6-6 M12 19h8',
  minimize: 'M5 12h14',
  maximize: 'M5 5h14v14H5z',
  close:    'M5 5l14 14 M19 5l-14 14',
  ifcText:  null, // rendered as the literal "IFC" string in JSX
};

// Custom drafting icons (icons that don't ship clean in Lucide / where 1.0
// uses a CadIcons.tsx custom-SVG). All use the same 24×24 viewBox.
const Cad = {
  // Linear-dimension icon (from 1.0 CadIcons LinearDimensionIcon)
  linear: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {/* extension lines */}
      <line x1="4"  y1="6"  x2="4"  y2="14" />
      <line x1="20" y1="6"  x2="20" y2="14" />
      {/* dimension line + arrowheads */}
      <line x1="4"  y1="10" x2="20" y2="10" />
      <polygon points="4,10 8,8 8,12"   fill="currentColor" stroke="none" />
      <polygon points="20,10 16,8 16,12" fill="currentColor" stroke="none" />
      {/* tick marks at bottom for emphasis */}
      <line x1="6"  y1="18" x2="6"  y2="20" />
      <line x1="18" y1="18" x2="18" y2="20" />
      <line x1="6"  y1="19" x2="18" y2="19" />
    </svg>
  ),
  angular: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="21" x2="21" y2="21" />
      <line x1="3" y1="21" x2="17" y2="6" />
      <path d="M11 21 A 9 9 0 0 0 8.5 15" />
    </svg>
  ),
  radius: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
      <line x1="12" y1="12" x2="19" y2="6" />
      <polygon points="19,6 16,7 17.5,9" fill="currentColor" stroke="none" />
    </svg>
  ),
  diameter: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
      <line x1="5" y1="12" x2="19" y2="12" />
      <polygon points="5,12 7,11 7,13" fill="currentColor" stroke="none" />
      <polygon points="19,12 17,11 17,13" fill="currentColor" stroke="none" />
    </svg>
  ),
  // ── Better measurement icons (user explicitly requested) ──────────────
  // Length: ruler/tape with ticks (24x24)
  measureLength: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="8" width="20" height="6" rx="1" />
      <line x1="5" y1="8" x2="5" y2="11" />
      <line x1="8" y1="8" x2="8" y2="11" />
      <line x1="11" y1="8" x2="11" y2="12" />
      <line x1="14" y1="8" x2="14" y2="11" />
      <line x1="17" y1="8" x2="17" y2="11" />
      <line x1="20" y1="8" x2="20" y2="12" />
    </svg>
  ),
  // Area: pentagon outline with corner dots + cross-hatched fill
  measureArea: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12,3 21,9 18,20 6,20 3,9" />
      <line x1="6" y1="20" x2="18" y2="6" strokeOpacity="0.35" />
      <line x1="3" y1="14" x2="14" y2="20" strokeOpacity="0.35" />
      <line x1="10" y1="3" x2="21" y2="14" strokeOpacity="0.35" />
      <circle cx="12" cy="3" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="21" cy="9" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="18" cy="20" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="6" cy="20" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="3" cy="9" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  // Angle: two rays with an arc + degree marker
  measureAngle: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="20" x2="20" y2="20" />
      <line x1="4" y1="20" x2="20" y2="6" />
      <path d="M16 20 A 12 12 0 0 0 12.4 12.3" />
      <circle cx="4" cy="20" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  // Coordinate: crosshair with axes and a labelled point
  measureCoord: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  ),
};

// -------------------------------------------------------------------------
// QAT (Quick Access Toolbar) button
// -------------------------------------------------------------------------

const QatBtn = ({ icon, title, disabled, active, onClick }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className="p-1.5 rounded transition-colors"
    style={{
      cursor: disabled ? 'not-allowed' : 'default',
      opacity: disabled ? 0.4 : 1,
      background: active ? Token.border : 'transparent',
      color: active ? '#7CC4FF' : Token.textDim,
    }}
    onMouseEnter={(e) => { if (!disabled && !active) e.currentTarget.style.background = Token.hover; }}
    onMouseLeave={(e) => { if (!disabled && !active) e.currentTarget.style.background = 'transparent'; }}
  >
    <Icon d={Lucide[icon]} size={14} />
  </button>
);

// -------------------------------------------------------------------------
// Ribbon button primitives — mirror RibbonComponents.tsx exactly
// -------------------------------------------------------------------------

const RibbonBtn = ({ icon, label, active, disabled, onClick, badge }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="flex flex-col items-center justify-start rounded transition-colors"
    style={{
      width: 54, height: 66, minWidth: 54,
      padding: '4px 6px 2px',
      border: `1px solid ${active ? Token.accent : 'transparent'}`,
      background: active ? Token.accent : 'transparent',
      color: active ? '#fff' : Token.textDim,
      cursor: disabled ? 'not-allowed' : 'default',
      opacity: disabled ? 0.4 : 1,
      gap: 4,
    }}
    onMouseEnter={(e) => {
      if (disabled || active) return;
      e.currentTarget.style.background = Token.hover;
      e.currentTarget.style.borderColor = Token.borderLight;
    }}
    onMouseLeave={(e) => {
      if (disabled || active) return;
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.borderColor = 'transparent';
    }}
  >
    <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {icon}
    </div>
    <span style={{
      fontSize: 10, lineHeight: 1.1, maxWidth: 58,
      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
      overflow: 'hidden', wordBreak: 'break-word', textAlign: 'center',
    }}>{label}{badge}</span>
  </button>
);

const RibbonSmallBtn = ({ icon, label, shortcut, active, disabled, onClick }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={shortcut ? `${label} (${shortcut})` : label}
    className="flex items-center transition-colors rounded-sm"
    style={{
      height: 22, minWidth: 70, padding: '2px 8px 2px 4px', gap: 6,
      border: `1px solid ${active ? Token.accent : 'transparent'}`,
      background: active ? Token.accent : 'transparent',
      color: active ? '#fff' : Token.textDim,
      cursor: disabled ? 'not-allowed' : 'default',
      opacity: disabled ? 0.4 : 1,
    }}
    onMouseEnter={(e) => {
      if (disabled || active) return;
      e.currentTarget.style.background = Token.hover;
      e.currentTarget.style.borderColor = Token.borderLight;
    }}
    onMouseLeave={(e) => {
      if (disabled || active) return;
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.borderColor = 'transparent';
    }}
  >
    <span style={{ width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {icon}
    </span>
    <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{label}</span>
  </button>
);

const RibbonBtnStack = ({ children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, height: '100%', justifyContent: 'flex-start' }}>
    {children}
  </div>
);

const RibbonGroup = ({ label, children, lastChild }) => (
  <div
    className="flex flex-col"
    style={{
      padding: '0 4px',
      borderRight: lastChild ? 'none' : `1px solid ${Token.borderLight}`,
      minWidth: 50, height: '100%',
      marginRight: lastChild ? 0 : 4,
    }}
  >
    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-start', flex: 1, padding: '2px 0' }}>
      {children}
    </div>
    <div style={{
      fontSize: 9, color: Token.textMuted, textAlign: 'center', fontWeight: 500,
      padding: '2px 0', textTransform: 'uppercase', letterSpacing: '0.3px', whiteSpace: 'nowrap',
    }}>{label}</div>
  </div>
);

// -------------------------------------------------------------------------
// File tab (Chrome-style with sloped right edge — from FileTabBar.tsx)
// -------------------------------------------------------------------------

const FileTab = ({ name, modified, active, nextActive, onClose, onClick }) => {
  const bg = active ? Token.bg : Token.surface;
  const nextBg = nextActive ? Token.bg : Token.surface;
  return (
    <div className="flex items-stretch group cursor-pointer" onClick={onClick}>
      <div className="flex items-center" style={{ height: 30, background: bg }}>
        <span className="px-3 text-xs select-none"
              style={{ color: active ? Token.text : Token.textDim, fontWeight: active ? 600 : 400 }}>
          {name}{modified ? ' *' : ''}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onClose && onClose(); }}
          className="w-4 h-4 flex items-center justify-center text-[12px] leading-none -mr-1 opacity-0 group-hover:opacity-100"
          style={{ color: Token.textDim, background: 'transparent' }}
          title="Close"
        >×</button>
      </div>
      {/* Sloped right edge */}
      <svg width="14" height="30" viewBox="0 0 14 30" style={{ display: 'block', flexShrink: 0 }}>
        <polygon points="0,0 0,30 14,30" fill={bg} />
        <polygon points="0,0 14,0 14,30" fill={nextBg} />
      </svg>
    </div>
  );
};

// -------------------------------------------------------------------------
// Status bar widgets
// -------------------------------------------------------------------------

const StatusItem = ({ label, value, mono }) => (
  <div className="flex items-center gap-2">
    <span style={{ color: Token.textDim }}>{label}:</span>
    <span style={{ color: Token.text, fontFamily: mono ? 'Consolas, monospace' : undefined }}>{value}</span>
  </div>
);

const StatusBtn = ({ children, active, accent, onClick, title }) => (
  <button
    onClick={onClick}
    title={title}
    className="px-1.5 py-0.5 rounded text-xs font-mono transition-colors"
    style={{
      cursor: 'default',
      background: active ? (accent === 'green' ? 'rgba(34,197,94,0.30)' : Token.accent) : 'transparent',
      color: active ? (accent === 'green' ? '#86efac' : '#fff') : Token.textDim,
    }}
    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = Token.hover; }}
    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
  >
    {children}
  </button>
);

// -------------------------------------------------------------------------
// Left dock — NavigationPanel collapsible sections (Drawings / Sheets / Layers)
// -------------------------------------------------------------------------

const SectionHeader = ({ label, sublabel, collapsed, onToggle, onAdd }) => (
  <div
    className="flex items-center gap-1 px-2 py-1.5 cursor-default select-none flex-shrink-0"
    style={{ background: Token.surface, borderBottom: `1px solid ${Token.borderLight}` }}
    onClick={onToggle}
  >
    <Icon d={collapsed ? Lucide.chevR : Lucide.chevD} size={14} stroke={Token.textDim} />
    <span style={{ fontSize: 12, fontWeight: 500, color: Token.text }}>{label}</span>
    <span style={{ fontSize: 10, color: Token.textDim, marginLeft: 'auto' }}>{sublabel}</span>
    {onAdd && (
      <button
        onClick={(e) => { e.stopPropagation(); onAdd(); }}
        className="ml-1 p-0.5 rounded"
        style={{ color: Token.textDim }}
        title="Add"
      ><Icon d="M12 5v14 M5 12h14" size={12} /></button>
    )}
  </div>
);

const DrawingRow = ({ name, type, active }) => (
  <div
    className="group flex items-center gap-2 px-2 py-1.5 rounded cursor-default transition-colors"
    style={{
      background: active ? Token.accentSoft : 'transparent',
      border: `1px solid ${active ? Token.accent : 'transparent'}`,
    }}
  >
    <span className="text-[9px] font-medium px-1 rounded"
          style={{ background: 'rgba(96,165,250,0.30)', color: '#bfdbfe' }}>{type}</span>
    <span className="flex-1 text-xs truncate" style={{ color: Token.text }}>{name}</span>
  </div>
);

const SheetRow = ({ name, size, active }) => (
  <div
    className="flex items-center gap-2 px-2 py-1 rounded cursor-default"
    style={{
      background: active ? Token.accentSoft : 'transparent',
      border: `1px solid ${active ? Token.accent : 'transparent'}`,
    }}
  >
    <Icon d={Lucide.sheets} size={11} stroke={Token.textDim} />
    <span className="flex-1 text-xs truncate" style={{ color: Token.text }}>{name}</span>
    <span style={{ fontSize: 10, color: Token.textMuted }}>{size}</span>
  </div>
);

const LayerRow = ({ color, name, visible, locked, onToggle, onLock }) => (
  <div className="flex items-center gap-1.5 h-6 px-2 group"
       onMouseEnter={(e) => e.currentTarget.style.background = Token.hover}
       onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
    <input type="color" defaultValue={color} className="w-4 h-4 p-0 border-0 bg-transparent" />
    <span className="flex-1 text-[11px] truncate" style={{ color: Token.text }}>{name}</span>
    <button onClick={onToggle} className="opacity-60 group-hover:opacity-100" style={{ color: Token.textDim }}>
      <Icon d={visible ? Lucide.eye : Lucide.eyeOff} size={12} />
    </button>
    <button onClick={onLock} className="opacity-60 group-hover:opacity-100" style={{ color: locked ? Token.accent : Token.textDim }}>
      <Icon d={locked ? Lucide.lock : Lucide.unlock} size={12} />
    </button>
  </div>
);

// =========================================================================
// MAIN APP
// =========================================================================

function Open2DViewerMockup() {
  const [activeRibbonTab, setActiveRibbonTab] = useState('Home');
  const [activeFileTab, setActiveFileTab] = useState('Constructietekening');
  const [activeTool, setActiveTool] = useState('select');
  const [ortho, setOrtho] = useState(false);
  // OSNAP toggles in the status bar. End/Mid/Cen default ON, Int/Per/Near
  // default OFF (Int + Near over-trigger and steal the cursor — toggle on
  // via this strip when needed). Matches the Rust default in
  // studio_app.rs after commit a42d9c4.
  const [snaps, setSnaps] = useState({
    End: true,  Mid: true,  Cen: true,
    Int: false, Per: false, Near: false,
  });
  const [grid, setGrid] = useState(true);
  const [whiteBg, setWhiteBg] = useState(false);
  const [layersOpen, setLayersOpen] = useState(true);
  const [drawingsOpen, setDrawingsOpen] = useState(true);
  const [sheetsOpen, setSheetsOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [ifcOpen, setIfcOpen] = useState(false);

  const fileTabs = [
    { id: 'Start',                 name: 'Start',                 modified: false },
    { id: 'Constructietekening',   name: 'Constructietekening.dwg', modified: true  },
    { id: '2705_model',            name: '2705_model.o2d',        modified: false },
  ];

  const drawings = [
    { name: 'Begane grond',           type: 'PL', active: true  },
    { name: 'Eerste verdieping',      type: 'PL', active: false },
    { name: 'Doorsnede A-A',          type: 'SC', active: false },
    { name: 'Funderingsherstel',      type: 'SA', active: false },
  ];

  const sheets = [
    { name: 'CP-21 — Constructie',    size: 'A1', active: true  },
    { name: 'CP-22 — Plattegrond',    size: 'A1', active: false },
    { name: 'CP-30 — Details',        size: 'A3', active: false },
  ];

  const layers = [
    { color: '#FFFFFF', name: '0',                              visible: true,  locked: false },
    { color: '#A0A0A0', name: 'A--A20--_Bovenbouw',             visible: true,  locked: false },
    { color: '#A0A0A0', name: 'A--A23--_Vloeren',               visible: true,  locked: false },
    { color: '#FF4040', name: 'A--L$1--_Algemeen',              visible: true,  locked: false },
    { color: '#FF4040', name: 'A--L$4--_Onderhoek',             visible: true,  locked: false },
    { color: '#A0A0A0', name: 'A--L$7--_Stramien',              visible: true,  locked: false },
    { color: '#FF4040', name: 'A--L$8--_Hulplijnen',            visible: false, locked: false },
    { color: '#66CC66', name: 'A--L16--_Funderingskonstrukties',visible: true,  locked: false },
    { color: '#A0A0A0', name: 'A--L21--_Buitenwanden',          visible: true,  locked: false },
    { color: '#33CCCC', name: 'A--L23--_Vloeren',               visible: true,  locked: true  },
    { color: '#66CC66', name: 'A--L28--_Hoofddraagkonstrukties',visible: true,  locked: false },
    { color: '#FFCC33', name: 'A--LD003_Detailpen002',          visible: true,  locked: false },
    { color: '#FF4040', name: 'A--M$1--_Algemeen',              visible: true,  locked: false },
    { color: '#FFCC33', name: 'A--T$1--_Algemeen',              visible: true,  locked: false },
    { color: '#FFFFFF', name: 'A--T23--_Vloeren',               visible: true,  locked: false },
    { color: '#FFFFFF', name: 'Defpoints',                      visible: true,  locked: true  },
  ];

  // --------------------------------------------------------------- RENDER
  return (
    <div className="select-none" style={{
      fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
      background: Token.bg, color: Token.text,
      height: '100vh', display: 'flex', flexDirection: 'column',
    }}>

      {/* ════════ TITLEBAR (h=32, from TitleBar.tsx) ════════ */}
      <div className="flex items-center select-none" style={{
        background: Token.surface, height: 32,
        borderBottom: `1px solid ${Token.borderLight}`,
      }}>
        {/* QAT */}
        <div className="flex items-center gap-0.5 px-2">
          <div className="w-5 h-5 rounded grid place-items-center font-bold text-[10px]"
               style={{ background: Token.accent, color: '#fff' }}>2D</div>
          <div className="w-px h-4 mx-0.5" style={{ background: Token.borderLight }} />
          <QatBtn icon="undo"    title="Undo (Ctrl+Z)" disabled />
          <QatBtn icon="redo"    title="Redo (Ctrl+Y)" disabled />
          <div className="w-px h-4 mx-0.5" style={{ background: Token.borderLight }} />
          <QatBtn icon="newFile" title="New (Ctrl+N)" />
          <QatBtn icon="folder"  title="Open (Ctrl+O)" />
          <QatBtn icon="save"    title="Save (Ctrl+S)" disabled />
          <QatBtn icon="saveAs"  title="Save As (Ctrl+Shift+S)" disabled />
          <div className="w-px h-4 mx-0.5" style={{ background: Token.borderLight }} />
          <QatBtn icon="printer" title="Print (Ctrl+P)" />
          <QatBtn icon="gear"    title="Settings" />
          <QatBtn icon="caret"   title="Customize Quick Access Toolbar" />
        </div>

        {/* Draggable title region */}
        <div className="flex-1 h-full flex items-center justify-center">
          <span style={{ color: Token.textDim, fontSize: 13, fontWeight: 500 }}>
            * Constructietekening - Open 2D Viewer v0.4.2
          </span>
        </div>

        {/* Send feedback */}
        <button className="text-xs mr-4" style={{ color: Token.textDim, cursor: 'default' }}>
          Send Feedback
        </button>

        {/* Window controls (Windows style) */}
        <div className="flex items-center h-full">
          <button className="w-[46px] h-full flex items-center justify-center"
                  style={{ color: Token.textDim }}>
            <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1" /></svg>
          </button>
          <button className="w-[46px] h-full flex items-center justify-center"
                  style={{ color: Token.textDim }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" /></svg>
          </button>
          <button className="w-[46px] h-full flex items-center justify-center group"
                  style={{ color: Token.textDim }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = Token.closeRed; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = Token.textDim; }}>
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
              <line x1="0" y1="0" x2="10" y2="10" /><line x1="10" y1="0" x2="0" y2="10" /></svg>
          </button>
        </div>
      </div>

      {/* ════════ RIBBON TABSTRIP (h=28) ════════ */}
      <div className="flex items-end px-2"
           style={{
             background: `linear-gradient(to bottom, ${Token.surface} 0%, #443c3c 100%)`,
             height: 28, gap: 2,
             borderBottom: `1px solid ${Token.borderLight}`,
           }}>
        {/* File button */}
        <button className="h-full px-4 font-semibold text-xs rounded-t"
                style={{ background: Token.accent, color: '#fff', borderRadius: '4px 4px 0 0' }}>
          File
        </button>
        {/* Tabs */}
        {['Home', 'View'].map((t) => {
          const isActive = activeRibbonTab === t;
          return (
            <button
              key={t}
              onClick={() => setActiveRibbonTab(t)}
              className="px-4 text-xs"
              style={{
                padding: '6px 16px', fontSize: 12, fontWeight: 500,
                background: isActive ? Token.bg : 'transparent',
                color: isActive ? Token.text : Token.textDim,
                border: isActive ? `1px solid ${Token.borderLight}` : '1px solid transparent',
                borderBottom: isActive ? `1px solid ${Token.bg}` : 'none',
                borderRadius: '4px 4px 0 0',
                marginBottom: isActive ? -1 : 0,
                cursor: 'default',
              }}
            >{t}</button>
          );
        })}
      </div>

      {/* ════════ RIBBON CONTENT (h=94) ════════ */}
      <div style={{ background: Token.bg, height: 94, padding: '4px 8px 0', position: 'relative' }}>
        {/* ─── HOME TAB ─── */}
        {activeRibbonTab === 'Home' && (
          <div style={{ display: 'flex', gap: 2, alignItems: 'stretch', height: '100%' }}>
            {/* Selection */}
            <RibbonGroup label="Selection">
              <RibbonBtn icon={<Icon d={Lucide.cursor} size={22} />} label="Select"
                         active={activeTool === 'select'} onClick={() => setActiveTool('select')} />
              <RibbonBtn icon={<Icon d={Lucide.hand} size={22} />} label="Pan"
                         active={activeTool === 'pan'} onClick={() => setActiveTool('pan')} />
              <RibbonBtnStack>
                <RibbonSmallBtn icon={<Icon d="M4 4h16v16H4z M9 12l2 2 4-4" size={14} />} label="Select All" />
                <RibbonSmallBtn icon={<Icon d="M4 4h16v16H4z M9 9l6 6 M15 9l-6 6" size={14} />} label="Deselect" />
                <RibbonSmallBtn icon={<Icon d={Lucide.search} size={14} />} label="Find" disabled shortcut="Ctrl+F" />
              </RibbonBtnStack>
            </RibbonGroup>

            {/* Annotate (read-only — all disabled, but visible to match 1.0 density) */}
            <RibbonGroup label="Annotate">
              <RibbonBtn icon={<Cad.linear size={22} />} label="Linear"  disabled />
              <RibbonBtnStack>
                <RibbonSmallBtn icon={<Cad.angular size={14} />}  label="Angular"  disabled />
                <RibbonSmallBtn icon={<Cad.radius size={14} />}   label="Radius"   disabled />
                <RibbonSmallBtn icon={<Cad.diameter size={14} />} label="Diameter" disabled />
              </RibbonBtnStack>
              <RibbonBtnStack>
                <RibbonSmallBtn icon={<Icon d="M3 21h18 M5 21V9l7-5 7 5v12" size={14} />} label="Leader" disabled />
                <RibbonSmallBtn icon={<Icon d="M4 4h16v16H4z M7 8h10 M7 12h7 M7 16h5" size={14} />} label="Label" disabled />
                <RibbonSmallBtn icon={<Icon d="M3 5h18v14H3z M3 10h18 M9 5v14" size={14} />} label="Table" disabled />
              </RibbonBtnStack>
            </RibbonGroup>

            {/* Measure (NEW — better icons per user request) */}
            <RibbonGroup label="Measure">
              <RibbonBtn icon={<Cad.measureLength size={22} />} label="Length"
                         active={activeTool === 'measure-len'} onClick={() => setActiveTool('measure-len')} />
              <RibbonBtn icon={<Cad.measureArea size={22} />} label="Area"
                         active={activeTool === 'measure-area'} onClick={() => setActiveTool('measure-area')} />
              <RibbonBtn icon={<Cad.measureAngle size={22} />} label="Angle"
                         active={activeTool === 'measure-angle'} onClick={() => setActiveTool('measure-angle')} />
              <RibbonBtn icon={<Cad.measureCoord size={22} />} label="Coord."
                         active={activeTool === 'measure-coord'} onClick={() => setActiveTool('measure-coord')} />
            </RibbonGroup>

            {/* Clipboard */}
            <RibbonGroup label="Clipboard">
              <RibbonBtn icon={<Icon d="M9 5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2 M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z M12 11v6 M9 14l3 3 3-3" size={22} />}
                         label="Copy" />
              <RibbonBtnStack>
                <RibbonSmallBtn icon={<Icon d="M9 5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2 M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z" size={14} />}
                                label="Copy ID" shortcut="Ctrl+Shift+C" />
                <RibbonSmallBtn icon={<Icon d="M16 21h3a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-5 M16 21H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h0 M3 3l18 18" size={14} />}
                                label="Cut" disabled shortcut="Ctrl+X" />
                <RibbonSmallBtn icon={<Icon d={Lucide.trash} size={14} />} label="Delete" disabled />
              </RibbonBtnStack>
            </RibbonGroup>

            {/* Panels */}
            <RibbonGroup label="Panels" lastChild>
              <RibbonBtn icon={<Icon d={Lucide.layers} size={22} />} label="Layers"
                         active={layersOpen} onClick={() => setLayersOpen(!layersOpen)} />
              <RibbonBtn icon={<Icon d={Lucide.panelR} size={22} />} label="Properties"
                         active={rightOpen} onClick={() => setRightOpen(!rightOpen)} />
            </RibbonGroup>
          </div>
        )}

        {/* ─── VIEW TAB ─── */}
        {activeRibbonTab === 'View' && (
          <div style={{ display: 'flex', gap: 2, alignItems: 'stretch', height: '100%' }}>
            <RibbonGroup label="Navigate">
              <RibbonBtn icon={<Icon d={Lucide.hand} size={22} />} label="Pan"
                         active={activeTool === 'pan'} onClick={() => setActiveTool('pan')} />
            </RibbonGroup>

            <RibbonGroup label="Zoom">
              <RibbonBtn icon={<Icon d={Lucide.fit} size={22} />} label="Fit All" />
              <RibbonBtn icon={<Icon d={Lucide.zoomIn} size={22} />} label="Zoom In" />
              <RibbonBtn icon={<Icon d={Lucide.zoomOut} size={22} />} label="Zoom Out" />
              <RibbonBtnStack>
                <RibbonSmallBtn icon={<Icon d="M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" size={14} />} label="Zoom Window" />
                <RibbonSmallBtn icon={<Icon d={Lucide.zoomPrev} size={14} />} label="Previous" />
                <RibbonSmallBtn icon={<Icon d="M12 3v18 M3 12h18" size={14} />} label="Center" />
              </RibbonBtnStack>
            </RibbonGroup>

            <RibbonGroup label="Display">
              <RibbonBtn icon={<Icon d={Lucide.grid} size={22} />} label="Grid"
                         active={grid} onClick={() => setGrid(!grid)} />
              <RibbonBtn icon={<Icon d={Lucide.sun} size={22} />} label="White BG"
                         active={whiteBg} onClick={() => setWhiteBg(!whiteBg)} />
            </RibbonGroup>

            <RibbonGroup label="Filter">
              <RibbonBtn icon={<Icon d={Lucide.layers} size={22} />} label="IFC Filter" />
            </RibbonGroup>

            <RibbonGroup label="Appearance">
              <RibbonBtn icon={<Icon d={Lucide.palette} size={22} />} label="Theme" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 8px' }}>
                <span style={{ fontSize: 9, color: Token.textMuted, textTransform: 'uppercase', letterSpacing: '0.3px' }}>Theme</span>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: 110, padding: '4px 8px', gap: 8,
                  background: 'rgba(217,119,6,0.05)', border: `1px solid ${Token.borderLight}`,
                  borderRadius: 3, fontSize: 11, color: Token.text,
                }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 2,
                                   background: 'linear-gradient(135deg, #3E3636 50%, #4A4242 50%)',
                                   border: `1px solid ${Token.borderLight}` }} />
                    <span>Default</span>
                  </span>
                  <Icon d={Lucide.caret} size={10} stroke={Token.textDim} />
                </div>
              </div>
            </RibbonGroup>

            <RibbonGroup label="Panels" lastChild>
              <RibbonBtn
                icon={<span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700 }}>IFC</span>}
                label="IFC Model"
                active={ifcOpen} onClick={() => setIfcOpen(!ifcOpen)} />
            </RibbonGroup>
          </div>
        )}

      </div>

      {/* ════════ FILE TAB BAR (h=30) ════════ */}
      <div className="flex items-stretch overflow-x-auto"
           style={{ height: 30, minHeight: 30, background: Token.surface,
                    borderBottom: `1px solid ${Token.border}` }}>
        {fileTabs.map((tab, i) => {
          const active = activeFileTab === tab.id;
          const next = fileTabs[i + 1];
          const nextActive = next && activeFileTab === next.id;
          return (
            <FileTab key={tab.id} name={tab.name} modified={tab.modified}
                     active={active} nextActive={nextActive}
                     onClick={() => setActiveFileTab(tab.id)} onClose={() => {}} />
          );
        })}
        <button
          className="flex items-center justify-center w-7"
          style={{ color: Token.textDim, fontSize: 14 }}
          onMouseEnter={(e) => e.currentTarget.style.color = Token.text}
          onMouseLeave={(e) => e.currentTarget.style.color = Token.textDim}
          title="New Document (Ctrl+N)"
        >+</button>
      </div>

      {/* ════════ MAIN BODY ════════ */}
      <div className="flex flex-1 min-h-0">

        {/* LEFT DOCK — NavigationPanel (Drawings + Sheets + Layers) */}
        <aside style={{
          background: Token.bg, width: 248, minWidth: 140, maxWidth: 500,
          borderRight: `1px solid ${Token.borderLight}`,
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Layers (Drawings + Sheets sections removed per viewer scope) */}
          <div className="flex flex-col" style={{ flex: layersOpen ? '2 1 0%' : '0 0 auto', minHeight: 0, overflow: 'hidden' }}>
            <SectionHeader label="Layers" sublabel={`${layers.length} layers · ${layers.filter(l => !l.visible).length} hidden`}
                           collapsed={!layersOpen} onToggle={() => setLayersOpen(!layersOpen)} />
            {layersOpen && (
              <>
                <div className="px-2 py-1 flex gap-3 text-[11px]" style={{ background: Token.bg }}>
                  <a className="cursor-pointer hover:underline" style={{ color: Token.textDim }}>Show all</a>
                  <a className="cursor-pointer hover:underline" style={{ color: Token.textDim }}>Hide all</a>
                  <span className="ml-auto" style={{ color: Token.textMuted }}>Read-only</span>
                </div>
                <div className="flex-1 overflow-auto">
                  {layers.map((l, i) => (
                    <LayerRow key={i} {...l} onToggle={() => {}} onLock={() => {}} />
                  ))}
                </div>
              </>
            )}
          </div>
        </aside>

        {/* CANVAS */}
        <div className="flex-1 relative" style={{ background: '#2A2424' }}>
          {/* Origin axis glyph */}
          <div className="absolute" style={{ left: 24, bottom: 24 }}>
            <svg width="64" height="64" viewBox="0 0 64 64">
              <line x1="12" y1="52" x2="56" y2="52" stroke="#FF4040" strokeWidth="2" />
              <polygon points="56,52 50,49 50,55" fill="#FF4040" />
              <line x1="12" y1="52" x2="12" y2="8" stroke="#66CC66" strokeWidth="2" />
              <polygon points="12,8 9,14 15,14" fill="#66CC66" />
              <text x="58" y="56" fill="#FF4040" fontSize="11">X</text>
              <text x="2"  y="10" fill="#66CC66" fontSize="11">Y</text>
              <circle cx="12" cy="52" r="2.5" fill={Token.textDim} />
            </svg>
          </div>

          {/* Placeholder text in center */}
          <div className="absolute inset-0 grid place-items-center text-[11px]"
               style={{ color: Token.textMuted }}>
            (canvas: wgpu renders DWG/DXF/IFC geometry here — 433,798 segments)
          </div>

          {/* ViewCube bottom-right */}
          <div className="absolute right-4 bottom-4 flex flex-col items-center text-[11px]"
               style={{ color: Token.text }}>
            <div>▲</div>
            <div className="flex items-center gap-1 my-1">
              <span>◀</span>
              <span className="w-7 h-7 rounded-full border grid place-items-center"
                    style={{ borderColor: Token.borderLight, background: Token.surface }}>⌂</span>
              <span>▶</span>
            </div>
            <div>▼</div>
            <div className="mt-1 text-[10px] font-mono" style={{ color: Token.textMuted }}>1:100</div>
          </div>

          {/* Tool options bar (top of canvas, like 1.0 ToolOptionsBar) */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1 rounded"
               style={{ background: Token.surface, border: `1px solid ${Token.border}`, fontSize: 11 }}>
            <span style={{ color: Token.textMuted }}>Tool:</span>
            <span style={{ color: Token.accent, fontFamily: 'monospace', textTransform: 'uppercase' }}>{activeTool}</span>
            <span className="mx-2" style={{ color: Token.textDim }}>—</span>
            <span style={{ color: Token.textDim }}>Click element to inspect</span>
          </div>
        </div>

        {/* RIGHT DOCK — Properties */}
        {rightOpen && (
          <aside style={{
            background: Token.bg, width: 340, minWidth: 180, maxWidth: 500,
            borderLeft: `1px solid ${Token.borderLight}`,
            display: 'flex', flexDirection: 'column',
          }}>
            <SectionHeader label="Properties" sublabel="Inspect"
                           collapsed={false} onToggle={() => setRightOpen(false)} />
            <div className="flex-1 overflow-auto p-3">
              <div style={{ fontSize: 11, color: Token.textMuted, marginBottom: 12 }}>
                Tab: 2705_model Funderingsherstel ▸ Constructie ▸ Sheet ▸ CP-21 ▸
                <br /><span style={{ color: Token.textDim }}>Constructietekening.dwg · 433,798 segs</span>
              </div>

              <div style={{ background: Token.surface, padding: 10, borderRadius: 4,
                            border: `1px solid ${Token.borderLight}`, marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: Token.text, marginBottom: 4, fontWeight: 500 }}>No selection</div>
                <div style={{ fontSize: 11, color: Token.textDim }}>Click a line segment or IFC element to inspect.</div>
              </div>

              {/* Sample property group — collapsed sections like 1.0 PropertyGroup */}
              <div style={{ marginBottom: 8 }}>
                <div className="flex items-center gap-1 px-1 py-1"
                     style={{ borderBottom: `1px solid ${Token.borderLight}` }}>
                  <Icon d={Lucide.chevD} size={12} stroke={Token.textDim} />
                  <span style={{ fontSize: 11, color: Token.text, fontWeight: 500, textTransform: 'uppercase' }}>Drawing</span>
                </div>
                <div style={{ padding: '6px 4px' }}>
                  {[
                    ['Name',  'Constructietekening'],
                    ['Type',  'Stand Alone (DWG)'],
                    ['Scale', '1:100'],
                    ['Units', 'mm'],
                    ['Layers','21'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between text-[11px]" style={{ padding: '3px 0' }}>
                      <span style={{ color: Token.textDim }}>{k}</span>
                      <span style={{ color: Token.text, fontFamily: 'Consolas, monospace' }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1 px-1 py-1"
                     style={{ borderBottom: `1px solid ${Token.borderLight}` }}>
                  <Icon d={Lucide.chevR} size={12} stroke={Token.textDim} />
                  <span style={{ fontSize: 11, color: Token.text, fontWeight: 500, textTransform: 'uppercase' }}>IFC</span>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* ════════ LAYOUT (Model / Layout1 / +) — under canvas above status ════════ */}
      <div className="flex items-stretch" style={{
        background: Token.bg, height: 22,
        borderTop: `1px solid ${Token.borderLight}`,
      }}>
        <div className="px-3 grid place-items-center text-xs cursor-default"
             style={{ background: Token.surface, color: Token.text,
                      borderRight: `1px solid ${Token.borderLight}` }}>Model</div>
        <div className="px-3 grid place-items-center text-xs cursor-default"
             style={{ color: Token.textDim, borderRight: `1px solid ${Token.borderLight}` }}>Layout1</div>
        <div className="px-3 grid place-items-center text-xs cursor-default"
             style={{ color: Token.textDim, borderRight: `1px solid ${Token.borderLight}` }}>+</div>
      </div>

      {/* ════════ STATUS BAR (h=24) ════════ */}
      <div className="flex items-center px-3 text-xs" style={{
        height: 24, background: Token.surface, color: Token.textDim,
        borderTop: `1px solid ${Token.borderLight}`, gap: 24,
      }}>
        {/* Cursor coords (left cluster) */}
        <div className="flex items-center gap-2">
          <span>X:</span>
          <span style={{ color: Token.text, fontFamily: 'Consolas, monospace', width: 64, textAlign: 'right' }}>1309 mm</span>
          <span>Y:</span>
          <span style={{ color: Token.text, fontFamily: 'Consolas, monospace', width: 64, textAlign: 'right' }}>26965 mm</span>
        </div>

        {/* Scale / zoom (centre cluster) */}
        <StatusItem label="Zoom" value="74%" mono />
        <StatusItem label="Grid" value="100 mm" mono />
        <div className="flex items-center gap-2">
          <span>Scale:</span>
          <select className="px-1 py-0 outline-none" style={{
            background: 'rgba(217,119,6,0.05)', border: `1px solid ${Token.borderLight}`,
            color: Token.text, fontSize: 11, height: 18,
          }}>
            <option>1:100</option><option>1:50</option><option>1:20</option><option>1:10</option>
          </select>
        </div>

        {/* Linked storey */}
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-medium px-1 rounded"
                style={{ background: 'rgba(96,165,250,0.30)', color: '#bfdbfe' }}>PL</span>
          <span className="text-xs" style={{ color: Token.text }}>Begane grond (+0mm)</span>
        </div>

        {/* Layer selector */}
        <button className="flex items-center gap-1.5 px-2 py-0.5 rounded">
          <Icon d={Lucide.layers} size={12} stroke={Token.textDim} />
          <span style={{ width: 12, height: 12, borderRadius: 2, background: '#FF4040',
                         border: `1px solid ${Token.borderLight}` }} />
          <span style={{ color: Token.text, fontWeight: 500 }}>A--L$1--_Algemeen</span>
          <Icon d={Lucide.caret} size={10} stroke={Token.textDim} />
        </button>

        {/* Ortho toggle */}
        <StatusBtn active={ortho} accent="green" onClick={() => setOrtho(!ortho)} title="Ortho Mode [F8]">
          ORTHO
        </StatusBtn>

        {/* OSNAP strip — End/Mid/Cen on default, Int/Per/Near off default. */}
        <div className="flex items-center gap-1">
          <span style={{ fontSize: 10, letterSpacing: 0.5, color: Token.textMuted, marginRight: 4 }}>OSNAP</span>
          {Object.entries(snaps).map(([k, v]) => (
            <button
              key={k}
              onClick={() => setSnaps((s) => ({ ...s, [k]: !s[k] }))}
              title={({
                End: 'Endpoint',  Mid: 'Midpoint',  Cen: 'Center',
                Int: 'Intersection', Per: 'Perpendicular', Near: 'Nearest',
              })[k]}
              style={{
                padding: '0 6px', height: 18, fontSize: 10,
                letterSpacing: 0.4, textTransform: 'uppercase',
                borderRadius: 2,
                background: v ? Token.accent : 'transparent',
                color: v ? '#fff' : Token.textDim,
                border: `1px solid ${v ? Token.accent : Token.borderLight}`,
                cursor: 'pointer',
              }}
            >
              {k}
            </button>
          ))}
        </div>

        {/* View mode */}
        <select className="px-1 py-0.5 rounded font-mono outline-none" style={{
          background: Token.surface, border: `1px solid ${Token.borderLight}`,
          color: Token.text, fontSize: 11,
        }}>
          <option>Hidden Line</option>
          <option>White Background</option>
          <option>Transparent</option>
        </select>

        {/* Tool */}
        <div className="flex items-center gap-2">
          <span>Tool:</span>
          <span style={{ color: Token.accent, fontFamily: 'monospace', textTransform: 'uppercase' }}>{activeTool}</span>
        </div>

        <div className="flex-1" />

        {/* Right cluster: terminal, ifc, selected, fps */}
        <button className="p-1 rounded" style={{ color: Token.textDim }} title="Toggle Terminal [Ctrl+`]">
          <Icon d={Lucide.terminal} size={14} />
        </button>
        <StatusBtn active={ifcOpen} onClick={() => setIfcOpen(!ifcOpen)} title="Toggle IFC Model Panel">IFC</StatusBtn>
        <StatusItem label="Selected" value="0" mono />
        <StatusItem label="Objects" value="12,431" mono />
        <div className="flex items-center gap-1.5">
          <span style={{ fontFamily: 'monospace', color: '#4ade80', fontWeight: 500 }}>60</span>
          <span style={{ color: Token.textDim }}>FPS</span>
        </div>
      </div>
    </div>
  );
}

// Babel-standalone re-exports the component to window via index.html
// eslint-disable-next-line no-undef
window.__Mockup = Open2DViewerMockup;
