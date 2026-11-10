// `polycarpic status`: the client for the loopback status listener, run inside the web container so the image needs no
// curl or wget. Prints the JSON payload; exit 0 on 200, 1 otherwise.
export {};

const port =Number(process.env.STATUS_PORT) || 8081;

try {
  const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(5000) });
  process.stdout.write(`${await res.text()}\n`);
  process.exit(res.status === 200 ? 0 : 1);
} catch {
  process.stderr.write('status: the status listener did not answer\n');
  process.exit(1);
}
