// Public facade of the mail module (M1-PLAT-09). Callers use the MAIL_SENDER port (src/ports).
export { registerMailJob } from './mail-job.js';
export { MAIL_JOB, QueuedMailSender, mailContext, type StoredMail } from './mail-sender.js';
export { CATALOGUES, DEFAULT_LOCALE, resolveLocale, translator, type Catalogue } from './i18n.js';
export {
  PRODUCT_NAME,
  TEMPLATE_IDS,
  TEMPLATE_SCHEMAS,
  TemplateDataError,
  UnknownTemplateError,
  escapeHtml,
  isTemplateId,
  parseTemplateData,
  renderTemplate,
  type RenderedEmail,
  type TemplateData,
  type TemplateId,
} from './templates.js';
export {
  SmtpMailTransport,
  UnconfiguredMailTransport,
  type MailTransport,
  type OutgoingMail,
} from './transport.js';
