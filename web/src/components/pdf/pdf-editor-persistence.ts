/** Keep draft writes ordered even when an earlier request fails. */
export function createEditorPersistenceQueue() {
  let tail: Promise<void> = Promise.resolve();
  return (save: () => Promise<void>) => {
    const pending = tail.then(save);
    tail = pending.catch(() => undefined);
    return pending;
  };
}

export async function saveEditorDraft(
  jobId: string,
  body: string,
  signal?: AbortSignal,
) {
  const fallback = "Não foi possível salvar suas alterações. Tente novamente.";
  let response: Response;
  try {
    response = await fetch(`/api/pdf/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(fallback);
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error?.message || fallback);
  }
}
