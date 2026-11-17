'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useT } from '@/i18n';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { IconButton } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/** Theme menu: follow the OS (default) or force light or dark. */
export function ThemeToggle() {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const Icon = ICONS[theme];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton icon={Icon} label={t('theme.label')} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{t('theme.label')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => setTheme(value as ThemePreference)}
        >
          <DropdownMenuRadioItem value="light">{t('theme.light')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t('theme.dark')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">{t('theme.system')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
