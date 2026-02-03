/**
 * DraggableModal - Reusable modal component with consistent styling and drag functionality
 */

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface DraggableModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  width?: number;
  height?: number;
  children: ReactNode;
  footer?: ReactNode;
  zIndex?: number;
}

export function DraggableModal({
  isOpen,
  onClose,
  title,
  icon,
  width = 500,
  height,
  children,
  footer,
  zIndex = 50,
}: DraggableModalProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const modalRef = useRef<HTMLDivElement>(null);

  // Reset position when modal opens
  useEffect(() => {
    if (isOpen) {
      setPosition({ x: 0, y: 0 });
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center"
      style={{ zIndex }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        ref={modalRef}
        className="bg-cad-surface border border-cad-border shadow-xl flex flex-col"
        style={{
          width,
          height,
          transform: `translate(${position.x}px, ${position.y}px)`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b border-cad-border select-none"
          style={{ background: 'linear-gradient(to bottom, #ffffff, #f5f5f5)', borderColor: '#d4d4d4' }}
          onMouseDown={handleMouseDown}
        >
          <h2 className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
            {icon}
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-0.5 hover:bg-cad-hover rounded transition-colors text-gray-600 hover:text-gray-800 cursor-default -mr-1"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-3 py-2 border-t border-cad-border flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// Standardized button styles for modal footers
export function ModalButton({
  onClick,
  variant = 'secondary',
  disabled,
  children,
}: {
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  children: ReactNode;
}) {
  const baseClasses = 'px-3 py-1 text-xs transition-colors';
  const variantClasses = variant === 'primary'
    ? 'bg-cad-accent text-white hover:bg-cad-accent/80 disabled:bg-cad-input disabled:text-cad-text-dim'
    : 'bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClasses}`}
    >
      {children}
    </button>
  );
}
