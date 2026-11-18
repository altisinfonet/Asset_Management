import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import type { RawValue } from '@/lib/registry/custom-fields';
import { expectNoA11yViolations } from '@/test/axe';
import { CustomFieldInput, type CustomFieldInputProps } from './custom-field-input';

type Def = CustomFieldInputProps['def'];

const base = {
  key: 'k',
  label: 'Field',
  required: false,
  options: null,
  validation: null,
  help_text: null,
};

/** A controlled wrapper so typing really accumulates, like in the asset form. */
function Controlled({
  def,
  error,
  initial,
  onValue,
}: {
  def: Def;
  error?: string;
  initial?: RawValue;
  onValue?: (v: RawValue) => void;
}) {
  const [value, setValue] = useState<RawValue | undefined>(initial);
  return (
    <I18nProvider locale="en">
      <CustomFieldInput
        def={def}
        value={value}
        error={error}
        onChange={(v) => {
          setValue(v);
          onValue?.(v);
        }}
      />
    </I18nProvider>
  );
}

describe('CustomFieldInput renders one input per type', () => {
  it('text and long text', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <Controlled def={{ ...base, data_type: 'text', label: 'OS version' }} onValue={onValue} />,
    );
    await user.type(screen.getByRole('textbox', { name: 'OS version' }), 'ChromeOS');
    expect(onValue).toHaveBeenLastCalledWith('ChromeOS');
    rerender(<Controlled def={{ ...base, data_type: 'long_text', label: 'Remarks' }} />);
    expect(screen.getByRole('textbox', { name: 'Remarks' }).tagName).toBe('TEXTAREA');
  });

  it('number carries min and max and uses a numeric input', () => {
    render(
      <Controlled
        def={{
          ...base,
          data_type: 'number',
          label: 'Screen size',
          validation: { min: 5, max: 20 },
        }}
      />,
    );
    const input = screen.getByRole('spinbutton', { name: 'Screen size' });
    expect(input).toHaveAttribute('min', '5');
    expect(input).toHaveAttribute('max', '20');
  });

  it('checkbox toggles a boolean', async () => {
    const onValue = vi.fn();
    render(
      <Controlled
        def={{ ...base, data_type: 'boolean', label: 'Managed' }}
        initial={false}
        onValue={onValue}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Managed' }));
    expect(onValue).toHaveBeenLastCalledWith(true);
  });

  it('date, url and email use their native input types', () => {
    render(
      <>
        <Controlled def={{ ...base, data_type: 'date', label: 'Enrolled' }} />
        <Controlled def={{ ...base, data_type: 'url', label: 'Link' }} />
        <Controlled def={{ ...base, data_type: 'email', label: 'Owner' }} />
      </>,
    );
    expect(screen.getByLabelText('Enrolled')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Link')).toHaveAttribute('type', 'url');
    expect(screen.getByLabelText('Owner')).toHaveAttribute('type', 'email');
  });

  it('select offers the options and a "not set" choice unless required', async () => {
    const user = userEvent.setup();
    const options = [
      { value: 'good', label: 'Good' },
      { value: 'poor', label: 'Poor' },
    ];
    const onValue = vi.fn();
    render(
      <Controlled
        def={{ ...base, data_type: 'select', label: 'Condition', options }}
        onValue={onValue}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Condition' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Not set',
      'Good',
      'Poor',
    ]);
    await user.click(screen.getByRole('option', { name: 'Poor' }));
    expect(onValue).toHaveBeenLastCalledWith('poor');
  });

  it('a required select has no "not set" choice and says (required)', async () => {
    const user = userEvent.setup();
    render(
      <Controlled
        def={{
          ...base,
          data_type: 'select',
          label: 'Condition',
          required: true,
          options: [{ value: 'good', label: 'Good' }],
        }}
      />,
    );
    expect(screen.getByText('(required)')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: /Condition/ }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Good']);
  });

  it('multi-select is a checkbox group that accumulates values', async () => {
    const onValue = vi.fn();
    const options = [
      { value: 'charger', label: 'Charger' },
      { value: 'case', label: 'Case' },
    ];
    render(
      <Controlled
        def={{ ...base, data_type: 'multiselect', label: 'Accessories', options }}
        initial={[]}
        onValue={onValue}
      />,
    );
    const group = screen.getByRole('group', { name: 'Accessories' });
    expect(group).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Charger' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Case' }));
    expect(onValue).toHaveBeenLastCalledWith(['charger', 'case']);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Charger' }));
    expect(onValue).toHaveBeenLastCalledWith(['case']);
  });

  it('links the error and the help text to the control and has no accessibility violations', async () => {
    const { container } = render(
      <>
        <Controlled
          def={{
            ...base,
            data_type: 'number',
            label: 'Screen size',
            help_text: 'Diagonal in inches.',
          }}
          error="Must be at most 20."
        />
        <Controlled def={{ ...base, data_type: 'boolean', label: 'Managed' }} error="Pick one." />
        <Controlled
          def={{
            ...base,
            data_type: 'multiselect',
            label: 'Ports',
            options: [{ value: 'a', label: 'A' }],
          }}
          error="Choose at least one."
        />
      </>,
    );
    const input = screen.getByRole('spinbutton', { name: 'Screen size' });
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription(/Must be at most 20\..*Diagonal in inches\./);
    await expectNoA11yViolations(container);
  });
});
