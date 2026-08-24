export function hasDeclaredReajusteContentLength(request: Request) {
  return request.headers.has("content-length");
}
