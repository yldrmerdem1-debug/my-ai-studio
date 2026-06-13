'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, LockKeyhole, Mail, Sparkles, UserRound } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { usePersona } from '@/hooks/usePersona';

type AuthMode = 'signin' | 'signup' | 'forgot' | 'updatePassword';

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = usePersona();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResendingConfirmation, setIsResendingConfirmation] = useState(false);
  const [canResendConfirmation, setCanResendConfirmation] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const title =
    mode === 'signup'
      ? 'Create your account'
      : mode === 'forgot'
        ? 'Reset your password'
        : mode === 'updatePassword'
          ? 'Set a new password'
          : 'Welcome back';
  const buttonLabel =
    mode === 'signup'
      ? 'Create account'
      : mode === 'forgot'
        ? 'Send reset link'
        : mode === 'updatePassword'
          ? 'Update password'
          : 'Sign in';
  const switchLabel = mode === 'signin'
    ? 'Need an account? Create one'
    : 'Already have an account? Sign in';
  const isSupabaseConfigured = useMemo(
    () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.toLowerCase();
    const search = window.location.search.toLowerCase();

    // Link bozuk veya süresi geçmiş (Supabase hata parametresi döndürür)
    if (hash.includes('error') || search.includes('error')) {
      const params = new URLSearchParams(
        window.location.hash.replace(/^#/, '') || window.location.search.replace(/^\?/, '')
      );
      const description = params.get('error_description') || params.get('error');
      setMode('signin');
      setErrorMessage(
        description
          ? decodeURIComponent(description.replace(/\+/g, ' '))
          : 'This link is invalid or has expired. Please request a new confirmation email.'
      );
      return;
    }

    if (hash.includes('type=recovery') || search.includes('type=recovery')) {
      setMode('updatePassword');
      setMessage('Enter a new password to finish account recovery.');
      return;
    }

    // E-posta doğrulama başarıyla tamamlandığında dönülen ekran
    if (
      hash.includes('type=signup')
      || search.includes('type=signup')
      || hash.includes('type=email_change')
      || search.includes('type=email_change')
    ) {
      setMode('signin');
      setMessage('Your email is verified. You can sign in now.');
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setMessage('');
    setCanResendConfirmation(false);

    const trimmedEmail = email.trim();
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();
    const trimmedUsername = username.trim();
    if (mode === 'forgot') {
      if (!trimmedEmail) {
        setErrorMessage('Enter your email address to receive a reset link.');
        return;
      }
      setIsSubmitting(true);
      try {
        const supabase = getSupabaseBrowserClient();
        const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: typeof window !== 'undefined'
            ? `${window.location.origin}/login`
            : undefined,
        });
        if (error) throw new Error(error.message);
        setMode('signin');
        setMessage('Password reset email sent. Check your inbox, then set a new password.');
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Could not send reset email.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (mode === 'updatePassword') {
      if (password.length < 6) {
        setErrorMessage('Enter a new password with at least 6 characters.');
        return;
      }
      setIsSubmitting(true);
      try {
        const supabase = getSupabaseBrowserClient();
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw new Error(error.message);
        await supabase.auth.signOut();
        setUser(null);
        setPassword('');
        setMode('signin');
        setMessage('Password updated. Please sign in with your new password.');
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Could not update password.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!trimmedEmail || password.length < 6) {
      setErrorMessage('Enter a valid email and a password with at least 6 characters.');
      return;
    }
    if (mode === 'signup' && (!trimmedFirstName || !trimmedLastName)) {
      setErrorMessage('Enter your first and last name to create an account.');
      return;
    }
    if (mode === 'signup' && !/^[a-zA-Z0-9_]{3,24}$/.test(trimmedUsername)) {
      setErrorMessage('Choose a username with 3-24 letters, numbers, or underscores.');
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const result = mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email: trimmedEmail, password })
        : await supabase.auth.signUp({
            email: trimmedEmail,
            password,
            options: {
              emailRedirectTo: typeof window !== 'undefined'
                ? `${window.location.origin}/login`
                : undefined,
              data: {
                first_name: trimmedFirstName,
                last_name: trimmedLastName,
                full_name: `${trimmedFirstName} ${trimmedLastName}`.trim(),
                username: trimmedUsername,
              },
            },
          });

      if (result.error) {
        throw new Error(result.error.message);
      }

      const authUser = result.data.user;
      if (authUser?.id) {
        const metadata = authUser.user_metadata || {};
        const plan = metadata.plan === 'premium' ? 'premium' : 'free';
        const fallbackName = `${trimmedFirstName} ${trimmedLastName}`.trim() || trimmedEmail.split('@')[0];
        localStorage.setItem('localUserId', authUser.id);
        localStorage.setItem('assetCacheUserId', authUser.id);
        setUser({
          id: authUser.id,
          email: authUser.email || trimmedEmail,
          firstName: metadata.first_name || trimmedFirstName || undefined,
          lastName: metadata.last_name || trimmedLastName || undefined,
          fullName: metadata.full_name || metadata.name || fallbackName,
          username: metadata.username || trimmedUsername || undefined,
          avatarUrl: metadata.avatar_url || metadata.picture || undefined,
          plan,
          isPremium: plan === 'premium',
        });
      }

      if (mode === 'signup') {
        if (result.data.session) {
          await supabase.auth.signOut();
          setUser(null);
        }
        setPassword('');
        setMode('signin');
        setMessage(result.data.session
          ? 'Account created. Please sign in to continue.'
          : 'Account created. Check your email to confirm it, then sign in.'
        );
        return;
      }

      router.push('/my-assets');
      router.refresh();
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Authentication failed.';
      if (/email not confirmed|confirm/i.test(rawMessage)) {
        setCanResendConfirmation(true);
        setErrorMessage('Your email is not confirmed yet. Check your inbox or resend the confirmation email.');
      } else {
        setErrorMessage(rawMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendConfirmation = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage('Enter your email address first.');
      return;
    }
    setIsResendingConfirmation(true);
    setErrorMessage('');
    setMessage('');
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: trimmedEmail,
        options: {
          emailRedirectTo: typeof window !== 'undefined'
            ? `${window.location.origin}/login`
            : undefined,
        },
      });
      if (error) throw new Error(error.message);
      setCanResendConfirmation(false);
      setMessage('Confirmation email sent. Check your inbox, then sign in.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not resend confirmation email.');
    } finally {
      setIsResendingConfirmation(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050505] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(0,217,255,0.18),transparent_34%),radial-gradient(circle_at_82%_70%,rgba(139,92,246,0.20),transparent_38%),linear-gradient(135deg,rgba(255,255,255,0.04),transparent_42%)]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/10 bg-cyan-300/[0.03] blur-3xl" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6 py-12">
        <div className="grid w-full overflow-hidden rounded-[2rem] border border-white/15 bg-white/[0.045] shadow-[0_30px_120px_rgba(0,217,255,0.16)] backdrop-blur-2xl md:grid-cols-[1.05fr_0.95fr]">
          <section className="relative hidden border-r border-white/10 bg-black/35 p-10 md:block">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
            <Link href="/" className="inline-flex items-center gap-2 text-sm text-cyan-300 transition hover:text-cyan-100">
              <ArrowLeft className="h-4 w-4" />
              Back to studio
            </Link>
            <div className="mt-20">
              <div className="mb-5 inline-flex rounded-2xl border border-cyan-400/25 bg-cyan-400/10 p-3 text-cyan-200 shadow-[0_0_35px_rgba(0,217,255,0.18)]">
                <Sparkles className="h-7 w-7" />
              </div>
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">KINETIC AI</p>
              <h1 className="max-w-md text-4xl font-semibold tracking-tight text-white drop-shadow-[0_0_24px_rgba(255,255,255,0.08)]">
                Keep every persona, product ad, and generated asset under your account.
              </h1>
              <p className="mt-5 max-w-md text-sm leading-6 text-gray-400">
                Sign in to sync My Assets with your cloud account. Local development still works, but production storage uses verified Supabase Auth.
              </p>
              <div className="mt-8 flex flex-wrap gap-2">
                {['Cloud assets', 'Persona library', 'Product ads'].map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="relative p-8 sm:p-10">
            <div className="pointer-events-none absolute right-8 top-8 h-24 w-24 rounded-full bg-cyan-300/10 blur-2xl" />
            <div className="md:hidden">
              <Link href="/" className="inline-flex items-center gap-2 text-sm text-cyan-300 transition hover:text-cyan-100">
                <ArrowLeft className="h-4 w-4" />
                Back to studio
              </Link>
            </div>

            <div className="mt-8 md:mt-0">
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">KINETIC AI</p>
              <h2 className="mt-3 text-3xl font-semibold text-white">{title}</h2>
              <p className="mt-2 text-sm text-gray-400">
                {mode === 'signin'
                  ? 'Access your generated videos, images, personas, and ad assets.'
                  : mode === 'signup'
                    ? 'Create an account to keep your generated assets separated and synced.'
                    : mode === 'forgot'
                      ? 'We will send a secure link so you can set a new password.'
                      : 'Choose a new password for your account.'}
              </p>
            </div>

            {!isSupabaseConfigured && (
              <div className="mt-6 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4 text-sm text-yellow-100">
                Supabase Auth is not configured yet. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to enable real login.
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              {mode === 'signup' && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-gray-300">First name</span>
                      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 shadow-inner shadow-white/[0.03] transition focus-within:border-cyan-400/70 focus-within:bg-black/65">
                        <UserRound className="h-5 w-5 text-gray-500" />
                        <input
                          type="text"
                          value={firstName}
                          onChange={(event) => setFirstName(event.target.value)}
                          placeholder="First name"
                          className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
                          autoComplete="given-name"
                        />
                      </div>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-gray-300">Last name</span>
                      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 shadow-inner shadow-white/[0.03] transition focus-within:border-cyan-400/70 focus-within:bg-black/65">
                        <UserRound className="h-5 w-5 text-gray-500" />
                        <input
                          type="text"
                          value={lastName}
                          onChange={(event) => setLastName(event.target.value)}
                          placeholder="Last name"
                          className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
                          autoComplete="family-name"
                        />
                      </div>
                    </label>
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-gray-300">Username</span>
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 shadow-inner shadow-white/[0.03] transition focus-within:border-cyan-400/70 focus-within:bg-black/65">
                      <UserRound className="h-5 w-5 text-gray-500" />
                      <input
                        type="text"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder="kinetic_creator"
                        className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
                        autoComplete="username"
                      />
                    </div>
                    <p className="mt-2 text-xs text-gray-600">3-24 characters, letters, numbers, or underscores.</p>
                  </label>
                </>
              )}

              {mode !== 'updatePassword' && (
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-300">Email</span>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 shadow-inner shadow-white/[0.03] transition focus-within:border-cyan-400/70 focus-within:bg-black/65">
                    <Mail className="h-5 w-5 text-gray-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@company.com"
                      className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
                      autoComplete="email"
                    />
                  </div>
                </label>
              )}

              {mode !== 'forgot' && (
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-300">
                    {mode === 'updatePassword' ? 'New password' : 'Password'}
                  </span>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 shadow-inner shadow-white/[0.03] transition focus-within:border-cyan-400/70 focus-within:bg-black/65">
                    <LockKeyhole className="h-5 w-5 text-gray-500" />
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Minimum 6 characters"
                      className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
                      autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    />
                  </div>
                </label>
              )}

              {errorMessage && (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                  <p>{errorMessage}</p>
                  {canResendConfirmation && (
                    <button
                      type="button"
                      onClick={handleResendConfirmation}
                      disabled={isResendingConfirmation}
                      className="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-200/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isResendingConfirmation && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Resend confirmation email
                    </button>
                  )}
                </div>
              )}
              {message && (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || !isSupabaseConfigured}
                className="interactive-element flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-300 via-sky-300 to-violet-300 px-5 py-3 text-sm font-semibold text-black shadow-[0_14px_45px_rgba(0,217,255,0.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {buttonLabel}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                setMode((current) => (current === 'signin' ? 'signup' : 'signin'));
                setErrorMessage('');
                setMessage('');
                setCanResendConfirmation(false);
              }}
              className="mt-6 text-sm text-cyan-300 transition hover:text-cyan-100"
            >
              {switchLabel}
            </button>
            {mode === 'signin' && (
              <button
                type="button"
                onClick={() => {
                  setMode('forgot');
                  setErrorMessage('');
                  setMessage('');
                  setPassword('');
                }}
                className="ml-4 mt-6 text-sm text-gray-400 transition hover:text-cyan-100"
              >
                Forgot password?
              </button>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
