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
  /** Extra content rendered in the header row between the title and close button */
  headerContent?: ReactNode;
  width?: number;
  height?: number;
  /** Maximum height constraint – the modal will not grow beyond this value (CSS maxHeight) */
  maxHeight?: number | string;
  children: ReactNode;
  footer?: ReactNode;
  /** Custom className for the footer wrapper (default: 'px-3 py-2 border-t border-cad-border flex justify-end gap-2') */
  footerClassName?: string;
  zIndex?: number;
  resizable?: boolean;
  minWidth?: number;
  minHeight?: number;
}

export function DraggableModal({
  isOpen,
  onClose,
  title,
  icon,
  headerContent,
  width = 500,
  height,
  maxHeight,
  children,
  footer,
  footerClassName,
  zIndex = 50,
  resizable = false,
  minWidth = 300,
  minHeight = 200,
}: DraggableModalProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [size, setSize] = useState({ width: width, height: height || 400 });
  const dragStartRef = useRef({ x: 0, y: 0 });
  const resizeStartRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const modalRef = useRef<HTMLDivElement>(null);

  // Reset position and size when modal opens
  useEffect(() => {
    if (isOpen) {
      setPosition({ x: 0, y: 0 });
      setSize({ width: width, height: height || 400 });
    }
  }, [isOpen, width, height]);

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
    if (isResizing) {
      const newW = Math.max(minWidth, resizeStartRef.current.w + (e.clientX - resizeStartRef.current.x));
      const newH = Math.max(minHeight, resizeStartRef.current.h + (e.clientY - resizeStartRef.current.y));
      setSize({ width: newW, height: newH });
      return;
    }
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  }, [isDragging, isResizing, minWidth, minHeight]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
  }, []);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    resizeStartRef.current = { x: e.clientX, y: e.clientY, w: size.width, h: size.height };
  }, [size]);

  if (!isOpen) return null;

  const currentWidth = resizable ? size.width : width;
  const currentHeight = resizable ? size.height : height;

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
        className="bg-cad-surface border border-cad-border shadow-xl flex flex-col relative"
        style={{
          width: currentWidth,
          height: currentHeight,
          maxHeight: maxHeight,
          transform: `translate(${position.x}px, ${position.y}px)`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center border-b border-cad-border select-none"
          style={{ background: 'linear-gradient(to bottom, #ffffff, #f5f5f5)', borderColor: '#d4d4d4' }}
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center gap-3 flex-1 px-3 py-1.5">
            <h2 className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
              {icon}
              {title}
            </h2>
            {headerContent}
          </div>
          <button
            onClick={onClose}
            className="self-stretch px-2 -mb-px hover:bg-red-500 hover:text-white transition-colors text-gray-600 cursor-default flex items-center"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className={footerClassName || "px-3 py-2 border-t border-cad-border flex justify-end gap-2"}>
            {footer}
          </div>
        )}

        {/* Resize handle */}
        {resizable && (
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
            style={{ touchAction: 'none' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" className="text-cad-text-dim">
              <path d="M14 14L14 8M14 14L8 14M10 14L14 10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
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
