// Encryption/decryption for sensitive credentials stored in the database.
// Uses AES-256-GCM with a key derived from CREDENTIAL_ENCRYPTION_KEY env var.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const SALT = "investogenie-credential-salt"; // Static salt for key derivation
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits for GCM

function getEncryptionKey(): Buffer {
  const masterKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!masterKey) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY env var is required for credential storage",
    );
  }

  // Derive a consistent key using scrypt
  return scryptSync(masterKey, SALT, KEY_LENGTH);
}

/** Encrypt a sensitive value (API key, password, etc.) */
export function encryptCredential(value: string): string {
  if (!value) return "";

  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(value, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encryptedData (all hex)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/** Decrypt a stored credential */
export function decryptCredential(encryptedValue: string): string {
  if (!encryptedValue) return "";

  const key = getEncryptionKey();
  const parts = encryptedValue.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted credential format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
