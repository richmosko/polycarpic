// The public listener (POLY-152 R1.1): handleAuthRequest for /api/auth and /api/auth/*, and nothing else. Caddy routes nothing but
// that tree here, and this listener refuses the rest as well.
import { handleAuthRequest } from '@poly/auth';

type Auth = Parameters<typeof handleAuthRequest>[1];

const notFound = () => new Response(JSON.stringify({ message: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });

export async function handlePublic(request: Request, auth: Auth): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname !== '/api/auth' && !pathname.startsWith('/api/auth/')) return notFound();
  return handleAuthRequest(request, auth);
}
