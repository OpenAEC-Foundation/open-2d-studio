import { X } from 'lucide-react';

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AboutDialog({ isOpen, onClose }: AboutDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-cad-surface border border-cad-border rounded-lg shadow-xl w-80">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-cad-border">
          <h2 className="text-sm font-semibold">About</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-cad-border rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col items-center text-center">
          <h1 className="text-xl font-bold text-cad-text mb-1">Open 2D Studio</h1>
          <p className="text-sm text-cad-text-dim mb-4">Version 0.4.0</p>

          <p className="text-sm text-cad-text-dim mb-4">
            A cross-platform 2D CAD application
          </p>

          <a
            href="https://impertio.nl/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-cad-accent hover:underline mb-4"
          >
            impertio.nl
          </a>

          <p className="text-xs text-cad-text-dim">
            © 2025 Impertio. All rights reserved.
          </p>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-cad-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-cad-accent text-white rounded hover:bg-cad-accent/80 transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
