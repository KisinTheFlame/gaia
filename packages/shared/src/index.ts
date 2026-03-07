import { z } from "zod";

export const ConfigKeySchema = z.string().trim().min(1, "key 不能为空");
export const ConfigValueSchema = z.string();
export const ConfigUpdatedAtSchema = z.string().datetime({ offset: true });

export const GetConfigQuerySchema = z.object({
  key: ConfigKeySchema,
});

export const DeleteConfigQuerySchema = z.object({
  key: ConfigKeySchema,
});

export const SetConfigRequestSchema = z.object({
  key: ConfigKeySchema,
  value: ConfigValueSchema,
});

export const ListConfigsQuerySchema = z.object({
  query: z.string().trim().default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const ConfigResponseSchema = z.object({
  key: ConfigKeySchema,
  value: ConfigValueSchema,
});

export const ConfigListItemSchema = z.object({
  key: ConfigKeySchema,
  valuePreview: z.string(),
  updatedAt: ConfigUpdatedAtSchema,
});

export const ListConfigsResponseSchema = z.object({
  items: z.array(ConfigListItemSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
});

export const DeleteConfigResponseSchema = ConfigResponseSchema.extend({
  deleted: z.literal(true),
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
  key: ConfigKeySchema.optional(),
});

export const GaiaClientConfigSchema = z.object({
  baseUrl: z.string().url(),
});

export type GetConfigQuery = z.infer<typeof GetConfigQuerySchema>;
export type DeleteConfigQuery = z.infer<typeof DeleteConfigQuerySchema>;
export type SetConfigRequest = z.infer<typeof SetConfigRequestSchema>;
export type ListConfigsQuery = z.infer<typeof ListConfigsQuerySchema>;
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;
export type ConfigListItem = z.infer<typeof ConfigListItemSchema>;
export type ListConfigsResponse = z.infer<typeof ListConfigsResponseSchema>;
export type DeleteConfigResponse = z.infer<typeof DeleteConfigResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type GaiaClientConfig = z.infer<typeof GaiaClientConfigSchema>;
