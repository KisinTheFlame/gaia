import { z } from "zod";

export const ConfigKeySchema = z.string().trim().min(1, "key 不能为空");
export const ConfigValueSchema = z.string();

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

export const ConfigResponseSchema = z.object({
  key: ConfigKeySchema,
  value: ConfigValueSchema,
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
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;
export type DeleteConfigResponse = z.infer<typeof DeleteConfigResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type GaiaClientConfig = z.infer<typeof GaiaClientConfigSchema>;
