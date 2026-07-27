/**
 * @fileoverview AI Field Extraction Module
 *
 * Automatically extracts BANT fields from conversations.
 *
 * @module lib/ai/extraction
 */

export { extractAndUpdateBANT } from './extraction.service';
export {
  extractAndUpdateCustomFields,
  type ExtractCustomFieldsParams,
  type ExtractCustomFieldsResult,
} from './customFields.service';
export {
  buildCustomFieldsSchema,
  coerceValueForField,
  describeField,
  ExtractedCustomFieldSchema,
  type ExtractedCustomField,
  type CustomFieldProvenance,
} from './customFields.schemas';
export {
  BANTExtractionSchema,
  type BANTExtraction,
  type AIExtractedData,
  type AIExtractedField,
} from './schemas';
