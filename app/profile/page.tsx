'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Folder, Image as ImageIcon, Mail, ShieldCheck, Sparkles, UserRound, Video } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import AuroraBackground from '@/components/AuroraBackground';
import { usePersona } from '@/hooks/usePersona';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { buildAvatarBackground, getAvatarGradient, getAvatarInitials } from '@/lib/avatar';

const clean = (value: unknown) => String(value || '').trim();

export default function ProfilePage() {
  const { user, setUser } = usePersona();
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [stats, setStats] = useState({ assets: 0, images: 0, videos: 0, personas: 0 });
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  useEffect(() => {
    setFirstName(user?.firstName || '');
    setLastName(user?.lastName || '');
    setUsername(user?.username || '');
  }, [user?.firstName, user?.lastName, user?.username]);

  // Load this user's own library counts (account-separated, same data the assets page uses).
  useEffect(() => {
    let cancelled = false;
    const loadStats = async () => {
      if (!user?.id) return;
      setIsLoadingStats(true);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const headers: Record<string, string> = {};
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        } else {
          headers['X-Local-User-Id'] = user.id;
        }

        const [assetsResponse, personasResponse] = await Promise.all([
          fetch('/api/assets', { cache: 'no-store', headers }),
          fetch('/api/personas', { cache: 'no-store', headers }),
        ]);
        const assetsPayload = await assetsResponse.json().catch(() => ({}));
        const personasPayload = await personasResponse.json().catch(() => ({}));
        if (cancelled) return;

        const assets: Array<{ type?: string }> = Array.isArray(assetsPayload.assets) ? assetsPayload.assets : [];
        const personaRows: Array<Record<string, unknown>> = Array.isArray(personasPayload.personas)
          ? personasPayload.personas
          : Array.isArray(personasPayload.models)
            ? personasPayload.models
            : Array.isArray(personasPayload)
              ? personasPayload
              : [];

        // model_trainings can hold several rows per persona (e.g. training + failed),
        // so collapse to unique personas by name/trigger to avoid inflating the count.
        const personaKeys = new Set(
          personaRows.map((row) =>
            clean(row.name || row.persona_name || row.trigger_word || row.triggerWord || row.id).toLowerCase()
          )
        );
        personaKeys.delete('');

        setStats({
          assets: assets.length,
          images: assets.filter((asset) => asset.type === 'image').length,
          videos: assets.filter((asset) => asset.type === 'video').length,
          personas: personaKeys.size || personaRows.length,
        });
      } catch {
        if (!cancelled) setStats({ assets: 0, images: 0, videos: 0, personas: 0 });
      } finally {
        if (!cancelled) setIsLoadingStats(false);
      }
    };
    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const displayName = useMemo(() => {
    return user?.fullName || user?.username || user?.email?.split('@')?.[0] || 'KINETIC AI user';
  }, [user?.email, user?.fullName, user?.username]);

  const avatarInitials = useMemo(
    () => getAvatarInitials(user?.fullName, user?.username, user?.email),
    [user?.email, user?.fullName, user?.username]
  );

  const avatarSeed = user?.username || user?.email || user?.id || 'kinetic';
  const avatarGradient = useMemo(() => getAvatarGradient(avatarSeed), [avatarSeed]);

  const handleSave = async () => {
    setMessage('');
    setErrorMessage('');
    const safeFirstName = clean(firstName);
    const safeLastName = clean(lastName);
    const safeUsername = clean(username);
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(safeUsername)) {
      setErrorMessage('Username must be 3-24 characters and can use letters, numbers, or underscores.');
      return;
    }

    setIsSaving(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const fullName = `${safeFirstName} ${safeLastName}`.trim() || safeUsername;
      const { data, error } = await supabase.auth.updateUser({
        data: {
          first_name: safeFirstName,
          last_name: safeLastName,
          full_name: fullName,
          username: safeUsername,
        },
      });
      if (error) throw new Error(error.message);
      const authUser = data.user;
      setUser({
        ...(user || {}),
        id: authUser?.id || user?.id,
        email: authUser?.email || user?.email,
        firstName: safeFirstName,
        lastName: safeLastName,
        fullName,
        username: safeUsername,
        avatarUrl: clean(authUser?.user_metadata?.avatar_url || authUser?.user_metadata?.picture || user?.avatarUrl) || undefined,
      });
      setMessage('Profile updated.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Profile could not be updated.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-black text-white">
      <AuroraBackground />
      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      <PricingModal isOpen={isPricingModalOpen} onClose={() => setIsPricingModalOpen(false)} />

      <main className="relative z-10 ml-64 px-8 py-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200/70">Account</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">Profile</h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-400">
              Manage how your KINETIC AI workspace identifies you across assets, personas, and account activity.
            </p>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              { icon: Folder, label: 'Total assets', value: stats.assets, tint: 'cyan' },
              { icon: ImageIcon, label: 'Images', value: stats.images, tint: 'sky' },
              { icon: Video, label: 'Videos', value: stats.videos, tint: 'violet' },
              { icon: Sparkles, label: 'Personas', value: stats.personas, tint: 'amber' },
            ].map(({ icon: Icon, label, value, tint }) => (
              <div
                key={label}
                className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl transition hover:border-white/20"
              >
                <div
                  className={`mb-3 inline-flex rounded-2xl border p-2.5 ${
                    tint === 'cyan'
                      ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-200'
                      : tint === 'sky'
                        ? 'border-sky-300/20 bg-sky-300/10 text-sky-200'
                        : tint === 'violet'
                          ? 'border-violet-300/20 bg-violet-300/10 text-violet-200'
                          : 'border-amber-300/20 bg-amber-300/10 text-amber-200'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <p className="text-3xl font-semibold text-white">{isLoadingStats ? '—' : value}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">{label}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-[0_18px_80px_rgba(0,217,255,0.08)] backdrop-blur-xl">
              <div className="flex flex-col items-center text-center">
                <div
                className="flex h-28 w-28 items-center justify-center rounded-[2rem] text-4xl font-black text-white"
                style={{
                  background: user?.avatarUrl ? undefined : buildAvatarBackground(avatarSeed),
                  boxShadow: `0 0 0 1px rgba(255,255,255,0.12), 0 18px 50px -12px ${avatarGradient.glow}`,
                }}
              >
                {user?.avatarUrl ? (
                  <span
                    aria-hidden="true"
                    className="h-full w-full rounded-[2rem] bg-cover bg-center"
                    style={{ backgroundImage: `url(${user.avatarUrl})` }}
                  />
                ) : (
                  <span style={{ textShadow: '0 2px 12px rgba(0,0,0,0.35)' }}>{avatarInitials}</span>
                )}
              </div>
                <h2 className="mt-5 text-2xl font-semibold">{displayName}</h2>
                {user?.username && <p className="mt-1 text-sm text-cyan-200">@{user.username}</p>}
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Active
                  </span>
                  {user?.isAdmin && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Admin
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-6 space-y-3 rounded-2xl border border-white/10 bg-black/25 p-4">
                <div className="flex items-center gap-3 text-sm text-gray-300">
                  <Mail className="h-4 w-4 text-cyan-300" />
                  <span className="truncate">{user?.email || 'No email attached'}</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-300">
                  <UserRound className="h-4 w-4 text-violet-300" />
                  <span className="truncate">
                    {user?.isPremium ? 'Premium membership' : 'Free plan'}
                  </span>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
              <h2 className="text-xl font-semibold">Profile Details</h2>
              <p className="mt-1 text-sm text-gray-400">These details are saved to your Supabase account metadata.</p>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">First name</span>
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/40"
                    placeholder="Erdem"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Last name</span>
                  <input
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/40"
                    placeholder="Yildirim"
                  />
                </label>
              </div>

              <label className="mt-4 block">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Username</span>
                <div className="mt-2 flex items-center rounded-2xl border border-white/10 bg-black/30 px-4 py-3 transition focus-within:border-cyan-300/40">
                  <span className="text-sm text-gray-500">@</span>
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="ml-1 w-full bg-transparent text-sm text-white outline-none"
                    placeholder="kinetic_creator"
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">3-24 characters. Letters, numbers, and underscores only.</p>
              </label>

              {message && <p className="mt-5 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">{message}</p>}
              {errorMessage && <p className="mt-5 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">{errorMessage}</p>}

              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="mt-6 rounded-2xl bg-gradient-to-r from-cyan-300 to-blue-400 px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? 'Saving...' : 'Save profile'}
              </button>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
