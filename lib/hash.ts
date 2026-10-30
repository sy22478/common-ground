import { createHmac } from "node:crypto";

// Keyed one-way hashes for anything derived from a visitor (their network address, the words they typed). Stored
// keys can be matched again by the server but cannot be read back into the original text without HASH_SECRET.
export type Hasher = (text: string) => string;

export function keyedHasher(secret: string): Hasher {
  return (text: string) => createHmac("sha256", secret).update(text).digest("hex").slice(0, 32);
}
