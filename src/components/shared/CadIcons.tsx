/**
 * Custom CAD Icons for drawing tools
 */

interface IconProps {
  size?: number;
  className?: string;
}

/**
 * Line Icon - A diagonal line with endpoint markers
 */
export function LineIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Diagonal line from bottom-left to top-right */}
      <line x1="4" y1="20" x2="20" y2="4" />
      {/* Endpoint markers */}
      <circle cx="4" cy="20" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="20" cy="4" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Arc Icon - A curved line segment with endpoint markers
 */
export function ArcIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Arc curve from bottom-left to top-right */}
      <path d="M4 20 Q 4 4, 20 4" />
      {/* Small endpoint markers */}
      <circle cx="4" cy="20" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="20" cy="4" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Polyline Icon - Connected line segments with vertex markers
 */
export function PolylineIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Connected line segments */}
      <polyline points="3,18 8,6 14,16 21,4" />
      {/* Vertex markers */}
      <circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="8" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="14" cy="16" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="21" cy="4" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Spline Icon - Smooth curve through control points
 */
export function SplineIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Smooth S-curve */}
      <path d="M3 18 C 6 18, 8 6, 12 6 S 18 18, 21 6" />
      {/* Control point markers */}
      <circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="21" cy="6" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Ellipse Icon - Elliptical shape
 */
export function EllipseIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <ellipse cx="12" cy="12" rx="9" ry="5" />
    </svg>
  );
}

/**
 * Split Icon - Line with break point
 */
export function SplitIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Two line segments with gap */}
      <line x1="3" y1="12" x2="9" y2="12" />
      <line x1="15" y1="12" x2="21" y2="12" />
      {/* Break indicator */}
      <circle cx="12" cy="12" r="2" />
      <line x1="12" y1="6" x2="12" y2="9" />
      <line x1="12" y1="15" x2="12" y2="18" />
    </svg>
  );
}

/**
 * Array Icon - Multiple copies in pattern
 */
export function ArrayIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Grid of rectangles */}
      <rect x="3" y="3" width="5" height="5" />
      <rect x="10" y="3" width="5" height="5" />
      <rect x="17" y="3" width="5" height="5" />
      <rect x="3" y="10" width="5" height="5" opacity="0.5" />
      <rect x="10" y="10" width="5" height="5" opacity="0.5" />
    </svg>
  );
}

/**
 * Align Icon - Elements aligned to reference
 */
export function AlignIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Alignment reference line */}
      <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="2 2" />
      {/* Elements being aligned */}
      <rect x="4" y="6" width="6" height="4" />
      <rect x="14" y="14" width="6" height="4" />
      {/* Arrows showing alignment direction */}
      <path d="M7 13 L12 13" />
      <path d="M17 11 L12 11" />
    </svg>
  );
}

/**
 * Fillet Icon - Rounded corner between two lines
 */
export function FilletIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Vertical line */}
      <line x1="4" y1="20" x2="4" y2="10" />
      {/* Rounded corner arc */}
      <path d="M4 10 Q 4 4, 10 4" strokeWidth="3" />
      {/* Horizontal line */}
      <line x1="10" y1="4" x2="20" y2="4" />
    </svg>
  );
}

/**
 * Chamfer Icon - Angled corner cut
 */
export function ChamferIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* L-shape with chamfered corner */}
      <path d="M4 20 L4 10 L10 4 L20 4" />
      {/* Chamfer line highlighted */}
      <line x1="4" y1="10" x2="10" y2="4" strokeWidth="3" />
    </svg>
  );
}

/**
 * Extend Icon - Line extending to boundary
 */
export function ExtendIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Boundary line */}
      <line x1="20" y1="4" x2="20" y2="20" />
      {/* Original line */}
      <line x1="4" y1="12" x2="12" y2="12" />
      {/* Extended portion (dashed) */}
      <line x1="12" y1="12" x2="20" y2="12" strokeDasharray="3 2" />
      {/* Arrow indicating extension */}
      <polyline points="16,9 20,12 16,15" />
    </svg>
  );
}

/**
 * Scale Icon - Resize with reference
 */
export function ScaleIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Small rectangle */}
      <rect x="4" y="12" width="6" height="6" />
      {/* Larger rectangle (scaled) */}
      <rect x="8" y="4" width="12" height="12" opacity="0.5" />
      {/* Scale arrows */}
      <path d="M6 10 L6 6 L10 6" />
    </svg>
  );
}

