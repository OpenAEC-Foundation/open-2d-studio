import { useState, useEffect } from 'react';

const STORAGE_KEY = 'tablet-gesture-hints-seen';

interface GestureHintsProps {
  forceShow?: boolean;
  onDismiss: () => void;
}

const hints = [
  {
    title: 'Pan',
    description: '1-finger drag to move around',
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="24" cy="20" r="8" opacity="0.3" />
        <path d="M24 20L32 28" strokeDasharray="4 3">
          <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="1.5s" repeatCount="indefinite" />
        </path>
        <circle cx="24" cy="20" r="3" fill="currentColor" opacity="0.6">
          <animateMotion dur="1.5s" repeatCount="indefinite" path="M0,0 L8,8" />
        </circle>
      </svg>
    ),
  },
  {
    title: 'Zoom',
    description: '2-finger pinch to zoom in/out',
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="24" r="3" fill="currentColor" opacity="0.6">
          <animate attributeName="cx" values="18;14;18" dur="1.5s" repeatCount="indefinite" />
        </circle>
        <circle cx="30" cy="24" r="3" fill="currentColor" opacity="0.6">
          <animate attributeName="cx" values="30;34;30" dur="1.5s" repeatCount="indefinite" />
        </circle>
        <path d="M18 24L14 24" opacity="0.4">
          <animate attributeName="d" values="M18 24L14 24;M14 24L10 24;M18 24L14 24" dur="1.5s" repeatCount="indefinite" />
        </path>
        <path d="M30 24L34 24" opacity="0.4">
          <animate attributeName="d" values="M30 24L34 24;M34 24L38 24;M30 24L34 24" dur="1.5s" repeatCount="indefinite" />
        </path>
      </svg>
    ),
  },
  {
    title: 'Fit All',
    description: 'Double-tap to fit drawing',
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="24" cy="24" r="4" fill="currentColor" opacity="0.6">
          <animate attributeName="r" values="4;6;4;6;4" dur="1.5s" repeatCount="indefinite" />
        </circle>
        <rect x="10" y="10" width="28" height="28" rx="3" opacity="0.3">
          <animate attributeName="opacity" values="0.3;0.6;0.3" dur="1.5s" repeatCount="indefinite" />
        </rect>
      </svg>
    ),
  },
  {
    title: 'Context Menu',
    description: 'Long-press for quick actions',
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="24" cy="24" r="4" fill="currentColor" opacity="0.6" />
        <circle cx="24" cy="24" r="12" opacity="0.2">
          <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="24" cy="10" r="2" fill="currentColor" opacity="0.4">
          <animate attributeName="opacity" values="0;0.6;0.6" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="36" cy="18" r="2" fill="currentColor" opacity="0.4">
          <animate attributeName="opacity" values="0;0;0.6" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="36" cy="30" r="2" fill="currentColor" opacity="0.4">
          <animate attributeName="opacity" values="0;0;0.6" dur="2s" repeatCount="indefinite" />
        </circle>
      </svg>
    ),
  },
];

export function GestureHints({ forceShow, onDismiss }: GestureHintsProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (forceShow) {
      setVisible(true);
      return;
    }
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      setVisible(true);
    }
  }, [forceShow]);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
    onDismiss();
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      style={{ zIndex: 100 }}
      onClick={handleDismiss}
    >
      <div
        className="max-w-sm w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-white text-lg font-semibold text-center mb-4">Touch Gestures</h2>

        <div className="grid grid-cols-2 gap-3">
          {hints.map(hint => (
            <div
              key={hint.title}
              className="bg-white/10 rounded-xl p-4 flex flex-col items-center text-center"
            >
              <div className="text-white/80 mb-2">{hint.icon}</div>
              <span className="text-white text-sm font-medium">{hint.title}</span>
              <span className="text-gray-400 text-xs mt-1">{hint.description}</span>
            </div>
          ))}
        </div>

        <button
          onClick={handleDismiss}
          className="mt-4 w-full py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
