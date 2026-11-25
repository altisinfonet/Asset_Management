import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n';
import { THEME_STORAGE_KEY, ThemeProvider } from '@/lib/theme';
import { expectNoA11yViolations } from '@/test/axe';
import { ThemeSwitch } from './theme-switch';

const renderSwitch = () =>
  render(
    <ThemeProvider>
      <I18nProvider locale="en">
        <ThemeSwitch />
      </I18nProvider>
    </ThemeProvider>,
  );

describe('ThemeSwitch', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('offers System, Light and Dark, with System chosen by default', async () => {
    const { container } = renderSwitch();
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group).toBeVisible();
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      'System',
      'Light',
      'Dark',
    ]);
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    await expectNoA11yViolations(container);
  });

  it('applies and stores the choice; System clears the override', async () => {
    const user = userEvent.setup();
    renderSwitch();
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');

    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('moves between the options with the arrow keys', async () => {
    const user = userEvent.setup();
    renderSwitch();
    screen.getByRole('radio', { name: 'System' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveFocus();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});
