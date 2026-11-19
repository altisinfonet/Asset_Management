'use client';

import { useT } from '@/i18n';
import type { LabelCodeType, LabelField, LabelTemplate } from '@/lib/labels/api';
import { mm, showsBarcode, showsQr } from '@/lib/labels/helpers';
import { Code128Svg, PAPER, QrSvg } from './code-graphics';

export interface LabelSample {
  tag: string;
  name: string | null;
  location: string;
  serial: string | null;
  organisation: string;
  /** Opaque code the QR carries (`/s/<code>`). */
  code: string;
}

type Size = Pick<LabelTemplate, 'label_width_mm' | 'label_height_mm'>;

/**
 * One label at its real size (CSS `mm`), as the PDF will print it: QR code and/or Code 128 barcode,
 * and the chosen text lines. It is paper, so it stays white with black ink in dark mode too.
 */
export function LabelPreview({
  template,
  codeType,
  fields,
  sample,
}: {
  template: Size;
  codeType: LabelCodeType;
  fields: readonly LabelField[];
  sample: LabelSample;
}) {
  const t = useT();
  const width = template.label_width_mm ?? 50;
  const height = template.label_height_mm ?? 25;
  const qr = showsQr(codeType);
  const barcode = showsBarcode(codeType);

  const lines: Array<{ key: LabelField; text: string; strong?: boolean }> = [];
  if (fields.includes('tag')) lines.push({ key: 'tag', text: sample.tag, strong: true });
  if (fields.includes('name') && sample.name) lines.push({ key: 'name', text: sample.name });
  if (fields.includes('location') && sample.location) {
    lines.push({ key: 'location', text: sample.location });
  }
  if (fields.includes('serial') && sample.serial) {
    lines.push({ key: 'serial', text: sample.serial });
  }
  if (fields.includes('organisation') && sample.organisation) {
    lines.push({ key: 'organisation', text: sample.organisation });
  }

  const barcodeHeight = barcode ? height * 0.28 : 0;
  const bodyHeight = height - barcodeHeight - 2;
  const qrSize = Math.min(bodyHeight, width * 0.42);
  const fontMm = Math.max(
    1.6,
    Math.min(height * 0.16, (bodyHeight / Math.max(lines.length, 1)) * 0.75),
  );
  const url = `${typeof window === 'undefined' ? '' : window.location.origin}/s/${sample.code}`;

  return (
    <div
      role="group"
      aria-label={t('labels.previewOf', { tag: sample.tag })}
      className="inline-flex max-w-full flex-col overflow-hidden rounded-sm border border-border-strong"
      style={{ ...PAPER, width: mm(width), height: mm(height), padding: '1mm', gap: '0.5mm' }}
      data-testid="label-preview"
    >
      <div className="flex min-h-0 flex-1 items-center gap-[1.5mm]">
        {qr ? (
          <QrSvg
            text={url}
            label={t('labels.codeQr')}
            className="shrink-0"
            style={{ width: mm(qrSize), height: mm(qrSize) }}
          />
        ) : null}
        <div
          className="min-w-0 flex-1 leading-tight"
          style={{ fontSize: mm(fontMm), lineHeight: 1.15 }}
        >
          {lines.map((line) => (
            <p
              key={line.key}
              className={line.strong ? 'truncate font-tag font-semibold' : 'truncate'}
            >
              {line.text}
            </p>
          ))}
        </div>
      </div>
      {barcode ? (
        <Code128Svg
          text={sample.tag}
          label={t('labels.codeBarcode')}
          className="w-full shrink-0"
          style={{ height: mm(barcodeHeight) }}
        />
      ) : null}
    </div>
  );
}
