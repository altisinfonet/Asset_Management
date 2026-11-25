/**
 * English messages of location scoping (M2-LOC-03, ED-26): the "Scoped to" indicator of the app
 * shell, the scope of a role assignment on the Users screen, and the location hints of the forms a
 * scoped user fills in.
 */
export const scopeMessages = {
  locationScope: {
    indicator: 'Scoped to: {paths}',
    indicatorNone: 'Scoped to: no location (ask an administrator)',
    access: 'Access',
    accessHint: 'Limit the role to one location and everything inside it, or give it everywhere.',
    accessOf: 'Access of {name}',
    wholeOrganisation: 'Whole organisation',
    limited: 'Limited to a location',
    company: 'Whole company',
    location: 'Location',
    locationHint: 'The role applies to this location and everything inside it.',
    numbered: '{label} {n}',
    at: 'at {location}',
    archivedLocation: 'a location that is no longer available',
    edit: 'Change role and access',
    editTitle: 'Role and access of {name}',
    editDescription:
      'A role limited to a location never includes managing users, roles, the catalogue, departments or notification rules.',
    saved: 'Role and access of {name} saved.',
    rolesNote:
      'Each role can be limited to a location when you give it to someone: on the Users tab, choose "Change role and access" and then "Limited to a location".',
    requiredHint: 'Your access is limited to a location, so choose one inside it.',
    parentRequiredHint:
      'Your access is limited to a location, so a new location goes inside one you can manage.',
  },
} as const;
