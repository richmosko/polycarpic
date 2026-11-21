// The worker's schedule (POLY-137 R5.2): each job runs once at start, then at a fixed interval, and never overlaps itself. A run that throws
// is logged and the next tick still runs.
import type { Fields } from '@poly/config/log';

export interface Job {
  name: string;
  everyMs: number;
  /** The counts to log with the run: { deleted } or { sent, failed }. */
  run(): Promise<Fields | void>;
}
export interface JobLog {
  info(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
}

export function startSchedule(jobs: readonly Job[], log: JobLog): { stop(): void } {
  const timers: ReturnType<typeof setInterval>[] = [];
  for (const job of jobs) {
    let running = false;
    const tick = async (): Promise<void> => {
      if (running) return; // a run still going skips this tick
      running = true;
      const t0 = Date.now();
      try {
        const counts = (await job.run()) ?? {};
        log.info('job.run', { job: job.name, outcome: 'ok', ...counts, ms: Date.now() - t0 });
      } catch (err) {
        log.error('job.run', { job: job.name, outcome: 'error', err, ms: Date.now() - t0 });
      } finally {
        running = false;
      }
    };
    void tick();
    timers.push(setInterval(() => void tick(), job.everyMs));
  }
  return { stop: () => timers.forEach((t) => clearInterval(t)) };
}