/**
 * Offset Icon - Parallel copy at distance
 */
export function OffsetIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Original line */}
      <line x1="4" y1="16" x2="20" y2="16" />
      {/* Offset line */}
      <line x1="4" y1="8" x2="20" y2="8" strokeDasharray="3 2" />
      {/* Distance indicator */}
      <line x1="12" y1="8" x2="12" y2="16" strokeWidth="1" />
      <polyline points="10,10 12,8 14,10" strokeWidth="1" />
      <polyline points="10,14 12,16 14,14" strokeWidth="1" />
    </svg>
  );
}

/**
 * Filled Region Icon - Hatched area
 */
export function FilledRegionIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Boundary */}
      <rect x="4" y="4" width="16" height="16" />
      {/* Hatch lines */}
      <line x1="4" y1="10" x2="10" y2="4" strokeWidth="1" />
      <line x1="4" y1="16" x2="16" y2="4" strokeWidth="1" />
      <line x1="8" y1="20" x2="20" y2="8" strokeWidth="1" />
      <line x1="14" y1="20" x2="20" y2="14" strokeWidth="1" />
    </svg>
  );
}

/**
 * Detail Component Icon - Reusable 2D symbol
 */
export function DetailComponentIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Component boundary */}
      <rect x="4" y="4" width="16" height="16" rx="1" />
      {/* Component symbol inside */}
      <circle cx="12" cy="10" r="3" />
      <line x1="12" y1="13" x2="12" y2="17" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  );
}

/**
 * Insulation Icon - Wavy insulation pattern
 */
export function InsulationIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Wavy insulation pattern */}
      <path d="M3 8 Q 6 4, 9 8 T 15 8 T 21 8" />
      <path d="M3 16 Q 6 12, 9 16 T 15 16 T 21 16" />
      {/* Boundary lines */}
      <line x1="3" y1="4" x2="3" y2="20" strokeWidth="1" />
      <line x1="21" y1="4" x2="21" y2="20" strokeWidth="1" />
    </svg>
  );
}

// ============================================================================
// Structural Engineering Icons
// ============================================================================

/** Beam Icon - Horizontal beam with supports */
export function BeamIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="9" width="20" height="4" />
      <line x1="2" y1="9" x2="2" y2="13" strokeWidth="2.5" />
      <line x1="22" y1="9" x2="22" y2="13" strokeWidth="2.5" />
    </svg>
  );
}

/** Column Icon - Vertical structural column */
export function ColumnIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="8" y="2" width="8" height="20" />
      <line x1="8" y1="2" x2="16" y2="2" strokeWidth="2.5" />
      <line x1="8" y1="22" x2="16" y2="22" strokeWidth="2.5" />
    </svg>
  );
}

/** Wall Icon - Structural wall */
export function WallIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4" width="18" height="16" />
      {/* Brick pattern */}
      <line x1="3" y1="10" x2="21" y2="10" strokeWidth="1" />
      <line x1="3" y1="16" x2="21" y2="16" strokeWidth="1" />
      <line x1="12" y1="4" x2="12" y2="10" strokeWidth="1" />
      <line x1="7" y1="10" x2="7" y2="16" strokeWidth="1" />
      <line x1="17" y1="10" x2="17" y2="16" strokeWidth="1" />
      <line x1="12" y1="16" x2="12" y2="20" strokeWidth="1" />
    </svg>
  );
}

/** Slab Icon - Floor/slab cross-section */
export function SlabIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="8" width="20" height="5" />
      {/* Hatch pattern */}
      <line x1="5" y1="8" x2="2" y2="13" strokeWidth="1" />
      <line x1="9" y1="8" x2="6" y2="13" strokeWidth="1" />
      <line x1="13" y1="8" x2="10" y2="13" strokeWidth="1" />
      <line x1="17" y1="8" x2="14" y2="13" strokeWidth="1" />
      <line x1="21" y1="8" x2="18" y2="13" strokeWidth="1" />
      {/* Support indicators */}
      <line x1="2" y1="15" x2="6" y2="15" strokeWidth="1" opacity="0.5" />
      <line x1="18" y1="15" x2="22" y2="15" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

