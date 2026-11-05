import { safeStorage } from 'electron'

export interface SecretBox {
  available(): boolean
  encrypt(value: string): string
  decrypt(value: string): string
}

/**
 * MCP 敏感值的加密边界。
 *
 * 正常情况下使用 Electron safeStorage（macOS Keychain / Windows DPAPI /
 * Linux keyring）。测试或无系统密钥环时使用明确标记的 base64 回退，
 * 保证功能可用，但设置页会提示该环境没有系统级加密。
 */
export class SafeStorageSecretBox implements SecretBox {
  available(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  encrypt(value: string): string {
    if (this.available()) {
      return `ss1:${safeStorage.encryptString(value).toString('base64')}`
    }
    return `b64:${Buffer.from(value, 'utf8').toString('base64')}`
  }

  decrypt(value: string): string {
    if (value.startsWith('ss1:')) {
      if (!this.available()) throw new Error('系统密钥环不可用，无法解密 MCP 凭据')
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
    }
    if (value.startsWith('b64:')) {
      return Buffer.from(value.slice(4), 'base64').toString('utf8')
    }
    // 兼容早期直接写 Base64 的数据。
    return Buffer.from(value, 'base64').toString('utf8')
  }
}
