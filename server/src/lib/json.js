// JSON serialisation for API responses. Money columns are BigInt in the database;
// the API returns them as plain numbers (minor units). Amounts beyond
// Number.MAX_SAFE_INTEGER (≈ 9 trillion JOD) are impossible by validation, so
// hitting one is a bug and fails loudly instead of losing precision.
export function bigIntReplacer(_key, value) {
  if (typeof value !== 'bigint') return value;
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Integer too large to serialise safely');
  }
  return Number(value);
}

/** Plain JSON copy (BigInt → number, Date → ISO string), e.g. for Json columns. */
export function toPlainJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value, bigIntReplacer));
}
