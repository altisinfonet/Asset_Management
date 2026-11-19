// Public facade of the people module (M2-USR-01). Other modules import from here only.
export { PeopleModule } from './people.module.js';
export { PeopleService, personDto } from './people.service.js';
export { PERSON_KINDS, PERSON_STATUSES } from './schemas.js';
export { personListSchema, type PersonListQuery } from './schemas.js';
