/**
 * English messages of the saved views (M2-REG-01) and the CSV export (M2-REG-02) on the asset
 * list. The labels of the toolbar that already existed stay under `assets.views`.
 */
export const viewsMessages = {
  savedViews: {
    shared: 'shared',
    sharedBy: 'shared by {name}',
    sharedOption: '{name} (shared)',
    share: 'Share with everyone in the organisation',
    shareHint: 'Everyone who can see assets can use this view; only you can change it.',
    update: 'Update view',
    updateFailed: 'We could not update the view.',
    shareFailed: 'View "{name}" was saved, but not shared.',
    updateDone: 'View "{name}" now uses the current search, filters and columns.',
    edit: 'Rename or share',
    editTitle: 'Edit view "{name}"',
    editDescription: 'Rename the view, or choose who can use it.',
    saved: 'View "{name}" saved.',
    renamed: 'View "{name}" saved.',
    deleted: 'View deleted.',
    deleteTitle: 'Delete view "{name}"?',
    deleteDescription:
      'The view is removed for everyone it was shared with. Assets are not affected.',
    loadFailed: 'We could not load the saved views.',
    migrated_one: 'Moved {count} saved view from this browser to your account.',
    migrated_other: 'Moved {count} saved views from this browser to your account.',
    migrateFailed:
      'Some saved views could not be moved yet. They stay in this browser and we will try again.',
    droppedTitle: 'Some parts of "{name}" no longer exist',
    droppedBody: 'They were left out of the filters: {parts}.',
    dropped: {
      status: 'a status',
      category: 'a category',
      location: 'a location',
      person: 'a person',
      field: 'a custom field filter',
      column: 'a custom field column',
    },
  },
  exports: {
    button: 'Export CSV',
    title: 'Export to CSV',
    description: 'Exports every row the current search and filters show.',
    starting: 'Starting the export...',
    working: 'Preparing your file. This can take a moment for a long list.',
    ready: 'Your file is ready',
    readyRows_one: '{count} row exported.',
    readyRows_other: '{count} rows exported.',
    expires: 'The download link works until {time}.',
    download: 'Download CSV',
    failed: 'The export failed.',
    expired: 'The download link has expired. Start the export again.',
    retry: 'Start again',
    audited: 'Exports are recorded in the audit log.',
  },
} as const;
