import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { DraggableModal, ModalButton } from '../../shared/DraggableModal';

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AboutDialog({ isOpen, onClose }: AboutDialogProps) {
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion('unknown'));
  }, []);

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="About"
      width={320}
      height={280}
      footer={<ModalButton onClick={onClose} variant="primary">OK</ModalButton>}
    >
      <div className="flex-1 p-4 flex flex-col items-center text-center justify-center">
        <h1 className="text-lg font-bold text-cad-text mb-1">Open 2D Studio</h1>
        <p className="text-xs text-cad-text-dim mb-3">Version {appVersion}</p>

        <p className="text-xs text-cad-text-dim mb-3">
          A cross-platform 2D CAD application
        </p>

        <a
          href="https://impertio.nl/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-cad-accent hover:underline mb-3"
        >
          impertio.nl
        </a>

        <p className="text-xs text-cad-text-dim">
          © 2025 Impertio. All rights reserved.
        </p>
      </div>
    </DraggableModal>
  );
}
