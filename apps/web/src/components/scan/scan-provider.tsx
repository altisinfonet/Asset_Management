'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PersonRef } from '@/components/registry/person-picker';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { createKeyKeeper, holderOf } from '@/lib/custody/helpers';
import { uiErrorText } from '@/lib/error-text';
import { isAssetCode, pushRecent } from '@/lib/recent-items';
import { custodyApi } from '@/lib/registry/api';
import { routes } from '@/lib/routes';
import { beep } from '@/lib/scan/beep';
import { resolveScan } from '@/lib/scan/resolve';
import { WedgeDetector } from '@/lib/scan/wedge';
import { ScanPanel } from './scan-panel';

export type ScanMode = 'open' | 'checkout' | 'checkin';
export type ScanSource = 'field' | 'wedge' | 'panel';

export interface ScanLogEntry {
  id: number;
  code: string;
  ok: boolean;
  /** Asset tag when the code matched one. */
  tag?: string;
  message: string;
}

export interface ScanBatch {
  mode: ScanMode;
  person: PersonRef | null;
  sound: boolean;
  log: ScanLogEntry[];
}

/** A page that takes over wedge scans (the loaner desk): it gets the scanned text instead of the default handling. */
export type ScanTarget = (code: string) => void | Promise<void>;

interface ScanContextValue {
  /** Handle scanned or typed text: open the asset, or apply the batch action. */
  scan: (raw: string, source: ScanSource) => Promise<void>;
  /**
   * Route wedge scans to `target` while a page is mounted (pass null to release). Scans typed into a
   * field never reach it; only the bursts of a scanner while nothing editable has focus.
   */
  setScanTarget: (target: ScanTarget | null) => void;
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  batch: ScanBatch;
  setMode: (mode: ScanMode) => void;
  setPerson: (person: PersonRef | null) => void;
  setSound: (sound: boolean) => void;
  clearLog: () => void;
}

const ScanContext = createContext<ScanContextValue | null>(null);

export function useScan(): ScanContextValue {
  const context = useContext(ScanContext);
  if (!context) throw new Error('useScan must be used inside <ScanProvider>');
  return context;
}

export function useHasScan(): boolean {
  return useContext(ScanContext) !== null;
}

/**
 * While the calling page is mounted, wedge scans go to `handler` (kept current without
 * re-registering). A no-op without a `ScanProvider` (tests that render a screen alone).
 */
export function useScanTarget(handler: ScanTarget): void {
  const context = useContext(ScanContext);
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const setScanTarget = context?.setScanTarget;
  useEffect(() => {
    if (!setScanTarget) return;
    setScanTarget((code) => ref.current(code));
    return () => setScanTarget(null);
  }, [setScanTarget]);
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

function modalOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="menu"]');
}

/** Scanners sometimes read a label twice; the same code within this window is one scan. */
const DUPLICATE_MS = 800;
const LOG_LIMIT = 50;

/**
 * Keyboard-wedge scanning and manual tag entry (M2-LIFE-08). Scanned or typed text resolves through
 * `GET /v1/scan/resolve`: in the default mode the asset opens (its primary custody action takes
 * focus); in batch mode every scan checks the asset out to one person or in, and the result is
 * logged and announced. A global key listener recognises a wedge scanner (a burst of keys then
 * Enter) when nothing editable is focused, so scanning works from any page.
 */
