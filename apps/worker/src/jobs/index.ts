// The worker's job table (POLY-137 R5.2).
import type { Fields } from '@poly/config/log';
import type { Mailer } from '@poly/mail';
import { drainMail } from './mail.ts';
import { purgeMailOutboxJob, purgeSignInRecordJob, purgeTxIdentityJob } from './purge.ts';
import type { Job, JobLog } from './schedule.ts';

const MINUTE = 60_000;

export function buildJobs(o: { mailer: Mailer | undefined; origin: string; log: JobLog & { warn(event: string, fields?: Fields): void } }): Job[] {
  const jobs: Job[] = [
    { name: 'purge.tx_identity', everyMs: 15 * MINUTE, run: purgeTxIdentityJob },
    { name: 'purge.sign_in_record', everyMs: 24 * 60 * MINUTE, run: purgeSignInRecordJob },
    { name: 'purge.mail_outbox', everyMs: 24 * 60 * MINUTE, run: purgeMailOutboxJob },
  ];
  if (o.mailer) {
    const mailer = o.mailer;
    jobs.push({ name: 'mail.drain', everyMs: 30_000, run: () => drainMail({ mailer, origin: o.origin }) });
  } else {
    // Development only: check-config refuses a staging or production worker with no key.
    o.log.warn('mail.unconfigured');
  }
  return jobs;
}
export { startSchedule } from './schedule.ts';
