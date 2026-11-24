/**
 * English messages of the managed departments (ED-17): the Settings page, the archive-or-merge
 * dialog and the picker. Labels of the person and asset screens live next to those screens.
 */
export const departmentsMessages = {
  departments: {
    title: 'Departments',
    description:
      'The list people and assets are assigned to. Choosing from it keeps one department from being spelled three ways.',
    add: 'Add department',
    addFirst: 'Add the first department',
    tableLabel: 'Departments',
    loadFailed: 'We could not load the departments.',
    emptyTitle: 'No departments yet',
    emptyDescription:
      'Add the departments of your organisation, then choose them on people and assets.',
    created: 'Department "{name}" added.',
    updated: 'Department "{name}" saved.',
    archived: 'Department archived.',
    merged: 'Merged into "{name}".',
    columns: {
      name: 'Name',
      code: 'Code',
      manager: 'Manager',
      people: 'People',
      assets: 'Assets',
    },
    form: {
      createTitle: 'Add a department',
      editTitle: 'Edit {name}',
      create: 'Add department',
      name: 'Name',
      nameHint: 'Each department has a unique name; capitals and extra spaces do not count.',
      code: 'Code',
      codeHint: 'A short code or cost-centre number, for example MATH.',
      description: 'Description',
      manager: 'Manager',
      noManager: 'No manager',
    },
    archive: {
      title: 'Archive {name}?',
      description: 'The department is hidden from pickers. Its name can be used again.',
      confirm: 'Archive',
      inUseTitle: '{name} is still in use',
      inUseDescription: 'To archive it, the people and assets it holds need another department.',
      inUse: 'Still in use by {usage}. Move them to another department to archive this one.',
      mergeInto: 'Move them to',
      mergeHint: 'Everyone and everything of {name} moves there, then {name} is archived.',
      merge: 'Merge and archive',
    },
    manage: 'Manage departments',
  },
};
