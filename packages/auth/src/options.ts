// The one exported BetterAuth configuration (SECURITY A-33, A-34; POLY-86 ruling R1). The app and every test build from
// authOptions(input). Nothing here reads the environment: the caller passes what it loaded.
import { passkey } from '@better-auth/passkey';
import { authFields } from '@poly/db/auth';
import { magicLink, twoFactor } from 'better-auth/plugins';
import { passkeyOnlyHold } from './second-step.ts';
import { routePolicyHook, type TlsMode } from './route-policy.ts';
import { createRoutingPool } from './routing-pool.ts';
import { accountDropIdToken, userCreateBefore, userUpdateBefore } from './user-hooks.ts';

const DAY = 86400;

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
      ...(input.github ? { github: input.github } : {}),
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
      modelName: 'verification',
      fields: {
        identifier: f.verification.fields.identifier,
        value: f.verification.fields.value,
        expiresAt: f.verification.fields.expiresAt,
        createdAt: f.verification.fields.createdAt,
        updatedAt: f.verification.fields.updatedAt,
      },
    },
    rateLimit: { enabled: true, storage: 'memory' as const },
    advanced: {
      // __Host-: Secure, Path=/, no Domain. BetterAuth's own secure prefix is __Secure-, so the secure prefix is turned off
      // and Secure forced on, with the prefix carried in the cookie name.
      useSecureCookies: false,
      cookiePrefix: '__Host-better-auth',
      defaultCookieAttributes: { secure: true, sameSite: 'lax' as const, path: '/', httpOnly: true },
      database: { generateId: 'uuid' as const },
    },
    databaseHooks: {
      user: { create: { before: userCreateBefore }, update: { before: userUpdateBefore } },
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
      magicLink({ sendMagicLink: input.sendMagicLink }),
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
