/**
 * English messages of linking a person and a login account (M2-USR-03, ED-22): the dialogs of the
 * person page and of Settings -> Users.
 */
export const loginLinkMessages = {
  loginLink: {
    link: 'Link to a login',
    unlink: 'Unlink login',
    linkPerson: 'Link to a person',
    unlinkPerson: 'Unlink person',
    personColumn: 'Person',
    noPerson: 'None',
    linkTitle: 'Link {name} to a login',
    linkDescription: 'Choose the login account this person signs in with.',
    linkPersonTitle: 'Link {name} to a person',
    linkPersonDescription:
      'Choose the person this login belongs to: the one who holds the assets and has the history.',
    loginLabel: 'Login account',
    personLabel: 'Person',
    loginPlaceholder: 'Search by name or email',
    noLogin: 'No login account matches.',
    noPersonFound: 'No person without a login matches.',
    impact:
      '{person} will sign in as {login}. The empty person record the login came with is archived. Everything {person} holds, and the whole history, stays as it is.',
    confirmLink: 'Link login',
    linked: '{person} is now linked to {login}.',
    unlinkTitle: 'Unlink {name} from their login?',
    unlinkDescription:
      '{name} keeps everything they hold and their history, but is no longer the person behind {login}.',
    unlinkImpact:
      'The login account gets a new, empty person record. Nobody is signed out and nothing is deleted.',
    unlinkedLogin: 'the login account',
    confirmUnlink: 'Unlink',
    unlinked: '{person} was unlinked from their login.',
    invited: 'invited',
    loadFailed: 'We could not load the login accounts.',
  },
};
