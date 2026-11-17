/**
 * English message catalogue (the only locale in M1). Every user-facing string of the app shell and
 * the placeholder pages lives here; components take text through props or `useI18n().t`.
 *
 * Keys are nested for readability and addressed with dotted paths (`t('nav.assets')`). A key
 * with `_one` / `_other` suffixes is pluralised by `count`: `t('table.selected', { count: 3 })`.
 * Placeholders use `{name}`.
 */
export const en = {
  app: {
    name: 'Asset Tracker',
    logoAlt: 'Asset Tracker logo',
  },
  common: {
    close: 'Close',
    cancel: 'Cancel',
    save: 'Save',
    loading: 'Loading',
    search: 'Search',
    retry: 'Try again',
    required: '(required)',
    optional: '(optional)',
    skipToContent: 'Skip to main content',
    comingSoon: 'Coming soon',
    placeholderData: 'Placeholder data',
    moreActions: 'More actions',
    openFullPage: 'Open full page',
    notAvailableYet: 'Available in a later milestone',
  },
  nav: {
    primary: 'Primary',
    dashboard: 'Dashboard',
    assets: 'Assets',
    locations: 'Locations',
    loanerPool: 'Loaner pool',
    repairs: 'Repairs',
    stocktake: 'Stocktake',
    labels: 'Labels',
    import: 'Import',
    settings: 'Settings',
    collapse: 'Collapse sidebar',
    expand: 'Expand sidebar',
    openNavigation: 'Open navigation',
    closeNavigation: 'Close navigation',
    breadcrumbs: 'Breadcrumbs',
  },
  theme: {
    label: 'Theme',
    light: 'Light',
    dark: 'Dark',
    system: 'Use system setting',
  },
  topbar: {
    scanLabel: 'Scan or type an asset tag',
    scanPlaceholder: 'Scan or type tag',
    palette: 'Search',
    paletteShortcut: 'Ctrl K',
    userMenu: 'User menu',
    signOut: 'Sign out',
    profile: 'Profile',
  },
  palette: {
    title: 'Command palette',
    description: 'Search pages and actions. Use the arrow keys, then press Enter.',
    placeholder: 'Type a command or search',
    empty: 'No results found.',
    goTo: 'Go to',
    actions: 'Actions',
    newAsset: 'New asset',
    toggleTheme: 'Switch theme',
    hintNavigate: 'to navigate',
    hintSelect: 'to select',
    hintClose: 'to close',
  },
  status: {
    deployable: 'Ready',
    deployed: 'Assigned',
    pending: 'Pending',
    undeployable: 'In repair',
    archived: 'Archived',
    lost: 'Lost',
    overdue: 'Overdue',
    loaned: 'On loan',
  },
  table: {
    selectAll: 'Select all rows',
    selectRow: 'Select row {label}',
    selected_one: '{count} row selected',
    selected_other: '{count} rows selected',
    clearSelection: 'Clear selection',
    sortedAscending: 'sorted ascending',
    sortedDescending: 'sorted descending',
    loadingRows: 'Loading rows',
    density: 'Row density',
    comfortable: 'Comfortable',
    compact: 'Compact',
  },
  toast: {
    notifications: 'Notifications',
    dismiss: 'Dismiss notification',
    requestId: 'Request ID {id}',
  },
  error: {
    network: 'The server could not be reached. Check your connection and try again.',
    unauthorized: 'Your session has ended. Sign in again to continue.',
    forbidden: 'You do not have access to this.',
    notFound: 'We could not find what you were looking for.',
    conflict: 'This item changed. Reload to see the latest version.',
    stale: 'This item was changed by someone else. Reload to see the latest version.',
    preconditionRequired: 'Reload this item before saving your changes.',
    rateLimited: 'Too many requests. Wait a moment and try again.',
    validation: 'Some fields need your attention.',
    server: 'Something went wrong on our side. Try again in a moment.',
    unknown: 'Something went wrong.',
  },
  dashboard: {
    title: 'Dashboard',
    description: 'What needs attention across your assets.',
    ready: 'Ready',
    assigned: 'Assigned',
    inRepair: 'In repair',
    overdue: 'Overdue',
    placeholder: 'Counts and attention lists arrive with the asset registry.',
    apiStatus: 'API status',
  },
  api: {
    checking: 'Checking the API',
    unreachable: 'API unreachable: {message}',
    statusOk: 'ok',
    statusDegraded: 'degraded',
    database: 'database {status}',
    latency: '{ms} ms',
  },
  assets: {
    title: 'Assets',
    description: 'Find, filter and act on every asset.',
    newAsset: 'New asset',
    import: 'Import',
    placeholderBanner:
      'Placeholder rows. The asset registry replaces this table in the registry stories.',
    tableLabel: 'Assets',
    columns: {
      tag: 'Tag',
      name: 'Name',
      model: 'Model',
      status: 'Status',
      location: 'Location',
    },
    emptyTitle: 'No assets yet',
    emptyDescription: 'Add your first asset or import a CSV file to get started.',
    drawerDescription: 'Quick view',
  },
  assetView: {
    title: 'Asset',
    breadcrumbList: 'Assets',
    noneSelected: 'No asset selected',
    noneSelectedHint: 'Open an asset from the list, or scan a tag.',
    backToList: 'Back to assets',
    resolvingCode: 'Looking up code {code}',
    tabs: {
      overview: 'Overview',
      history: 'History',
      repairs: 'Repairs',
      attachments: 'Attachments',
    },
    idLabel: 'Asset ID',
    codeLabel: 'Scanned code',
    tabPlaceholder: 'This tab is filled in by a later story.',
  },
  settings: {
    title: 'Settings',
    subnav: 'Settings sections',
    sections: {
      organisation: 'Organisation',
      users: 'Users and roles',
      categories: 'Categories',
      models: 'Models',
      fields: 'Custom fields',
      status: 'Status labels',
    },
    placeholderTitle: '{section} is not built yet',
    placeholderDescription: 'This settings page is a placeholder for a later story.',
  },
  login: {
    title: 'Sign in',
    description: 'Use your work account to continue.',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    forgot: 'Forgot password?',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    placeholderNotice: 'Sign-in is wired up in the authentication story.',
  },
  notFound: {
    title: 'Page not found',
    description: 'The page you are looking for does not exist or has moved.',
    home: 'Go to the dashboard',
    openingCode: 'Opening {code}',
  },
} as const;

type Join<K extends string, P extends string> = `${K}.${P}`;

/** Dotted paths of every string leaf of a catalogue. */
export type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : Join<K, Paths<T[K]>>;
}[keyof T & string];

export type MessageKey = Paths<typeof en>;
/** Plural keys (`x_one` / `x_other`) are addressed by the base name. */
export type PluralBase<K extends string> = K extends `${infer B}_one` | `${infer B}_other` ? B : K;
export type TranslationKey = PluralBase<MessageKey>;
