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
const ProtocolSchema = z.enum(['ssh', 'sftp-only'])

export const ProfileDraftSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  authMethod: AuthMethodSchema,
  protocol: ProtocolSchema.optional(),
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
  theme: z.enum(['dark', 'light', 'blue']),
  textColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '#RRGGBB only')
    .nullable(),
})

// ─── SFTP / Local FS ──────────────────────────────────────────────────────
export const SftpListPayloadSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
})

export const SftpStatPayloadSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
})

export const SftpMkdirPayloadSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
})

export const SftpDeletePayloadSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  isDirectory: z.boolean(),
})

export const SftpRenamePayloadSchema = z.object({
  sessionId: z.string().min(1),
  fromPath: z.string().min(1),
  toPath: z.string().min(1),
})

export const SftpChmodPayloadSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  mode: z.number().int().min(0).max(0o7777),
})

export const SftpUploadPayloadSchema = z.object({
  sessionId: z.string().min(1),
  localPath: z.string().min(1),
  remotePath: z.string().min(1),
})

export const SftpDownloadPayloadSchema = z.object({
  sessionId: z.string().min(1),
  remotePath: z.string().min(1),
  localPath: z.string().min(1),
})

export const SftpUploadFolderPayloadSchema = z.object({
  sessionId: z.string().min(1),
  localPath: z.string().min(1),
  remoteParentPath: z.string().min(1),
})

export const SftpDownloadFolderPayloadSchema = z.object({
  sessionId: z.string().min(1),
  remotePath: z.string().min(1),
  localParentPath: z.string().min(1),
})

export const SftpCancelPayloadSchema = z.object({
  transferId: z.string().min(1),
})

export const SftpEditOpenPayloadSchema = z.object({
  sessionId: z.string().min(1),
  remotePath: z.string().min(1),
})

export const LocalListPayloadSchema = z.object({
  path: z.string(),
})

export const LocalDeletePayloadSchema = z.object({
  path: z.string().min(1),
  isDirectory: z.boolean(),
})

export const PathStringSchema = z.string().min(1)

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
