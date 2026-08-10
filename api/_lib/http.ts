/**
 * One place that decides how these endpoints speak JSON, so a handler can never
 * forget the content-type and ship a body the browser parses as text.
 */
export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}
