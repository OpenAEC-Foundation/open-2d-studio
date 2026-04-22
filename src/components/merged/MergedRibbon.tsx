import {
  FolderOpen, FilePlus, Download,
  MousePointer2, Move, RotateCw,
  Ruler, Tag, Square,
  Layers, Settings, Grid3X3,
  Columns, Rows, Eye,
  Info,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

type IconComp = ComponentType<SVGProps<SVGSVGElement>>;

function BigButton({ icon: Icon, label }: { icon: IconComp; label: string }) {
  return (
    <button type="button" className="merged-ribbon__big" disabled>
      <Icon size={28} />
      <span>{label}</span>
    </button>
  );
}

function SmallButton({ icon: Icon, label }: { icon: IconComp; label: string }) {
  return (
    <button type="button" className="merged-ribbon__small" disabled>
      <Icon size={14} />
      <span>{label}</span>
    </button>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="merged-ribbon__group">
      <div className="merged-ribbon__group-body">{children}</div>
      <div className="merged-ribbon__group-title">{title}</div>
    </div>
  );
}

export function MergedRibbon() {
  return (
    <div className="merged-ribbon">
      <Group title="Files">
        <BigButton icon={FolderOpen} label="Open" />
        <div className="merged-ribbon__stack">
          <SmallButton icon={FilePlus} label="New Tab" />
          <SmallButton icon={Download} label="Save As" />
        </div>
      </Group>

      <Group title="Tools">
        <BigButton icon={MousePointer2} label="Select" />
        <div className="merged-ribbon__stack">
          <SmallButton icon={Move} label="Move" />
          <SmallButton icon={RotateCw} label="Rotate" />
        </div>
      </Group>

      <Group title="Measure">
        <BigButton icon={Ruler} label="Measure" />
        <div className="merged-ribbon__stack">
          <SmallButton icon={Tag} label="Dim" />
          <SmallButton icon={Square} label="Area" />
        </div>
      </Group>

      <Group title="View">
        <div className="merged-ribbon__stack">
          <SmallButton icon={Layers} label="Layers" />
          <SmallButton icon={Settings} label="Properties" />
          <SmallButton icon={Grid3X3} label="Grid" />
          <SmallButton icon={Eye} label="Show" />
        </div>
      </Group>

      <Group title="Layout">
        <div className="merged-ribbon__stack">
          <SmallButton icon={Columns} label="Split H" />
          <SmallButton icon={Rows} label="Split V" />
          <SmallButton icon={Square} label="Unsplit" />
        </div>
      </Group>

      <Group title="Help">
        <div className="merged-ribbon__stack">
          <SmallButton icon={Info} label="About" />
        </div>
      </Group>
    </div>
  );
}
