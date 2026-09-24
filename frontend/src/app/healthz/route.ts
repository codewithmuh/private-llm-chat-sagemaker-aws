/**
 * Health check for the load balancer / container orchestrator.
 * Answers without touching the API, so the web container is "healthy" as long
 * as Node is serving requests.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
