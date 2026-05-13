// Zod schemas for runtime validation of IPC payloads entering the main
// process. Kept out of src/shared/ because the sandboxed preload cannot load
// third-party node modules.

import { z } from 'zod'

export const ConnectPayloadSchema = z.object({
  host: z.string().min(1, 'host is required'),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1, 'username is required'),
  password: z.string(), // empty allowed; ssh2 rejects if server requires it
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
