// The internal listener's one route (POLY-152 R6.2): GET /session. The handler lives in @poly/auth (handleSessionRequest) with its
// own path, method and query guard, so the tests and this listener run the same code; any other request is 404.
export { handleSessionRequest as handleInternal } from '@poly/auth';
