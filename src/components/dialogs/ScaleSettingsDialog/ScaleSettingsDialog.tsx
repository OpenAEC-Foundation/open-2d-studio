import { useState, useEffect } from 'react';
import { DraggableModal, ModalButton } from '../../shared/DraggableModal';
import { useAppStore } from '../../../state/appStore';
import type { ScaleDisplaySettings } from '../../../types/geometry';
import { DEFAULT_SCALE_DISPLAY_SETTINGS } from '../../../types/geometry';

interface ScaleSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Scale presets: label shown in UI and the numeric scale value used as record key */
const SCALE_PRESETS: { label: string; value: string }[] = [
  { label: '1:1', value: '1' },
  { label: '1:2', value: '0.5' },
  { label: '1:5', value: '0.2' },
  { label: '1:10', value: '0.1' },
  { label: '1:20', value: '0.05' },
  { label: '1:50', value: '0.02' },
  { label: '1:100', value: '0.01' },
  { label: '1:200', value: '0.005' },
  { label: '1:500', value: '0.002' },
];

const FIELD_KEYS: (keyof ScaleDisplaySettings)[] = [
  'linePatternFactor',
  'hatchPatternFactor',
  'lineweightFactor',
  'textHeightFactor',
];

const FIELD_LABELS: Record<keyof ScaleDisplaySettings, string> = {
  linePatternFactor: 'Line Pattern',
  hatchPatternFactor: 'Hatch Pattern',
  lineweightFactor: 'Lineweight',
  textHeightFactor: 'Text Height',
};

export function ScaleSettingsDialog({ isOpen, onClose }: ScaleSettingsDialogProps) {
  const stored = useAppStore(s => s.scaleDisplaySettings);
  const setScaleDisplaySettings = useAppStore(s => s.setScaleDisplaySettings);

  // Local working copy so edits don't hit the store until Save
  const [local, setLocal] = useState<Record<string, ScaleDisplaySettings>>({});

  // Sync from store when dialog opens
  useEffect(() => {
    if (isOpen) {
      const copy: Record<string, ScaleDisplaySettings> = {};
      for (const preset of SCALE_PRESETS) {
        copy[preset.value] = stored[preset.value]
          ? { ...stored[preset.value] }
          : { ...DEFAULT_SCALE_DISPLAY_SETTINGS };
      }
      setLocal(copy);
    }
  }, [isOpen, stored]);

  const handleChange = (scaleKey: string, field: keyof ScaleDisplaySettings, raw: string) => {
    const num = parseFloat(raw);
    if (isNaN(num) || num < 0) return;
    setLocal(prev => ({
      ...prev,
      [scaleKey]: {
        ...prev[scaleKey],
        [field]: num,
      },
    }));
  };

  const handleSave = () => {
    setScaleDisplaySettings(local);
    onClose();
  };

  const handleResetAll = () => {
    const reset: Record<string, ScaleDisplaySettings> = {};
    for (const preset of SCALE_PRESETS) {
      reset[preset.value] = { ...DEFAULT_SCALE_DISPLAY_SETTINGS };
    }
    setLocal(reset);
  };

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Scale Display Settings"
      width={620}
      height={440}
      resizable
      minWidth={540}
      minHeight={340}
      footer={
        <>
          <ModalButton onClick={handleResetAll} variant="secondary">Reset All</ModalButton>
          <ModalButton onClick={onClose} variant="secondary">Cancel</ModalButton>
          <ModalButton onClick={handleSave} variant="primary">Save</ModalButton>
        </>
      }
    >
      <div className="flex-1 min-h-0 overflow-auto p-3">
        <p className="text-xs text-cad-text-dim mb-3">
          Override display factors per drawing scale. A value of 1.0 means no change.
        </p>

        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-cad-border">
              <th className="text-left py-1.5 px-2 text-cad-text-dim font-medium">Scale</th>
              {FIELD_KEYS.map(key => (
                <th key={key} className="text-left py-1.5 px-2 text-cad-text-dim font-medium">
                  {FIELD_LABELS[key]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SCALE_PRESETS.map(preset => {
              const row = local[preset.value] || DEFAULT_SCALE_DISPLAY_SETTINGS;
              return (
                <tr key={preset.value} className="border-b border-cad-border/50 hover:bg-cad-hover/50">
                  <td className="py-1 px-2 text-cad-text font-medium whitespace-nowrap">{preset.label}</td>
                  {FIELD_KEYS.map(field => (
                    <td key={field} className="py-1 px-2">
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={row[field]}
                        onChange={e => handleChange(preset.value, field, e.target.value)}
                        className="w-full bg-cad-input border border-cad-border text-cad-text text-xs px-1.5 py-0.5 rounded focus:outline-none focus:border-cad-accent"
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DraggableModal>
  );
}
