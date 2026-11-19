// POLY-150 R5: the one pure function that decides each Settings action's state. Cosmetic: the database refuses the same cases.
export type ActionState = 'shown' | 'disabled' | 'hidden';
export type ActionRow = { passkeys: readonly unknown[]; totp_added_at: string | null; needs_a_method: boolean; codes_paused: boolean };
export type ActionStates = { removeApp: ActionState; removePasskey: ActionState; makeNewCodes: ActionState; addPasskey: ActionState };

/** Freshness (recentAuthOk) changes nothing here: a stale action stays shown and opens Confirm it's you. */
export function actionStates(row: ActionRow, _recentAuthOk: boolean): ActionStates {
  const hasApp = row.totp_added_at !== null;
  const methods = row.passkeys.length + (hasApp ? 1 : 0);
  const remove = (present: boolean): ActionState => {
    if (!present) return 'hidden';
    if (row.needs_a_method && methods <= 1) return 'hidden';
    return row.codes_paused ? 'disabled' : 'shown';
  };
  return {
    removeApp: remove(hasApp),
    removePasskey: remove(row.passkeys.length > 0),
    makeNewCodes: hasApp ? 'shown' : 'hidden',
    addPasskey: 'shown',
  };
}
