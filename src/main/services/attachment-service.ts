import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AttachmentInput } from '@shared/types'
import { getAttachmentsDir } from '../paths'

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

function safeName(name: string): string {
  return basename(name)
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .slice(0, 120) || 'attachment'
}

export class AttachmentService {
  save(input: AttachmentInput): {
    name: string
    path: string
    mime: string
    size: number
  } {
    const buffer = Buffer.from(input.data)
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error('ATTACHMENT_TOO_LARGE')
    }
    const dir = getAttachmentsDir()
    mkdirSync(dir, { recursive: true })
    const name = safeName(input.name)
    const path = join(dir, `${randomUUID()}-${name}`)
    writeFileSync(path, buffer)
    return { name, path, mime: input.mime, size: buffer.byteLength }
  }
}
