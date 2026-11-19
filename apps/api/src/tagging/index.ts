// Public facade of the tagging module (M2-TAG-02): label templates, label batches, the renderer.
export { LabelPipeline } from './label-pipeline.js';
export { LabelsService, batchFilename, templateDto, toRenderTemplate } from './labels.service.js';
export { LABEL_SWEEP_JOB, RENDER_JOB } from './jobs.js';
export {
  LabelRenderError,
  code128Modules,
  code128Widths,
  planLabel,
  qrMatrix,
  renderLabelPdf,
  unprintableCode128Tags,
  type LabelItem,
  type RenderInput,
  type RenderResult,
} from './render.js';
export {
  LABEL_MAX_ASSETS,
  LABEL_MAX_COPIES,
  LABEL_MAX_LABELS,
  LABEL_RETENTION_HOURS,
} from './schemas.js';
export {
  LABEL_CODES,
  LABEL_FIELDS,
  LABEL_TEMPLATES,
  codesOf,
  pagesNeeded,
  slotRect,
  slotsPerPage,
  type LabelCode,
  type LabelField,
  type RenderTemplate,
  type TemplateGeometry,
} from './templates.js';
export { TaggingModule } from './tagging.module.js';
