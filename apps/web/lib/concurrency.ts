/** Throws before a stale client can overwrite a newer record. */
export function assertExpectedVersion(expected: number | undefined, actual: number, label: string) {
  if ((expected ?? 0) !== actual) throw new Error(`${label}: conflict`);
}
