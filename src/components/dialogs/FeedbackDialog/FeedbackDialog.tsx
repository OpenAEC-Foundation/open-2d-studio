import { useState, useEffect, useRef } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { DraggableModal } from '../../shared/DraggableModal';

type FeedbackCategory = 'bug' | 'feature' | 'general';
type FeedbackStatus = 'idle' | 'submitting' | 'success' | 'error';

const FEEDBACK_API_URL = 'https://open-feedback-studio.pages.dev/api/feedback';

const SENTIMENT_LABELS: Record<number, string> = {
  1: 'Frustrated',
  2: 'Neutral',
  3: 'Happy',
};

interface FeedbackDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function ImageThumbnail({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="relative group">
      {src && (
        <img src={src} alt={file.name} className="w-12 h-12 object-cover rounded border border-cad-border" />
      )}
      <button
        type="button"
        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-default"
        onClick={onRemove}
      >
        &times;
      </button>
    </div>
  );
}

export function FeedbackDialog({ isOpen, onClose }: FeedbackDialogProps) {
  const [category, setCategory] = useState<FeedbackCategory>('general');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [status, setStatus] = useState<FeedbackStatus>('idle');
  const [error, setError] = useState('');
  const [appVersion, setAppVersion] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [imageError, setImageError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getVersion().then(setAppVersion);
  }, []);

  const handleImageAdd = (files: FileList | null) => {
    if (!files) return;
    setImageError('');
    const incoming = Array.from(files);
    const MAX_FILES = 3;
    const MAX_TOTAL_SIZE = 1 * 1024 * 1024; // 1MB total

    const combined = [...images, ...incoming];
    if (combined.length > MAX_FILES) {
      setImageError(`Maximum ${MAX_FILES} images allowed.`);
      return;
    }
    const totalSize = combined.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      setImageError(`Total image size exceeds 1 MB limit.`);
      return;
    }
    setImages(combined);
  };

  const handleImageRemove = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    setImageError('');
  };

  const handleSubmit = async () => {
    setStatus('submitting');
    setError('');

    try {
      let res: Response;

      if (images.length > 0) {
        const formData = new FormData();
        formData.append('app', 'open-2D-studio');
        formData.append('category', category);
        formData.append('message', message.trim());
        if (rating) formData.append('sentiment', SENTIMENT_LABELS[rating]);
        if (appVersion) formData.append('appVersion', appVersion);
        images.forEach(img => formData.append('images', img));

        res = await fetch(FEEDBACK_API_URL, {
          method: 'POST',
          body: formData,
        });
      } else {
        res = await fetch(FEEDBACK_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            app: 'open-2D-studio',
            category,
            message: message.trim(),
            sentiment: rating ? SENTIMENT_LABELS[rating] : undefined,
            appVersion: appVersion || undefined,
          }),
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error || `Server error (${res.status})`);
        setStatus('error');
        return;
      }

      setStatus('success');
      setMessage('');
      setRating(null);
      setImages([]);
      setImageError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Please check your connection.');
      setStatus('error');
    }
  };

  const categories: { value: FeedbackCategory; label: string }[] = [
    { value: 'general', label: 'General' },
    { value: 'bug', label: 'Bug' },
    { value: 'feature', label: 'Feature Request' },
  ];

  const emojis = [
    { value: 1, label: '\u{1F61E}' },
    { value: 2, label: '\u{1F610}' },
    { value: 3, label: '\u{1F60A}' },
  ];

  const content = status === 'success' ? (
    <div className="p-4 flex flex-col">
      <p className="text-sm text-cad-text mb-2">Thank you for your feedback!</p>
      <button
        className="mt-4 self-start px-4 py-1.5 text-xs font-medium rounded bg-cad-surface border border-cad-border text-cad-text-dim hover:bg-cad-hover cursor-default"
        onClick={() => setStatus('idle')}
      >
        Send another
      </button>
    </div>
  ) : (
    <div className="p-4 flex flex-col gap-3">
      {/* Category toggles */}
      <div className="flex gap-2">
        {categories.map(c => (
          <button
            key={c.value}
            className={`px-4 py-1.5 text-xs font-medium rounded transition-colors cursor-default ${
              category === c.value
                ? 'bg-cad-accent text-white'
                : 'bg-cad-surface border border-cad-border text-cad-text-dim hover:bg-cad-hover'
            }`}
            onClick={() => setCategory(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Message */}
      <div className="flex flex-col gap-1">
        <textarea
          className="w-full bg-cad-surface border border-cad-border text-cad-text text-sm rounded px-3 py-2 resize-none focus:outline-none focus:border-cad-border-light"
          rows={4}
          maxLength={5000}
          placeholder="Describe your feedback (min. 10 characters)..."
          value={message}
          onChange={e => setMessage(e.target.value)}
        />
        <span className={`text-[10px] self-end ${message.length > 4500 ? 'text-red-400' : 'text-cad-text-muted'}`}>
          {message.length}/5000
        </span>
      </div>

      {/* Image attachments */}
      <div className="flex flex-col gap-2">
        <input
          type="file"
          accept="image/*"
          multiple
          ref={fileInputRef}
          className="hidden"
          onChange={e => { handleImageAdd(e.target.files); e.target.value = ''; }}
        />
        <button
          type="button"
          className="self-start flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-cad-surface border border-cad-border text-cad-text-dim hover:bg-cad-hover cursor-default disabled:opacity-50"
          disabled={images.length >= 3}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          Attach images ({images.length}/3)
        </button>
        {images.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {images.map((img, i) => (
              <ImageThumbnail key={`${img.name}-${i}`} file={img} onRemove={() => handleImageRemove(i)} />
            ))}
          </div>
        )}
        {imageError && <p className="text-xs text-red-400">{imageError}</p>}
      </div>

      {/* Emoji rating */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-cad-text-muted mr-2">How do you feel?</span>
        {emojis.map(e => (
          <button
            key={e.value}
            className={`text-xl px-1 cursor-default rounded transition-colors ${
              rating === e.value ? 'bg-cad-hover' : 'hover:bg-cad-surface-elevated'
            }`}
            onClick={() => setRating(rating === e.value ? null : e.value)}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* Error message */}
      {status === 'error' && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {/* Submit */}
      <button
        className="self-start px-5 py-1.5 text-sm font-medium text-white rounded transition-colors cursor-default bg-cad-accent hover:bg-cad-accent/80 disabled:opacity-50 disabled:cursor-default"
        disabled={message.trim().length < 10 || status === 'submitting'}
        onClick={handleSubmit}
      >
        {status === 'submitting' ? 'Submitting...' : 'Submit'}
      </button>
    </div>
  );

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Send Feedback"
      width={550}
    >
      {content}
    </DraggableModal>
  );
}
