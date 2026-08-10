const MAX_WRITE_CONFLICT_RETRIES = 2;

function isWriteConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}

export async function retryUnimedWriteConflicts<T>(
  operation: () => Promise<T>,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isWriteConflict(error) || attempt >= MAX_WRITE_CONFLICT_RETRIES) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}
