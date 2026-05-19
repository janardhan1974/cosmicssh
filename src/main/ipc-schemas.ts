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
const ProtocolSchema = z.enum(['ssh', 'ssh-shell-only', 'sftp-only'])

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
  logSession: z.boolean().optional(),
  // Auto-updated by SftpPane on every navigate. Long enough for typical
  // paths; effectively unbounded so we don't reject a deeply-nested dir.
  lastLocalPath: z.string().max(4096).optional(),
  lastRemotePath: z.string().max(4096).optional(),
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

// ─── App menu commands (renderer → main) ──────────────────────────────────
// Keep this enum aligned with AppMenuCommand in src/shared/types.ts. The
// dispatcher in main/index.ts switches on the same set; an unknown command
// here would be a runtime no-op there anyway, but failing fast at the IPC
// boundary is cheaper to diagnose.
export const AppMenuCommandSchema = z.enum([
  'new-window',
  'tile-windows-v',
  'tile-windows-h',
  'cascade-windows',
  'show-about',
  'reload',
  'force-reload',
  'toggle-devtools',
  'reset-zoom',
  'zoom-in',
  'zoom-out',
  'toggle-fullscreen',
  'window-minimize',
  'window-close',
])

// ─── Settings ─────────────────────────────────────────────────────────────
// Keep this enum in sync with ColorSchemeId in src/shared/types.ts and the
// COLOR_SCHEMES catalog in src/renderer/src/lib/color-schemes.ts. Renderer
// uses the catalog for the picker; main uses this enum to validate IPC
// payloads. Adding a scheme means touching all three places.
export const TerminalSettingsSchema = z.object({
  fontFamily: z.string().min(1),
  fontSize: z.number().int().min(6).max(48),
  theme: z.enum(['dark', 'light', 'blue']),
  textColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '#RRGGBB only')
    .nullable(),
  colorScheme: z.enum([
    'default',
    'solarized-dark',
    'solarized-light',
    'dracula',
    'gruvbox-dark',
    'gruvbox-light',
    'nord',
    'one-dark',
    'monokai',
    'tomorrow-night',
    'github-light',
  ]),
  brightness: z.number().min(0).max(100),
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

// ─── Session logging ─────────────────────────────────────────────────────
export const LoggingStatusPayloadSchema = z.object({
  sessionId: z.string().min(1),
})

// Cap scrollback dump at 50 MB — defensive bound against a renderer that
// somehow tries to ship the entire universe through IPC. Real xterm
// scrollback at 10k lines × 200 cols × 4 bytes max is ~8 MB.
export const SaveScrollbackPayloadSchema = z.object({
  profileName: z.string(),
  text: z.string().max(50 * 1024 * 1024),
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
