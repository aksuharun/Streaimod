import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { getRequiredEnv } from '../config/env.js'
import type { IStoredSecret } from '../models/user.js'

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'

function getEncryptionKey(): Buffer {
  return createHash('sha256')
    .update(getRequiredEnv('AUTH_TOKEN_ENCRYPTION_KEY'))
    .digest()
}

export function encryptSecret(value: string): IStoredSecret {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    ciphertext: ciphertext.toString('base64url')
  }
}

export function decryptSecret(secret: IStoredSecret | null | undefined): string | null {
  if (!secret) {
    return null
  }

  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    getEncryptionKey(),
    Buffer.from(secret.iv, 'base64url')
  )

  decipher.setAuthTag(Buffer.from(secret.tag, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64url')),
    decipher.final()
  ]).toString('utf8')
}