/** Foundation Icon - Pad/strip foundation */
export function FoundationIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Column stub */}
      <rect x="9" y="4" width="6" height="8" />
      {/* Footing */}
      <rect x="3" y="12" width="18" height="5" />
      {/* Ground hatch */}
      <line x1="3" y1="19" x2="7" y2="21" strokeWidth="1" />
      <line x1="8" y1="19" x2="12" y2="21" strokeWidth="1" />
      <line x1="13" y1="19" x2="17" y2="21" strokeWidth="1" />
      <line x1="18" y1="19" x2="22" y2="21" strokeWidth="1" />
    </svg>
  );
}

/** Brace Icon - Diagonal bracing */
export function BraceIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Frame */}
      <line x1="4" y1="4" x2="4" y2="20" strokeWidth="1.5" opacity="0.4" />
      <line x1="20" y1="4" x2="20" y2="20" strokeWidth="1.5" opacity="0.4" />
      <line x1="4" y1="4" x2="20" y2="4" strokeWidth="1.5" opacity="0.4" />
      <line x1="4" y1="20" x2="20" y2="20" strokeWidth="1.5" opacity="0.4" />
      {/* X-bracing */}
      <line x1="4" y1="4" x2="20" y2="20" strokeWidth="2" />
      <line x1="20" y1="4" x2="4" y2="20" strokeWidth="2" />
    </svg>
  );
}

/** Truss Icon - Triangulated truss */
export function TrussIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Top chord */}
      <line x1="2" y1="8" x2="22" y2="8" strokeWidth="2" />
      {/* Bottom chord */}
      <line x1="2" y1="18" x2="22" y2="18" strokeWidth="2" />
      {/* Verticals */}
      <line x1="2" y1="8" x2="2" y2="18" />
      <line x1="7" y1="8" x2="7" y2="18" />
      <line x1="12" y1="8" x2="12" y2="18" />
      <line x1="17" y1="8" x2="17" y2="18" />
      <line x1="22" y1="8" x2="22" y2="18" />
      {/* Diagonals */}
      <line x1="2" y1="18" x2="7" y2="8" />
      <line x1="7" y1="18" x2="12" y2="8" />
      <line x1="12" y1="18" x2="17" y2="8" />
      <line x1="17" y1="18" x2="22" y2="8" />
    </svg>
  );
}

/** Pin Support Icon - Triangle support */
export function PinSupportIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Beam stub */}
      <line x1="4" y1="8" x2="20" y2="8" opacity="0.4" />
      {/* Triangle */}
      <polygon points="12,8 6,18 18,18" fill="none" />
      {/* Ground line */}
      <line x1="4" y1="18" x2="20" y2="18" />
      {/* Hatch below ground */}
      <line x1="6" y1="18" x2="4" y2="21" strokeWidth="1" />
      <line x1="10" y1="18" x2="8" y2="21" strokeWidth="1" />
      <line x1="14" y1="18" x2="12" y2="21" strokeWidth="1" />
      <line x1="18" y1="18" x2="16" y2="21" strokeWidth="1" />
    </svg>
  );
}

/** Roller Support Icon - Circle on ground */
export function RollerSupportIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Beam stub */}
      <line x1="4" y1="8" x2="20" y2="8" opacity="0.4" />
      {/* Triangle */}
      <polygon points="12,8 6,16 18,16" fill="none" />
      {/* Rollers */}
      <circle cx="8" cy="18" r="2" />
      <circle cx="16" cy="18" r="2" />
      {/* Ground line */}
      <line x1="4" y1="20" x2="20" y2="20" />
    </svg>
  );
}

/** Fixed Support Icon - Built-in support */
export function FixedSupportIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Beam stub */}
      <line x1="8" y1="4" x2="20" y2="4" opacity="0.4" />
      {/* Wall */}
      <line x1="8" y1="2" x2="8" y2="22" strokeWidth="2.5" />
      {/* Hatch lines */}
      <line x1="8" y1="4" x2="4" y2="6" strokeWidth="1.5" />
      <line x1="8" y1="8" x2="4" y2="10" strokeWidth="1.5" />
      <line x1="8" y1="12" x2="4" y2="14" strokeWidth="1.5" />
      <line x1="8" y1="16" x2="4" y2="18" strokeWidth="1.5" />
      <line x1="8" y1="20" x2="4" y2="22" strokeWidth="1.5" />
    </svg>
  );
}

