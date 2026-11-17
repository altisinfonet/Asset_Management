'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createTranslator, type I18nConfig, type Translator } from './translator';

export type { TranslationKey } from './messages/en';
export type { I18nConfig, Translator, TranslationValues } from './translator';
export { createTranslator } from './translator';

// Works without a provider (components and tests fall back to the English defaults).
const I18nContext = createContext<Translator>(createTranslator());

export function I18nProvider({
  children,
  ...config
}: Partial<I18nConfig> & { children: ReactNode }) {
  const { locale, timeZone, currency } = config;
  const value = useMemo(
    () => createTranslator({ locale, timeZone, currency }),
    [locale, timeZone, currency],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Translator {
  return useContext(I18nContext);
}

export function useT(): Translator['t'] {
  return useContext(I18nContext).t;
}
