'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../components/AuthContext';

type AuthView = 'login' | 'register' | 'forgot-password' | 'reset-password' | 'verify-sent';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidReturnTo(path: string | null): path is string {
  return !!path && path.startsWith('/') && !path.startsWith('//');
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthPageContent />
    </Suspense>
  );
}

function AuthPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser } = useAuth();

  const [view, setView] = useState<AuthView>(() => {
    if (searchParams.get('reset_token')) return 'reset-password';
    if (searchParams.get('mode') === 'register') return 'register';
    return 'login';
  });
  const [banner, setBanner] = useState<string | null>(() =>
    searchParams.get('verified') === '1' ? 'Your email has been verified. You can now log in.' : null
  );
  const resetToken = searchParams.get('reset_token');
  const [registeredEmail, setRegisteredEmail] = useState('');

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        {banner && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
            {banner}
          </div>
        )}

        {view === 'login' && (
          <LoginForm
            onSwitchToRegister={() => { setBanner(null); setView('register'); }}
            onSwitchToForgot={() => { setBanner(null); setView('forgot-password'); }}
            onSuccess={(user) => {
              setUser(user);
              const returnTo = searchParams.get('returnTo');
              router.push(isValidReturnTo(returnTo) ? returnTo : '/');
            }}
          />
        )}

        {view === 'register' && (
          <RegisterForm
            onSwitchToLogin={() => { setBanner(null); setView('login'); }}
            onSuccess={(email) => {
              setRegisteredEmail(email);
              setView('verify-sent');
            }}
          />
        )}

        {view === 'forgot-password' && (
          <ForgotPasswordForm
            onBack={() => setView('login')}
          />
        )}

        {view === 'reset-password' && (
          <ResetPasswordForm
            token={resetToken ?? ''}
            onSuccess={() => {
              setBanner('Password updated. You can now log in.');
              setView('login');
            }}
          />
        )}

        {view === 'verify-sent' && (
          <VerifySentView
            email={registeredEmail}
            onBack={() => setView('login')}
          />
        )}
      </div>
    </div>
  );
}

// ─── Login Form ───────────────────────────────────────────────────────────────

