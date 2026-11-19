'use client';

import QRCode from 'qrcode';
import { useMemo, type CSSProperties } from 'react';
import { code128Bars } from '@/lib/labels/code128';

/**
 * The two codes of a label, drawn as SVG so the preview matches the printed sheet. Both sit on
 * paper (white with black ink) whatever the app theme is, with the quiet zone a scanner needs.
 */
export const PAPER = { background: '#ffffff', color: '#000000' } as const;

/** QR code (error correction M, quiet zone of 2 modules) of `text`. */
export function QrSvg({
  text,
  label,
  className,
  style,
}: {
  text: string;
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  const symbol = useMemo(() => {
    try {
      const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
      const { size, data } = qr.modules;
      let path = '';
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          if (data[y * size + x]) path += `M${x} ${y}h1v1h-1z`;
        }
      }
      return { size, path };
    } catch {
      return null;
    }
  }, [text]);
  if (!symbol) return null;
  const quiet = 2;
  const full = symbol.size + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-quiet} ${-quiet} ${full} ${full}`}
      shapeRendering="crispEdges"
      className={className}
      style={style}
    >
      <rect x={-quiet} y={-quiet} width={full} height={full} fill="#ffffff" />
      <path d={symbol.path} fill="#000000" />
    </svg>
  );
}

/** Code 128 barcode (subset B) of `text` with a 10-module quiet zone on each side. */
export function Code128Svg({
  text,
  label,
  className,
  style,
}: {
  text: string;
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { bars, modules } = useMemo(() => code128Bars(text), [text]);
  const quiet = 10;
  const width = modules + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-quiet} 0 ${width} 10`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      className={className}
      style={style}
    >
      <rect x={-quiet} y={0} width={width} height={10} fill="#ffffff" />
      {bars.map(([x, w]) => (
        <rect key={x} x={x} y={0} width={w} height={10} fill="#000000" />
      ))}
    </svg>
  );
}