export function ScanProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const client = useQueryClient();

  const [panelOpen, setPanelOpen] = useState(false);
  const [batch, setBatch] = useState<ScanBatch>({
    mode: 'open',
    person: null,
    sound: true,
    log: [],
  });
  const batchRef = useRef(batch);
  useEffect(() => {
    batchRef.current = batch;
  });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const target = useRef<ScanTarget | null>(null);
  const last = useRef<{ code: string; at: number } | null>(null);
  const counter = useRef(0);

  const log = useCallback((entry: Omit<ScanLogEntry, 'id'>) => {
    // a scan that failed may be tried again at once (after fixing what was missing)
    if (!entry.ok) last.current = null;
    counter.current += 1;
    setBatch((current) => ({
      ...current,
      log: [{ ...entry, id: counter.current }, ...current.log].slice(0, LOG_LIMIT),
    }));
    if (batchRef.current.sound) beep(entry.ok ? 'ok' : 'error');
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all(
      ['asset', 'assets', 'asset-history', 'person-held', 'people', 'locations'].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
  }, [client]);

  const run = useCallback(
    async (raw: string, source: ScanSource) => {
      const text = raw.trim();
      if (!text) return;
      const now = Date.now();
      if (last.current && last.current.code === text && now - last.current.at < DUPLICATE_MS)
        return;
      last.current = { code: text, at: now };

      const current = batchRef.current;
      const batching = source === 'panel' && current.mode !== 'open';
      try {
        const outcome = await resolveScan(text);
        if (outcome.kind !== 'found') {
          const message =
            outcome.kind === 'ambiguous'
              ? t('scan.ambiguous', { code: outcome.code })
              : t('scan.notFound', { code: outcome.code });
          if (batching) log({ code: text, ok: false, message });
          else {
            last.current = null;
            toast({ variant: 'danger', title: message });
            if (batchRef.current.sound) beep('error');
          }
          return;
        }
        const { asset } = outcome;
        const tag = asset.asset_tag;

        if (!batching) {
          if (isAssetCode(outcome.code)) pushRecent({ type: 'asset', code: outcome.code });
          setPanelOpen(false);
          router.push(routes.assetScanned(asset.id));
          if (batchRef.current.sound) beep('ok');
          return;
        }

        if (current.mode === 'checkout') {
          if (!current.person) {
            log({ code: text, tag, ok: false, message: t('scan.batch.choosePersonFirst') });
            return;
          }
          if (!outcome.allowed.includes('checkout')) {
            const holder = holderOf(asset);
            log({
              code: text,
              tag,
              ok: false,
              message: holder
                ? t('scan.batch.alreadyOut', { holder: holder.name })
                : t('scan.batch.cannotCheckOut'),
            });
            return;
          }
          const key = createKeyKeeper().keyFor({ asset: asset.id, person: current.person.id });
          await custodyApi.checkout(
            asset.id,
            { person_id: current.person.id },
            { idempotencyKey: key },
          );
          log({
            code: text,
            tag,
            ok: true,
            message: t('scan.batch.checkedOut', { tag, name: current.person.display_name }),
          });
        } else {
          if (!outcome.allowed.includes('checkin')) {
            log({ code: text, tag, ok: false, message: t('scan.batch.notOut') });
            return;
          }
          const key = createKeyKeeper().keyFor({ asset: asset.id, checkin: true });
          await custodyApi.checkin(asset.id, {}, { idempotencyKey: key });
          log({ code: text, tag, ok: true, message: t('scan.batch.checkedIn', { tag }) });
        }
        await refresh();
      } catch (err) {
        const ui = getApi().toUiError(err);
        const message = uiErrorText(t, ui);
        if (batching) log({ code: text, ok: false, message });
        else {
          last.current = null;
          toast({ variant: 'danger', title: message, requestId: ui.requestId });
        }
      }
    },
    [log, refresh, router, t, toast],
  );

  const setScanTarget = useCallback((next: ScanTarget | null) => {
    target.current = next;
  }, []);

  /** Scans are handled one at a time, in the order they arrived (a scanner can outrun the API). */
  const scan = useCallback(
    (raw: string, source: ScanSource) => {
      const next = queue.current.then(() => run(raw, source));
      queue.current = next.catch(() => undefined);
      return next;
    },
    [run],
  );

  // Wedge scanner anywhere on the page: a burst of keys and Enter while nothing editable has focus.
  useEffect(() => {
    const detector = new WedgeDetector();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
        detector.reset();
        return;
      }
      if (isTypingTarget(event.target) || modalOpen()) {
        detector.reset();
        return;
      }
      const result = detector.feed(event.key, event.timeStamp);
      if (result.type === 'capture') {
        event.preventDefault();
        event.stopPropagation();
      } else if (result.type === 'scan') {
        event.preventDefault();
        event.stopPropagation();
        if (target.current) {
          const text = result.code.trim();
          const now = Date.now();
          // a label read twice is one scan, for the page that took the scans over as well
          if (last.current && last.current.code === text && now - last.current.at < DUPLICATE_MS)
            return;
          last.current = { code: text, at: now };
          void target.current(text);
        } else void scan(result.code, 'wedge');
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [scan]);

  const value = useMemo<ScanContextValue>(
    () => ({
      scan,
      setScanTarget,
      panelOpen,
      openPanel: () => setPanelOpen(true),
      closePanel: () => {
        setPanelOpen(false);
        // Leaving the panel ends batch mode: the next scan from the field opens assets again.
        setBatch((current) => ({ ...current, mode: 'open' }));
      },
      batch,
      setMode: (mode) => setBatch((current) => ({ ...current, mode })),
      setPerson: (person) => setBatch((current) => ({ ...current, person })),
      setSound: (sound) => setBatch((current) => ({ ...current, sound })),
      clearLog: () => setBatch((current) => ({ ...current, log: [] })),
    }),
    [scan, setScanTarget, panelOpen, batch],
  );

  return (
    <ScanContext.Provider value={value}>
      {children}
      <ScanPanel />
    </ScanContext.Provider>
  );
}
