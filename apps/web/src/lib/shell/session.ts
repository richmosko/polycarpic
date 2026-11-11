export type ShellSession = {
  user: { id: string; name: string; image: string | null };
  expiresAt: string;
};
