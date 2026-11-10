// Start-up guard: refuse to start when the applied schema is behind the image (ARCH §8.1; POLY-83 ruling R7).
// Importable by apps/web and apps/worker alone (layers.json). Stub until POLY-83 lands it.
export {};
