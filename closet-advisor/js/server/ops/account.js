// Accounts: demo sign-in, email sign-up/sign-in, sign-out.
import { ApiError, invalid } from '../errors.js';
import { createSession, endSession, hashPassword, verifyPassword, normalizeEmail, validEmail, toActor } from '../auth.js';
import { newId } from '../../lib/ids.js';
import { defaultProfile } from '../records.js';
import { DEMO_ACCOUNTS } from '../seed.js';

async function sessionResult(ctx, user) {
  const session = await createSession(ctx.db, user.id, ctx.clock);
  return { token: session.token, session: toActor(user), expiresAt: session.expiresAt };
}

export const ops = {
  /** Demo accounts shown on the welcome screen. */
  listDemoAccounts: {
    auth: 'public',
    async run(ctx) {
      const out = [];
      for (const demo of DEMO_ACCOUNTS) {
        const user = await ctx.db.get('users', demo.id);
        if (user) out.push({ id: user.id, displayName: user.displayName, role: user.role, blurb: demo.blurb });
      }
      return out;
    },
  },

  /** args: { userId } of a demo account. */
  signInDemo: {
    auth: 'public',
    async run(ctx, { userId }) {
      const user = userId ? await ctx.db.get('users', userId) : null;
      if (!user || !user.demo) throw new ApiError('not_found', 'That demo account is not available. Reset the demo to restore it.');
      await ctx.metric('sign_in', { method: 'demo', role: user.role });
      return sessionResult(ctx, user);
    },
  },

  /** args: { email, password, displayName }. New accounts are always role 'user'. */
  signUp: {
    auth: 'public',
    async run(ctx, args) {
      const email = normalizeEmail(args.email);
      const displayName = String(args.displayName ?? '').trim().slice(0, 60);
      const password = String(args.password ?? '');
      const errors = {};
      if (!displayName) errors.displayName = 'Enter your name';
      if (!validEmail(email)) errors.email = 'Enter an email address like name@example.com';
      if (password.length < 8) errors.password = 'Use at least 8 characters';
      if (Object.keys(errors).length) throw invalid(errors);
      const existing = await ctx.db.where('users', 'email', email);
      if (existing.length) throw invalid({ email: 'An account with this email already exists in this browser. Sign in instead.' });

      const { hash, salt } = await hashPassword(password);
      const user = {
        id: newId('usr'),
        email,
        displayName,
        role: 'user',
        passwordHash: hash,
        salt,
        createdAt: ctx.iso(),
        analyticsId: newId('anon'),
        demo: false,
      };
      await ctx.db.put('users', user);
      await ctx.db.put('profiles', defaultProfile(user.id));
      await ctx.metric('sign_up', {});
      return sessionResult(ctx, user);
    },
  },

  /** args: { email, password } */
  signIn: {
    auth: 'public',
    async run(ctx, args) {
      const email = normalizeEmail(args.email);
      const [user] = await ctx.db.where('users', 'email', email);
      const ok = user && !user.demo && (await verifyPassword(String(args.password ?? ''), user));
      if (!ok) throw new ApiError('invalid', "That email and password don't match an account in this browser.", { fields: { password: 'Check your email and password' } });
      await ctx.metric('sign_in', { method: 'password', role: user.role });
      return sessionResult(ctx, user);
    },
  },

  signOut: {
    auth: 'any',
    async run(ctx) {
      await endSession(ctx.db, ctx.token);
      return { ok: true };
    },
  },

  /** The signed-in account. */
  me: {
    auth: 'any',
    async run(ctx) {
      return ctx.actor;
    },
  },
};
