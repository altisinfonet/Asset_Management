/**
 * English messages of the undo toast after a custody action (M2-UX-02, ED-23). The undo is a new
 * inverse action recorded in the history, never a delete; it is offered for a short while only.
 */
export const undoMessages = {
  custodyUndo: {
    action: 'Undo',
    hint: 'You can undo this for {seconds} seconds.',
    undone: 'Undone: {tag} is back as it was.',
    undoneBulk_one: 'Undone: {count} asset is back as it was.',
    undoneBulk_other: 'Undone: {count} assets are back as they were.',
    undoneSome: 'Undone: {done} of {total} assets. {failed} could not be undone.',
    changed: '{tag} changed in the meantime, so this cannot be undone.',
    tooLate: 'Too late to undo {tag}.',
    refused: '{tag} cannot be undone: {reason}',
    failed: 'We could not undo {tag}.',
  },
};
