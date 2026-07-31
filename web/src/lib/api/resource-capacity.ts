import { jsonError } from "@/lib/api/security";
import {
  assertResourceCapacity,
  ResourceCapacityError,
  type ResourceCapacityRequest,
} from "@/lib/system/resource-capacity";

export function resourceCapacityErrorResponse(error: unknown) {
  if (!(error instanceof ResourceCapacityError)) {
    return null;
  }

  return jsonError(
    error.code === "PDF_QUEUE_CAPACITY_REACHED" ? 503 : 507,
    error.code,
    error.message,
  );
}

export async function requireResourceCapacity(
  request: ResourceCapacityRequest,
) {
  try {
    await assertResourceCapacity(request);
    return null;
  } catch (error) {
    const response = resourceCapacityErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
