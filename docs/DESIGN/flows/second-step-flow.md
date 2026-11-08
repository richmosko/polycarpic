# Flow: Second step and step-up

**Story (PRD §5, access):** As an owner or manager, I want my sign-in to need more than a password, so that a stolen password alone can never export, purge, link a bank or let someone in; as a viewer, I want the same protection offered but not forced.

```mermaid
flowchart TD
  invite([Invite as owner or\nmanager accepted]) --> enrol
  raise([Viewer raised to manager\nor owner, approvals done]) --> held[Role waits:\nviewer access kept,\nnotice to set up a second step]
  held --> enrol[Set up a second step:\nauthenticator app or passkey,\nthen ten backup codes]
  enrol --> active([New role in force])
  signin([Sign in on a new device]) --> ask[Password, or Google /\nApple / GitHub,\nthen code or passkey]
  ask --> known([Signed in; the device asks\nnothing more until the session ends])
  risky([Export, purge, grant access,\nlink a bank, answer a request]) --> fresh{Checked in the\nlast 5 minutes?}
  fresh -- yes --> go([Action runs])
  fresh -- no --> stepup[Confirm it's you:\npassword and code, or a passkey]
  stepup --> go
  first([No second step yet:\ncreate an entity, share\nthe own Person, or a step-up action]) --> gate[Set up a second step first:\npassword, then app or passkey,\nthen ten backup codes]
  gate -- cancel --> none([Nothing changes])
  gate --> go
  lost([Every method lost]) --> reset[The operator resets\nthe second step on the box]
  reset --> enrol
```

**Notes**
- **Required for owners and managers, offered to viewers.** The owner role on a user's own Person is exempt while that Person has no other member. Anyone joining as owner or manager sets up an authenticator app or a passkey on Sign up, before landing (`sign-up.html#second-step`). A viewer sees the same step with **Skip for now**, which defers it to the first action that needs it. Signing up or in with Google, Apple or GitHub exempts no one, because the app cannot see the provider's own second factor.
- **Two methods, then backup codes.** The choice is two radio cards, Authenticator app (a QR code, the key typed out, and a 6-digit check) or Passkey. Ten single-use backup codes follow, shown once.
- **A role raise waits for the second step.** When a viewer without one is raised to manager or owner (after any co-owner approval), the new role does not take effect until they set one up; they keep viewer access meanwhile, and the notice "You are now a manager of <entity>. Set up a second sign-in step to start; until then you keep viewer access." links to Settings → Sign-in and second step. The members list shows their new role with an outline `Waiting for second step` badge.
- **Set up a second step first.** A user with no second step whose only role is owner of their own unshared Person signs in and views freely. Creating a Trust, Business, Household or Holding, the first invite to their own Person, and any step-up action (export, purge, granting access, linking a bank, deleting the account) open one interstitial instead: "Set up a second step first", a subtitle naming the action, the password, then the Sign-up enrolment block (the two method cards, QR code and 6-digit check), **Turn on and continue**, the backup codes, and the action runs. Setting up counts as the fresh check. Cancel changes nothing. Shown on `entities.html` (Create entity, reference).
- **Asked on a new device, not every time.** After the password (or an OAuth provider), a new device asks for the code, with **Use a passkey instead** and **Use a backup code** below (`login.html#second-step`). A known device asks nothing until its session ends.
- **Step-up before risky actions.** Export, purge, granting access or changing a role, linking or unlinking a bank, answering a co-owner request, forcing a removal, transferring the founder role, deleting the account, and removing a second-step method each open **Confirm it's you** for a user with a second step, unless the user was checked in the last 5 minutes: password and code, or a passkey. A user without a password (Google, Apple or GitHub only) is sent to that provider to sign in again, then asked for the code. The dialog names the action ("Exporting Mosko (Person) needs a fresh check") and says it won't ask again for 5 minutes.
- **Settings → Sign-in and second step** lists each method with the date it was added and **Remove**, **Add passkey**, the backup codes left with **Make new codes**, and **Change password**. While the user is an owner or manager on any entity other than their own unshared Person, the last method has no Remove, and the panel says why.
- **Lockout.** "Lost every method? The person who runs this instance can reset your second step." There is no in-app recovery: the operator's audited reset on the box is the path.
