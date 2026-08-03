import crypto from "crypto";

/**
 * Turns a digital ID record into a deterministic SHA-256 fingerprint.
 *
 * "Deterministic" means: the exact same input ALWAYS produces the
 * exact same hash. Change one character in the input, and the
 * output hash changes completely and unpredictably. That's what
 * makes this useful for tamper detection.
 *
 * @param {object} record - the digital ID fields we want to fingerprint
 * @returns {string} a 64-character hex string, e.g. "a3f5b8c1..."
 */
export function hashDigitalIdRecord(record) {
  // 1. Turn the record into a consistent string.
  //    We sort the keys alphabetically first — otherwise
  //    {a:1, b:2} and {b:2, a:1} would hash differently
  //    even though they mean the same thing.
  const sortedKeys = Object.keys(record).sort();
  const normalized = sortedKeys
    .map((key) => `${key}:${record[key]}`)
    .join("|");

  // 2. Run it through SHA-256, a one-way cryptographic hash function.
  //    "One-way" = you can't reverse a hash back into the original data.
  const hash = crypto.createHash("sha256").update(normalized).digest("hex");

  return hash;
}