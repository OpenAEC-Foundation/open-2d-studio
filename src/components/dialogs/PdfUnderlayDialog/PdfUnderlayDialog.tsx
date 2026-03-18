/**
 * PdfUnderlayDialog - Select a page from a PDF to place as a background underlay.
 *
 * Flow:
 * 1. Caller picks a PDF and passes { filePath, pdfData } as props.
 * 2. The dialog renders thumbnail previews of every page.
 * 3. User clicks a page thumbnail to select it.
 * 4. User clicks "Place" to confirm.
 * 5. onPlace callback receives the page number.
 */

import { useState, useEffect, useCallback } from 'react';
import { FileText, Loader2, AlertCircle } from 'lucide-react';
import { DraggableModal, ModalButton } from '../../shared/DraggableModal';
import {
  generatePdfThumbnails,
  type PdfPageThumbnail,
} from '../../../services/file/pdfUnderlayService';

export interface PdfUnderlayDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** PDF binary data (ArrayBuffer) */
  pdfData: ArrayBuffer | null;
  /** Original filename (for display) */
  fileName?: string;
  /** Called when user confirms a page selection */
  onPlace: (pageNumber: number) => void;
}

export function PdfUnderlayDialog({
  isOpen,
  onClose,
  pdfData,
  fileName,
  onPlace,
}: PdfUnderlayDialogProps) {
  const [thumbnails, setThumbnails] = useState<PdfPageThumbnail[]>([]);
  const [selectedPage, setSelectedPage] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // Generate thumbnails when dialog opens with data
  useEffect(() => {
    if (!isOpen || !pdfData) return;

    let cancelled = false;
    setLoading(true);
    setError('');
    setThumbnails([]);
    setSelectedPage(1);

    generatePdfThumbnails(pdfData, 200)
      .then((thumbs) => {
        if (cancelled) return;
        setThumbnails(thumbs);
        if (thumbs.length > 0) setSelectedPage(thumbs[0].pageNumber);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load PDF');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [isOpen, pdfData]);

  const handlePlace = useCallback(() => {
    onPlace(selectedPage);
  }, [onPlace, selectedPage]);

  if (!isOpen) return null;

  const footer = (
    <>
      <ModalButton onClick={onClose} variant="secondary">Cancel</ModalButton>
      <ModalButton
        onClick={handlePlace}
        variant="primary"
        disabled={loading || thumbnails.length === 0}
      >
        Place Underlay
      </ModalButton>
    </>
  );

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title={fileName ? `PDF Underlay - ${fileName}` : 'PDF Underlay - Select Page'}
      icon={<FileText size={16} />}
      width={640}
      height={520}
      footer={footer}
      resizable
    >
      <div className="flex flex-col h-full p-3 gap-2">
        {/* Loading state */}
        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-cad-text-dim">
            <Loader2 size={32} className="animate-spin" />
            <span className="text-xs">Loading PDF pages...</span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-red-400">
            <AlertCircle size={32} />
            <span className="text-xs">{error}</span>
          </div>
        )}

        {/* No data */}
        {!loading && !error && !pdfData && (
          <div className="flex-1 flex items-center justify-center text-cad-text-dim text-xs">
            No PDF loaded.
          </div>
        )}

        {/* Thumbnail grid */}
        {!loading && !error && thumbnails.length > 0 && (
          <>
            <div className="text-xs text-cad-text-dim">
              {thumbnails.length} page{thumbnails.length !== 1 ? 's' : ''} found. Click a page to select it.
            </div>
            <div
              className="flex-1 overflow-y-auto border border-cad-border rounded bg-cad-bg"
              style={{ minHeight: 0 }}
            >
              <div
                className="grid gap-3 p-3"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
              >
                {thumbnails.map((thumb) => {
                  const isSelected = thumb.pageNumber === selectedPage;
                  return (
                    <button
                      key={thumb.pageNumber}
                      className={
                        'flex flex-col items-center gap-1 p-2 rounded border transition-colors cursor-pointer ' +
                        (isSelected
                          ? 'border-cad-accent bg-cad-accent/10'
                          : 'border-cad-border bg-cad-surface hover:bg-cad-hover hover:border-cad-text-dim')
                      }
                      onClick={() => setSelectedPage(thumb.pageNumber)}
                      onDoubleClick={() => {
                        setSelectedPage(thumb.pageNumber);
                        onPlace(thumb.pageNumber);
                      }}
                    >
                      <img
                        src={thumb.dataUrl}
                        alt={`Page ${thumb.pageNumber}`}
                        className="max-h-[160px] w-auto border border-cad-border/50 shadow-sm"
                        draggable={false}
                      />
                      <span
                        className={
                          'text-xs font-medium ' +
                          (isSelected ? 'text-cad-accent' : 'text-cad-text')
                        }
                      >
                        Page {thumb.pageNumber}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </DraggableModal>
  );
}
