/** New raw creation only. Persisted revisions and signed snapshots are read unchanged. */
export function defaultNewEscalaWorkBlocks(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("policy" in value)) return value;
  const policy = value.policy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy) || Object.hasOwn(policy, "limitContinuousWorkBlocks")) return value;
  return { ...value, policy: { ...policy, limitContinuousWorkBlocks: true } };
}
