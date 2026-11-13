// GitHub's getUserInfo override (POLY-87 ruling S2, SECURITY C-05). BetterAuth's default takes the profile email, which a
// GitHub user can set to an address they do not own, and looks up its verified flag afterwards. A token-less sign-up
// claims invitations by email, so the proof must be the account's primary, verified address from /user/emails, nothing else.
// With no such entry the sign-in is refused (null).

type Token = { accessToken?: string };
type Profile = { id: number | string; login?: string; name?: string | null };
type Email = { email: string; primary: boolean; verified: boolean };

const get = async (url: string, accessToken: string): Promise<unknown | null> => {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'better-auth', authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json' },
    redirect: 'error',
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
};

export async function githubUserInfo(token: Token) {
  if (!token.accessToken) return null;
  const profile = (await get('https://api.github.com/user', token.accessToken)) as Profile | null;
  if (!profile || typeof profile !== 'object') return null;
  const emails = (await get('https://api.github.com/user/emails', token.accessToken)) as Email[] | null;
  const proof = Array.isArray(emails) ? emails.find((e) => e.primary === true && e.verified === true && typeof e.email === 'string') : undefined;
  if (!proof) return null;
  return {
    user: { name: profile.name || profile.login || '', email: proof.email, image: undefined, emailVerified: true },
    data: profile,
  };
}
