// The one exported BetterAuth configuration (SECURITY A-33, A-34; POLY-86 ruling R1). The app and every test build from
// authOptions(input). Nothing here reads the environment: the caller passes what it loaded.
import { passkey } from '@better-auth/passkey';
import { authFields } from '@poly/db/auth';
import { magicLink, twoFactor } from 'better-auth/plugins';
import { githubUserInfo } from './github.ts';
import { passkeyOnlyHold } from './second-step.ts';
import { routePolicyHook, type TlsMode } from './route-policy.ts';
import { createRoutingPool } from './routing-pool.ts';
import { accountDropIdToken, userCreateAfter, userCreateBefore, userUpdateBefore } from './user-hooks.ts';

const DAY = 86400;
/** C-04: five a minute per IP on the credential and verification paths (S19). */
const LIMITED = ['/sign-in/email', '/sign-in/magic-link', '/sign-up/email', '/request-password-reset', '/two-factor/verify-totp', '/two-factor/verify-backup-code', '/passkey/verify-authentication'];
const customRules = Object.fromEntries(LIMITED.map((p) => [p, { window: 60, max: 5 }]));

export interface Provider {
  clientId: string;
  clientSecret: string;
}
export interface AuthInput {
  secret: string;
  baseURL: string;
  tlsMode: TlsMode;
  google?: Provider;
  github?: Provider;
  /** S19: refuse an /api/auth/* request whose client IP does not resolve (true outside development). */
  requireClientIp: boolean;
  sendMagicLink: (m: { email: string; token: string; url: string }) => Promise<void>;
}

/** Fields are read from db/auth at call time, so the startup check sees exactly the map in force. */
export function authOptions(input: AuthInput) {
  const f = authFields;
  const origin = new URL(input.baseURL).origin;
  return {
    appName: 'polycarpic',
    secret: input.secret,
    baseURL: input.baseURL,
    trustedOrigins: [origin],
    database: createRoutingPool(),
    emailAndPassword: { enabled: true, revokeSessionsOnPasswordReset: true },
    socialProviders: {
      ...(input.google ? { google: input.google } : {}),
      ...(input.github ? { github: { ...input.github, getUserInfo: githubUserInfo } } : {}),
    },
    user: {
      modelName: 'user',
      fields: {
        name: f.user.fields.name,
        email: f.user.fields.email,
        emailVerified: f.user.fields.emailVerified,
        image: f.user.fields.image,
        createdAt: f.user.fields.createdAt,
        updatedAt: f.user.fields.updatedAt,
      },
      additionalFields: {
        secondStepAt: { type: 'date', required: false, input: false, fieldName: f.user.fields.secondStepAt },
      },
      deleteUser: { enabled: false },
    },
    session: {
      modelName: 'session',
      fields: {
        expiresAt: f.session.fields.expiresAt,
        token: f.session.fields.token,
        createdAt: f.session.fields.createdAt,
        updatedAt: f.session.fields.updatedAt,
        ipAddress: f.session.fields.ipAddress,
        userAgent: f.session.fields.userAgent,
        userId: f.session.fields.userId,
      },
      additionalFields: {
        recentAuthAt: { type: 'date', required: false, input: false, fieldName: f.session.fields.recentAuthAt },
      },
      expiresIn: 7 * DAY,
      updateAge: DAY,
      freshAge: 30 * DAY,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: 'account',
      fields: {
        accountId: f.account.fields.accountId,
        providerId: f.account.fields.providerId,
        userId: f.account.fields.userId,
        accessToken: f.account.fields.accessToken,
        refreshToken: f.account.fields.refreshToken,
        idToken: f.account.fields.idToken,
        accessTokenExpiresAt: f.account.fields.accessTokenExpiresAt,
        refreshTokenExpiresAt: f.account.fields.refreshTokenExpiresAt,
        scope: f.account.fields.scope,
        password: f.account.fields.password,
        createdAt: f.account.fields.createdAt,
        updatedAt: f.account.fields.updatedAt,
      },
      encryptOAuthTokens: true,
    },
    verification: {
      storeIdentifier: 'hashed' as const,
      modelName: 'verification',
      fields: {
        identifier: f.verification.fields.identifier,
        value: f.verification.fields.value,
        expiresAt: f.verification.fields.expiresAt,
        createdAt: f.verification.fields.createdAt,
        updatedAt: f.verification.fields.updatedAt,
      },
    },
    rateLimit: { enabled: true, storage: 'memory' as const, customRules },
    requireClientIp: input.requireClientIp,
    advanced: {
      // __Host-: Secure, Path=/, no Domain. BetterAuth's own secure prefix is __Secure-, so the secure prefix is turned off
      // and Secure forced on, with the prefix carried in the cookie name.
      useSecureCookies: false,
      cookiePrefix: '__Host-better-auth',
      defaultCookieAttributes: { secure: true, sameSite: 'lax' as const, path: '/', httpOnly: true },
      database: { generateId: 'uuid' as const },
      // S19: one header, as Caddy writes it, one entry; no trustedProxies so BetterAuth's single-entry rule applies.
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'], ipv6Subnet: 64 },
    },
    databaseHooks: {
      user: { create: { before: userCreateBefore, after: userCreateAfter }, update: { before: userUpdateBefore } },
      account: { create: { before: accountDropIdToken }, update: { before: accountDropIdToken } },
    },
    hooks: { before: routePolicyHook(input.tlsMode), after: passkeyOnlyHold },
    plugins: [
      twoFactor({
        allowPasswordless: true,
        trustDeviceMaxAge: 30 * DAY,
        schema: {
          user: { fields: { twoFactorEnabled: f.user.fields.twoFactorEnabled } },
          twoFactor: {
            modelName: 'two_factor',
            fields: {
              secret: f.twoFactor.fields.secret,
              backupCodes: f.twoFactor.fields.backupCodes,
              userId: f.twoFactor.fields.userId,
              verified: f.twoFactor.fields.verified,
              failedVerificationCount: f.twoFactor.fields.failedVerificationCount,
              lockedUntil: f.twoFactor.fields.lockedUntil,
            },
          },
        },
      }),
      magicLink({ sendMagicLink: input.sendMagicLink, storeToken: 'hashed' }),
      passkey({
        rpName: 'polycarpic',
        schema: {
          passkey: {
            modelName: 'passkey',
            fields: {
              name: f.passkey.fields.name,
              publicKey: f.passkey.fields.publicKey,
              userId: f.passkey.fields.userId,
              credentialID: f.passkey.fields.credentialID,
              counter: f.passkey.fields.counter,
              deviceType: f.passkey.fields.deviceType,
              backedUp: f.passkey.fields.backedUp,
              transports: f.passkey.fields.transports,
              createdAt: f.passkey.fields.createdAt,
              aaguid: f.passkey.fields.aaguid,
            },
          },
        },
      }),
    ],
  };
}
