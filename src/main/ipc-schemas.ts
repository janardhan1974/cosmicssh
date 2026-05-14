// Zod schemas for runtime validation of IPC payloads entering the main
// process. Kept out of src/shared/ because the sandboxed preload cannot load
// third-party node modules.

import { z } from 'zod'

// ─── SSH ───────────────────────────────────────────────────────────────────
export const ConnectPayloadSchema = z.object({
  host: z.string().min(1, 'host is required'),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1, 'username is required'),
  password: z.string(),
})

export const ConnectByProfilePayloadSchema = z.object({
  profileId: z.string().min(1),
  passwordOverride: z.string().optional(),
})

export const WritePayloadSchema = z.object({
  sessionId: z.string().min(1),
  data: z.string(),
})

export const ResizePayloadSchema = z.object({
  sessionId: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
})

export const DisconnectPayloadSchema = z.object({
  sessionId: z.string().min(1),
})

// ─── Profiles ──────────────────────────────────────────────────────────────
const AuthMethodSchema = z.enum(['password', 'key', 'agent'])

export const ProfileDraftSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  authMethod: AuthMethodSchema,
  keyPath: z.string().optional(),
  jumpHost: z.string().optional(),
  group: z.string().optional(),
  savePassword: z.boolean(),
})

export const SessionProfileSchema = ProfileDraftSchema.extend({
  id: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  lastUsedAt: z.number().int().nonnegative().optional(),
})

export const ProfileIdSchema = z.string().min(1)

// ─── Credentials ───────────────────────────────────────────────────────────
export const CredentialSavePayloadSchema = z.object({
  profileId: z.string().min(1),
  password: z.string(),
})

export const CredentialIdPayloadSchema = z.object({
  profileId: z.string().min(1),
})

// ─── Settings ─────────────────────────────────────────────────────────────
export const TerminalSettingsSchema = z.object({
  fontFamily: z.string().min(1),
  fontSize: z.number().int().min(6).max(48),
})

// ─── helper ────────────────────────────────────────────────────────────────
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
): z.infer<T> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new Error(`invalid IPC payload: ${result.error.message}`)
  }
  return result.data
}