/** Point Load Icon - Concentrated force arrow */
export function PointLoadIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Beam */}
      <line x1="2" y1="18" x2="22" y2="18" opacity="0.4" />
      {/* Force arrow */}
      <line x1="12" y1="3" x2="12" y2="18" strokeWidth="2" />
      <polygon points="12,18 9,12 15,12" fill="currentColor" stroke="none" />
      {/* P label */}
      <text x="16" y="8" fontSize="6" fill="currentColor" stroke="none" fontWeight="bold" fontFamily="sans-serif">P</text>
    </svg>
  );
}

/** Distributed Load Icon - UDL arrows */
export function DistributedLoadIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Beam */}
      <line x1="2" y1="18" x2="22" y2="18" opacity="0.4" />
      {/* Top line */}
      <line x1="4" y1="5" x2="20" y2="5" strokeWidth="1.5" />
      {/* Arrows */}
      <line x1="5" y1="5" x2="5" y2="17" strokeWidth="1" />
      <polygon points="5,17 3.5,13 6.5,13" fill="currentColor" stroke="none" />
      <line x1="9" y1="5" x2="9" y2="17" strokeWidth="1" />
      <polygon points="9,17 7.5,13 10.5,13" fill="currentColor" stroke="none" />
      <line x1="12" y1="5" x2="12" y2="17" strokeWidth="1" />
      <polygon points="12,17 10.5,13 13.5,13" fill="currentColor" stroke="none" />
      <line x1="15" y1="5" x2="15" y2="17" strokeWidth="1" />
      <polygon points="15,17 13.5,13 16.5,13" fill="currentColor" stroke="none" />
      <line x1="19" y1="5" x2="19" y2="17" strokeWidth="1" />
      <polygon points="19,17 17.5,13 20.5,13" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Moment Load Icon - Curved moment arrow */
export function MomentLoadIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Curved arrow */}
      <path d="M 8 6 A 6 6 0 1 1 8 18" fill="none" />
      <polyline points="5,5 8,6 8,3" fill="currentColor" strokeWidth="1.5" />
      {/* M label */}
      <text x="13" y="14" fontSize="7" fill="currentColor" stroke="none" fontWeight="bold" fontFamily="sans-serif">M</text>
    </svg>
  );
}

/** Rebar Icon - Reinforcement bar */
export function RebarIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Bar with hooks */}
      <path d="M4 6 L4 18 L20 18 L20 6" fill="none" />
      {/* Cross-section dots */}
      <circle cx="4" cy="6" r="2" fill="currentColor" />
      <circle cx="20" cy="6" r="2" fill="currentColor" />
      {/* Stirrup */}
      <rect x="8" y="8" width="8" height="8" strokeDasharray="2 1" strokeWidth="1" />
    </svg>
  );
}

/** Grid Line Icon - Structural grid */
export function GridLineIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Circle with label at top */}
      <circle cx="12" cy="5" r="4" />
      <text x="12" y="7" fontSize="5" fill="currentColor" stroke="none" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle">A</text>
      {/* Vertical grid line */}
      <line x1="12" y1="9" x2="12" y2="22" strokeDasharray="4 2" />
    </svg>
  );
}

/** Steel Section Icon - I-beam profile */
export function SteelSectionIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* I-beam cross section */}
      {/* Top flange */}
      <line x1="4" y1="4" x2="20" y2="4" strokeWidth="2.5" />
      {/* Web */}
      <line x1="12" y1="4" x2="12" y2="20" strokeWidth="2" />
      {/* Bottom flange */}
      <line x1="4" y1="20" x2="20" y2="20" strokeWidth="2.5" />
    </svg>
  );
}

/** Connection Icon - Bolt/weld connection */
export function ConnectionIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Two plates */}
      <rect x="2" y="8" width="9" height="8" />
      <rect x="13" y="8" width="9" height="8" />
      {/* Bolts */}
      <circle cx="6" cy="12" r="1.5" fill="currentColor" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" />
      {/* Gusset plate overlap indicator */}
      <line x1="11" y1="6" x2="13" y2="6" strokeWidth="1" opacity="0.5" />
      <line x1="11" y1="18" x2="13" y2="18" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

// ============================================================================
// Dimension Icons
// ============================================================================

/**
 * Aligned Dimension Icon - Dimension parallel to measured points
 */
