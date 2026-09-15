import { z } from 'zod';

const id = z.string().min(1);
const date = z.iso.datetime({ offset: true });
export const collectionFactFields = ['period', 'material', 'weightG', 'widthMm', 'heightMm', 'targetId', 'coilLabel', 'programmeLabel', 'frequencyLabel'] as const;
export type CollectionFactField = typeof collectionFactFields[number];
export const detectorContextSchema = z.object({
  coilLabel: z.string().max(100).optional(), programmeLabel: z.string().max(100).optional(),
  frequencyLabel: z.string().max(100).optional(),
  groundCondition: z.enum(['dry', 'damp', 'wet', 'mixed', 'unknown']).optional(),
  groundNotes: z.string().max(1000).optional(),
}).strict();
export type DetectorContext = z.infer<typeof detectorContextSchema>;
export const collectionSchema = z.object({
  id, projectId: id, title: z.string().min(1).max(100, 'Collection title must be 100 characters or fewer.').refine(value => !!value.trim(), 'Enter a collection title.'),
  introduction: z.string().max(2000, 'Introduction must be 2,000 characters or fewer.'), templateId: z.literal('museum'),
  coverItemId: id.optional(), createdAt: date, updatedAt: date,
}).strict();
export const collectionItemSchema = z.object({
  id, collectionId: id, findId: id, position: z.number().int().nonnegative(),
  selectedMediaIds: z.array(id).max(2).refine(ids => new Set(ids).size === ids.length),
  cropSettings: z.record(id, z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).strict()).optional(),
  displayTitle: z.string().max(120, 'Display title must be 120 characters or fewer.').optional(), caption: z.string().max(1000, 'Caption must be 1,000 characters or fewer.').optional(),
  interpretationStatus: z.enum(['tentative', 'supported']).optional(),
  selectedFactFields: z.array(z.enum(collectionFactFields)).refine(fields => new Set(fields).size === fields.length),
  sourceFingerprintWhenReviewed: z.string().max(20000).optional(),
  createdAt: date, updatedAt: date,
}).strict();
export const detectorGroupSchema = z.object({
  id, projectId: id, displayName: z.string().min(1).max(100), detectorModel: z.string().max(100).optional(), createdAt: date, updatedAt: date,
}).strict();
export const detectorAliasSchema = z.object({
  id, projectId: id, groupId: id, sourceDetectorName: z.string().min(1).max(200), normalizedName: z.string().min(1).max(200), createdAt: date,
}).strict();
export const detectorAssignmentSchema = z.object({ id, projectId: id, groupId: id, findId: id, createdAt: date }).strict();
export type FindCollection = z.infer<typeof collectionSchema>;
export type CollectionItem = z.infer<typeof collectionItemSchema>;
export type DetectorReferenceGroup = z.infer<typeof detectorGroupSchema>;
export type DetectorReferenceAlias = z.infer<typeof detectorAliasSchema>;
export type DetectorReferenceAssignment = z.infer<typeof detectorAssignmentSchema>;
export const normalizeDetectorName = (name: string) => name.trim().toLowerCase();
export const orderCollectionItems = (items: CollectionItem[]) => [...items].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
