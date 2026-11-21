// The three purges (POLY-137 R5.2). Each calls its own definer wrapper once and reports the count.
import { purgeMailOutbox, purgeSignInRecord, purgeTxIdentity } from '@poly/db/jobs';

export const purgeTxIdentityJob = async () => ({ deleted: await purgeTxIdentity() });
export const purgeSignInRecordJob = async () => ({ deleted: await purgeSignInRecord() });
export const purgeMailOutboxJob = async () => ({ deleted: await purgeMailOutbox() });