export function AlignedDimensionIcon({ size = 24, className }: IconProps) {
  // Two angled reference walls with a dimension line measuring between them
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Two angled reference lines (walls) — going bottom-left to top-right */}
      <line x1="1" y1="22" x2="6" y2="14" strokeWidth="2" opacity="0.3" />
      <line x1="14" y1="10" x2="19" y2="2" strokeWidth="2" opacity="0.3" />
      {/* Extension lines — short perpendicular lines from each wall to dimension line */}
      <line x1="4" y1="17" x2="7" y2="18.5" strokeWidth="0.75" opacity="0.5" />
      <line x1="17" y1="5" x2="20" y2="6.5" strokeWidth="0.75" opacity="0.5" />
      {/* Dimension line between the two walls — split for text */}
      <line x1="5.5" y1="17.8" x2="9" y2="15.5" strokeWidth="1.5" />
      <line x1="14" y1="11.5" x2="18.5" y2="5.8" strokeWidth="1.5" />
      {/* Filled arrowheads */}
      <polygon points="5.5,17.8 7.6,17.6 7.1,15.7" fill="currentColor" stroke="none" />
      <polygon points="18.5,5.8 16.4,6 16.9,7.9" fill="currentColor" stroke="none" />
      {/* Dimension value */}
      <text x="12" y="14.5" fill="currentColor" stroke="none" fontSize="5" fontWeight="600" fontFamily="sans-serif" textAnchor="middle">24</text>
    </svg>
  );
}

/**
 * Linear Dimension Icon - Horizontal/Vertical dimension
 */
export function LinearDimensionIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Vertical extension lines */}
      <line x1="4" y1="20" x2="4" y2="7" strokeWidth="0.75" opacity="0.45" />
      <line x1="20" y1="20" x2="20" y2="7" strokeWidth="0.75" opacity="0.45" />
      {/* Horizontal dimension line */}
      <line x1="4" y1="10" x2="10" y2="10" strokeWidth="1.5" />
      <line x1="14" y1="10" x2="20" y2="10" strokeWidth="1.5" />
      {/* Filled arrowheads */}
      <polygon points="4,10 7,8.8 7,11.2" fill="currentColor" stroke="none" />
      <polygon points="20,10 17,8.8 17,11.2" fill="currentColor" stroke="none" />
      {/* Dimension value */}
      <text x="12" y="12" fill="currentColor" stroke="none" fontSize="5.5" fontWeight="600" fontFamily="sans-serif" textAnchor="middle">16</text>
    </svg>
  );
}

/**
 * Angular Dimension Icon - Angle measurement with arc
 */
export function AngularDimensionIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Two lines forming angle */}
      <line x1="4" y1="20" x2="20" y2="20" />
      <line x1="4" y1="20" x2="16" y2="4" />
      {/* Vertex point */}
      <circle cx="4" cy="20" r="1.5" fill="currentColor" stroke="none" />
      {/* Dimension arc */}
      <path d="M 12 20 A 8 8 0 0 1 9.5 12" fill="none" />
      {/* Angle text */}
      <text x="13" y="15" fontSize="5" fill="currentColor" textAnchor="middle" stroke="none">45°</text>
    </svg>
  );
}

/**
 * Radius Dimension Icon - Radius with R symbol
 */
export function RadiusDimensionIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Arc/circle segment */}
      <path d="M 20 12 A 8 8 0 0 1 12 20" fill="none" />
      {/* Center point */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      {/* Center mark */}
      <line x1="10" y1="12" x2="14" y2="12" strokeWidth="1" />
      <line x1="12" y1="10" x2="12" y2="14" strokeWidth="1" />
      {/* Radius line */}
      <line x1="12" y1="12" x2="18" y2="18" />
      {/* Arrow at end */}
      <polyline points="16,16 18,18 16,18" fill="currentColor" strokeWidth="1" />
      {/* R text */}
      <text x="8" y="8" fontSize="6" fill="currentColor" textAnchor="middle" stroke="none" fontWeight="bold">R</text>
    </svg>
  );
}

/**
 * Diameter Dimension Icon - Diameter with ⌀ symbol
 */
export function DiameterDimensionIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Circle */}
      <circle cx="12" cy="12" r="8" />
      {/* Diameter line through center */}
      <line x1="5" y1="17" x2="19" y2="7" />
      {/* Center point */}
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      {/* Arrows at both ends */}
      <polyline points="7,15 5,17 7,17" fill="currentColor" strokeWidth="1" />
      <polyline points="17,9 19,7 17,7" fill="currentColor" strokeWidth="1" />
      {/* Diameter symbol ⌀ */}
      <text x="18" y="20" fontSize="6" fill="currentColor" textAnchor="middle" stroke="none" fontWeight="bold">⌀</text>
    </svg>
  );
}