function LoginForm({
  onSwitchToRegister,
  onSwitchToForgot,
  onSuccess,
}: {
  onSwitchToRegister: () => void;
  onSwitchToForgot: () => void;
  onSuccess: (user: { userId: string; email: string }) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as Record<string, string>;
      if (res.ok) {
        onSuccess({ userId: data.userId, email: data.email });
      } else {
        setError(data.error ?? 'Login failed.');
      }
    } catch {
      setError('Could not connect. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1 className="text-lg font-bold text-gray-900 mb-6">Sign in</h1>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      <div className="space-y-4">
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="mt-6 w-full min-h-[44px] bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
      <div className="mt-4 space-y-2 text-center">
        <button
          type="button"
          onClick={onSwitchToForgot}
          className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          Forgot password?
        </button>
        <p className="text-sm text-gray-500">
          No account?{' '}
          <button
            type="button"
            onClick={onSwitchToRegister}
            className="text-gray-900 font-medium hover:underline"
          >
            Register
          </button>
        </p>
      </div>
    </form>
  );
}

// ─── Register Form ────────────────────────────────────────────────────────────

function RegisterForm({
  onSwitchToLogin,
  onSuccess,
}: {
  onSwitchToLogin: () => void;
  onSuccess: (email: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!EMAIL_REGEX.test(email)) e.email = 'Please enter a valid email address.';
    if (password.length < 8) e.password = 'Password must be at least 8 characters.';
    if (confirm !== password) e.confirm = 'Passwords do not match.';
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.status === 201) {
        onSuccess(email);
      } else {
        const data = await res.json() as Record<string, string>;
        setFormError(data.error ?? 'Registration failed.');
      }
    } catch {
      setFormError('Could not connect. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1 className="text-lg font-bold text-gray-900 mb-6">Create account</h1>
      {formError && <p className="mb-4 text-sm text-red-600">{formError}</p>}
      <div className="space-y-4">
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          error={errors.email}
          onBlur={() => {
            if (email && !EMAIL_REGEX.test(email))
              setErrors((e) => ({ ...e, email: 'Please enter a valid email address.' }));
            else setErrors((e) => { const n = { ...e }; delete n.email; return n; });
          }}
          autoComplete="email"
          required
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          error={errors.password}
          onBlur={() => {
            if (password && password.length < 8)
              setErrors((e) => ({ ...e, password: 'Password must be at least 8 characters.' }));
            else setErrors((e) => { const n = { ...e }; delete n.password; return n; });
          }}
          autoComplete="new-password"
          required
        />
        <Field
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          error={errors.confirm}
          onBlur={() => {
            if (confirm && confirm !== password)
              setErrors((e) => ({ ...e, confirm: 'Passwords do not match.' }));
            else setErrors((e) => { const n = { ...e }; delete n.confirm; return n; });
          }}
          autoComplete="new-password"
          required
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="mt-6 w-full min-h-[44px] bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Creating account…' : 'Create account'}
      </button>
      <p className="mt-4 text-center text-sm text-gray-500">
        Already have an account?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-gray-900 font-medium hover:underline"
        >
          Sign in
        </button>
      </p>
    </form>
  );
}

// ─── Forgot Password Form ─────────────────────────────────────────────────────

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      // show message regardless
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1 className="text-lg font-bold text-gray-900 mb-2">Reset password</h1>
      {submitted ? (
        <p className="text-sm text-gray-600 mt-4">
          If that email is registered, a reset link has been sent. Check your inbox.
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-6">
            Enter your email address and we&apos;ll send you a reset link.
          </p>
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
          <button
            type="submit"
            disabled={submitting}
            className="mt-6 w-full min-h-[44px] bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
        </>
      )}
      <button
        type="button"
        onClick={onBack}
        className="mt-4 w-full text-sm text-gray-500 hover:text-gray-900 transition-colors min-h-[44px]"
      >
        Back to sign in
      </button>
    </form>
  );
}

// ─── Reset Password Form ──────────────────────────────────────────────────────

function ResetPasswordForm({
  token,
  onSuccess,
}: {
  token: string;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });
      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json() as Record<string, string>;
        setError(data.error ?? 'Reset failed.');
      }
    } catch {
      setError('Could not connect. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1 className="text-lg font-bold text-gray-900 mb-6">Set new password</h1>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      <div className="space-y-4">
        <Field
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          required
        />
        <Field
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          required
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="mt-6 w-full min-h-[44px] bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}

// ─── Verify Sent View ─────────────────────────────────────────────────────────

function VerifySentView({ email, onBack }: { email: string; onBack: () => void }) {
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleResend() {
    setResending(true);
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      // ignore
    } finally {
      setResending(false);
      setResent(true);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-bold text-gray-900 mb-4">Check your email</h1>
      <p className="text-sm text-gray-600 mb-6">
        We sent a verification link to <strong>{email}</strong>. The link expires in 24 hours.
      </p>
      {resent ? (
        <p className="text-sm text-green-700 mb-4">A new link has been sent.</p>
      ) : (
        <button
          onClick={handleResend}
          disabled={resending}
          className="w-full min-h-[44px] border border-gray-300 text-sm text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {resending ? 'Sending…' : 'Resend email'}
        </button>
      )}
      <button
        onClick={onBack}
        className="mt-3 w-full min-h-[44px] text-sm text-gray-500 hover:text-gray-900 transition-colors"
      >
        Back to sign in
      </button>
    </div>
  );
}

// ─── Field helper ─────────────────────────────────────────────────────────────

function Field({
  label,
  type,
  value,
  onChange,
  error,
  onBlur,
  autoComplete,
  required,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  onBlur?: () => void;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        autoComplete={autoComplete}
        required={required}
        className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 min-h-[44px] ${
          error ? 'border-red-400' : 'border-gray-300'
        }`}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
