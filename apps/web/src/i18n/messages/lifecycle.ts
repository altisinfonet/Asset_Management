/**
 * English messages of the M2 close-out (v0.2.8): the lost, found and dispose actions (M2-LIFE-05),
 * the bulk move and the Organisation settings page. Merged into the main catalogue in `en.ts`.
 * Plural keys (`_one` / `_other`) are addressed by the base name with `{ count }`.
 */
export const lifecycleMessages = {
  lifecycle: {
    actions: {
      mark_lost: 'Mark as lost or stolen',
      mark_found: 'Mark as found',
      dispose: 'Dispose',
    },
    lost: {
      title: 'Mark {tag} as lost or stolen',
      description: 'The asset gets a lost status and cannot be checked out until it is found.',
      closesCheckout:
        'It is checked out to {name}. Marking it lost closes that check-out: {name} no longer holds it.',
      status: 'Status',
      note: 'What happened',
      notePlaceholder: 'Where and when it was last seen, police report number ...',
      submit: 'Mark as lost',
      done: '{tag} is marked lost',
    },
    found: {
      title: 'Mark {tag} as found',
      description: 'The asset gets a ready status again and can be checked out.',
      status: 'Status',
      location: 'Where is it now?',
      locationHint: 'Leave it as it is when the asset is back where it belongs.',
      note: 'Note',
      submit: 'Mark as found',
      done: '{tag} is marked found',
    },
    dispose: {
      title: 'Dispose of {tag}',
      bulkTitle_one: 'Dispose of {count} asset',
      bulkTitle_other: 'Dispose of {count} assets',
      description:
        'Records how and when the asset left the organisation. The asset is then archived: it leaves the asset list and the counts. Restore brings it back.',
      checkedOut:
        'It is checked out to {name}. Check it in before you dispose of it: the dispose is refused while it is checked out.',
      reason: 'Reason',
      date: 'Date',
      dateHint: 'The day it left. Today when you leave it as it is.',
      dateFuture: 'Choose today or an earlier day.',
      note: 'Note',
      notePlaceholder: 'Buyer, recipient, certificate number ...',
      status: 'Status',
      submit: 'Dispose',
      bulkSubmit_one: 'Dispose of {count} asset',
      bulkSubmit_other: 'Dispose of {count} assets',
      done: '{tag} is disposed of and archived',
      resultsTitle: 'Dispose',
      bulkSkipped_one: '{count} selected asset is checked out and was left out. Check it in first.',
      bulkSkipped_other:
        '{count} selected assets are checked out and were left out. Check them in first.',
      reasons: {
        sold: 'Sold',
        donated: 'Donated',
        recycled: 'Recycled',
        scrapped: 'Scrapped',
        stolen: 'Stolen',
        returned_to_vendor: 'Returned to the supplier',
        other: 'Other',
      },
      disposedBanner: 'Disposed of on {date}: {reason}.',
    },
    statusHint: {
      lost: 'Setting a lost status here does not close a check-out. Use Mark as lost or stolen instead: it also ends the check-out.',
      archived:
        'Setting a retired status here keeps the asset in the active list. Use Dispose instead: it records the reason and the date and archives the asset.',
      bulk: 'A lost or retired status set here does not close check-outs or archive the assets. Use Mark as lost or stolen, or Dispose, on the asset page instead.',
      useMarkLost: 'Mark as lost instead',
      useDispose: 'Dispose instead',
    },
  },
  bulkMove: {
    location: 'Location',
    noLocation: 'No location (whereabouts unknown)',
    note: 'Note for the history',
    resultsTitle: 'Move',
    scopedHint: 'You can only choose places inside your sites.',
  },
  organisation: {
    title: 'Organisation',
    description: 'Your organisation and the defaults that apply to everybody.',
    about: {
      heading: 'About',
      name: 'Name',
      plan: 'Plan',
      currency: 'Currency',
      currencyHint: 'Costs and repair amounts are kept in this currency.',
      readOnly: 'The name, plan and currency are set when the organisation is created.',
    },
    custody: {
      heading: 'Check-out defaults',
      description:
        'The return date a check-out starts with, and when borrowers of a loaner pool are reminded.',
    },
    files: {
      heading: 'Files and photos',
      description: 'How large an upload may be, and whether photos keep their location data.',
      cap: 'Largest upload (MB)',
      capHint: 'Your plan allows up to {max} MB. Leave empty to use the plan limit.',
      capInvalid: 'Enter a whole number from 1 to {max}.',
      effective: 'Uploads up to {size} are accepted now.',
      stripExif: 'Remove location and camera data (EXIF) from uploaded photos',
      save: 'Save file settings',
      saved: 'File settings saved',
      loadFailed: 'We could not load the file settings.',
      readOnly: 'Only people who manage the catalogue can change these settings.',
    },
  },
} as const;
