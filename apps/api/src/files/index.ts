// Public facade of the files module (M2-FILE). Other modules import from here only.
export {
  AttachmentsService,
  SCAN_JOB,
  SWEEP_JOB,
  THUMBNAIL_JOB,
  type AttachmentDto,
  type AttachmentRow,
} from './attachments.service.js';
export {
  ALLOWED_TYPES,
  checkDeclaredType,
  findAllowedType,
  isImageMime,
  isThumbnailable,
  sniffContent,
  type AllowedType,
} from './content.js';
export { FilesModule } from './files.module.js';
export { AttachmentPipeline } from './pipeline.js';
export { OWNER_TYPES, type OwnerType } from './schemas.js';
export { TIER_MAX_BYTES, effectiveMaxBytes, parseFilesSettings } from './settings.js';
