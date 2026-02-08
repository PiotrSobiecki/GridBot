import crypto from "crypto";

// 32‑bajtowy klucz w HEX, z .env: API_ENCRYPTION_KEY=...
const RAW_KEY = (process.env.API_ENCRYPTION_KEY || "").trim();

let ENC_KEY = null;
if (RAW_KEY && RAW_KEY.length === 64) {
  ENC_KEY = Buffer.from(RAW_KEY, "hex");
} else {
  console.warn(
    "⚠️ CryptoService: API_ENCRYPTION_KEY not set or invalid length – API keys will be stored in PLAIN TEXT (DEV only)."
  );
}

const IV_LENGTH = 16; // AES‑256‑CBC

export function encrypt(value) {
  if (!value) return null;
  if (!ENC_KEY) {
    // DEV fallback – bez szyfrowania
    return value;
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENC_KEY, iv);
  let encrypted = cipher.update(String(value), "utf8", "base64");
  encrypted += cipher.final("base64");
  return iv.toString("base64") + ":" + encrypted;
}

export function decrypt(encValue) {
  if (!encValue) return null;
  if (!ENC_KEY) {
    // DEV fallback – bez szyfrowania
    return encValue;
  }
  const [ivB64, dataB64] = String(encValue).split(":");
  if (!ivB64 || !dataB64) return null;
  const iv = Buffer.from(ivB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENC_KEY, iv);
  let decrypted = decipher.update(dataB64, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export default { encrypt, decrypt };

