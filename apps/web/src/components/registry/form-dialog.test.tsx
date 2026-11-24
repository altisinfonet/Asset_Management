import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@assettracker/api-client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import { expectNoA11yViolations } from '@/test/axe';
import { ConfirmDialog } from './confirm-dialog';
import { FormDialog, type FormFieldSpec } from './form-dialog';

const FIELDS: FormFieldSpec[] = [
  { name: 'name', label: 'Name', kind: 'text', required: true },
  { name: 'contact_email', label: 'Contact email', kind: 'email' },
];

function setup(onSubmit: (values: Record<string, string | boolean>) => Promise<void>) {
  const onOpenChange = vi.fn();
  render(
    <I18nProvider locale="en">
      <FormDialog
        open
        onOpenChange={onOpenChange}
        title="New vendor"
        fields={FIELDS}
        initial={{ name: '', contact_email: '' }}
        submitLabel="Create"
        onSubmit={onSubmit}
      />
    </I18nProvider>,
  );
  return { onOpenChange };
}

describe('FormDialog', () => {
  it('checks required fields before submitting and focuses the first invalid one', async () => {
    const onSubmit = vi.fn(async () => undefined);
    setup(onSubmit);
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('This field is required.');
    await waitFor(() => expect(screen.getByLabelText(/^Name/)).toHaveFocus());
  });

  it('submits trimmed-by-caller values and closes on success', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const { onOpenChange } = setup(onSubmit);
    await userEvent.type(screen.getByLabelText(/^Name/), 'CDW');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'CDW', contact_email: '' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('puts a 422 pointer error on its field, keeps the dialog open and keeps the typed values', async () => {
    const onSubmit = vi.fn(async () => {
      throw new ApiError('x', 422, {
        code: 'validation',
        errors: [{ pointer: '/contact_email', message: 'must be an email address' }],
      });
    });
    const { onOpenChange } = setup(onSubmit);
    await userEvent.type(screen.getByLabelText(/^Name/), 'CDW');
    await userEvent.type(screen.getByLabelText('Contact email'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    const email = await screen.findByLabelText('Contact email');
    await waitFor(() => expect(email).toBeInvalid());
    expect(email).toHaveAccessibleDescription('must be an email address');
    expect(screen.getByLabelText(/^Name/)).toHaveValue('CDW');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('shows a problem without field errors as a banner with the request id', async () => {
    setup(async () => {
      throw new ApiError('x', 409, {
        code: 'conflict',
        request_id: 'req-42',
        detail: 'Name is taken.',
      });
    });
    await userEvent.type(screen.getByLabelText(/^Name/), 'CDW');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Name is taken.');
    expect(alert).toHaveTextContent('req-42');
  });

  it('has no accessibility violations', async () => {
    setup(async () => undefined);
    await expectNoA11yViolations(document.body);
  });
});

describe('FormDialog problems the form cannot place', () => {
  const FIELDS_WITH_POINTER: FormFieldSpec[] = [
    { name: 'name', label: 'Name', kind: 'text', required: true, maxLength: 5 },
    {
      name: 'country',
      label: 'Country',
      kind: 'text',
      pointers: ['/address/country'],
      validate: (value) => (value === 'bad' ? 'Use a two-letter code.' : undefined),
    },
  ];

  function open(
    onSubmit: (values: Record<string, string | boolean>) => Promise<void>,
    onReload?: () => void,
  ) {
    render(
      <I18nProvider locale="en">
        <FormDialog
          open
          onOpenChange={vi.fn()}
          title="Edit site"
          fields={FIELDS_WITH_POINTER}
          initial={{ name: 'Main', country: '' }}
          submitLabel="Save"
          onSubmit={onSubmit}
          onReload={onReload}
        />
      </I18nProvider>,
    );
  }

  it('puts a nested pointer (/address/country) on the field that claims it', async () => {
    open(async () => {
      throw new ApiError('x', 422, {
        code: 'validation',
        detail: 'The request body failed validation (1 problem).',
        errors: [{ pointer: '/address/country', message: 'must be a two-letter country code' }],
      });
    });
    await userEvent.type(screen.getByLabelText('Country'), 'Norway');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const country = screen.getByLabelText('Country');
    await waitFor(() => expect(country).toBeInvalid());
    expect(country).toHaveAccessibleDescription('must be a two-letter country code');
    // every problem landed on a field: no generic banner on top
    expect(screen.queryByText(/request body failed validation/)).not.toBeInTheDocument();
  });

  it('lists a problem that matches no field in the banner instead of hiding it', async () => {
    open(async () => {
      throw new ApiError('x', 422, {
        code: 'validation',
        detail: 'The request body failed validation (1 problem).',
        errors: [{ pointer: '/address/line9', message: 'Too big' }],
      });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The request body failed validation');
    expect(alert).toHaveTextContent('address / line9: Too big');
  });

  it('checks the length limit and a custom rule before it calls the server', async () => {
    const onSubmit = vi.fn(async () => undefined);
    open(onSubmit);
    await userEvent.type(screen.getByLabelText(/^Name/), 'toolong');
    await userEvent.type(screen.getByLabelText('Country'), 'bad');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Name/)).toHaveAccessibleDescription('Use at most 5 characters.');
    expect(screen.getByLabelText('Country')).toHaveAccessibleDescription('Use a two-letter code.');
  });

  it('a 412 says someone saved first and offers to reload the latest version', async () => {
    const onReload = vi.fn();
    open(async () => {
      throw new ApiError('x', 412, { code: 'precondition-failed', detail: 'Stale.' });
    }, onReload);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Someone saved this before you')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Reload latest' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmDialog', () => {
  it('states the impact, shows a refusal from the API in place and stays open', async () => {
    const onConfirm = vi.fn(async () => {
      throw new ApiError('x', 409, { code: 'conflict', detail: 'Used by 12 assets.' });
    });
    const onOpenChange = vi.fn();
    render(
      <I18nProvider locale="en">
        <ConfirmDialog
          open
          onOpenChange={onOpenChange}
          title="Archive Laptop?"
          confirmLabel="Archive"
          destructive
          onConfirm={onConfirm}
        >
          <p>12 assets use this category.</p>
        </ConfirmDialog>
      </I18nProvider>,
    );
    expect(screen.getByText('12 assets use this category.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Used by 12 assets.');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
