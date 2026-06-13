'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, Folder, ShieldCheck, Sparkles, Users, Video } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import AuroraBackground from '@/components/AuroraBackground';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type AdminOverview = {
  totals: {
    users: number;
    assets: number;
    personas: number;
    videos: number;
    images: number;
  };
  breakdown: {
    assetsByType: Record<string, number>;
    personasByStatus: Record<string, number>;
    personasBySubject: Record<string, number>;
  };
  recentAssets: Array<{
    id: string;
    name: string;
    type: string;
    userId: string;
    createdAt?: string;
    model?: string;
  }>;
  recentPersonas: Array<{
    id: string;
    name: string;
    subjectType: string;
    status: string;
    userId: string;
    createdAt?: string;
  }>;
};

const StatCard = ({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: number;
}) => (
  <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-[0_18px_70px_rgba(0,0,0,0.22)]">
    <div className="mb-4 inline-flex rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-cyan-200">
      <Icon className="h-5 w-5" />
    </div>
    <p className="text-3xl font-semibold text-white">{value}</p>
    <p className="mt-1 text-sm text-gray-400">{label}</p>
  </div>
);

export default function AdminPage() {
  const router = useRouter();
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setErrorMessage('');
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const headers: Record<string, string> = {};
        const token = data.session?.access_token;
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        } else {
          const localUserId = localStorage.getItem('localUserId');
          if (localUserId) headers['X-Local-User-Id'] = localUserId;
        }

        // Hard gate: only verified admins may even see this screen.
        const meResponse = await fetch('/api/admin/me', { cache: 'no-store', headers });
        const mePayload = await meResponse.json().catch(() => ({}));
        if (!meResponse.ok || !mePayload.isAdmin) {
          router.replace('/');
          return;
        }
        setIsAuthorized(true);

        const response = await fetch('/api/admin/overview', {
          cache: 'no-store',
          headers,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Admin overview could not be loaded.');
        }
        setOverview(payload);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Admin overview could not be loaded.');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [router]);

  if (!isAuthorized && isLoading) {
    return (
      <div className="relative min-h-screen bg-black text-white">
        <AuroraBackground />
        <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
        <main className="relative z-10 ml-64 px-8 py-10">
          <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-white/[0.04] p-10 text-gray-300 backdrop-blur-xl">
            Verifying admin access...
          </div>
        </main>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="relative min-h-screen bg-black text-white">
        <AuroraBackground />
        <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
        <main className="relative z-10 ml-64 px-8 py-10">
          <div className="mx-auto max-w-7xl rounded-3xl border border-red-500/20 bg-red-500/10 p-10 text-red-100 backdrop-blur-xl">
            <h2 className="text-xl font-semibold">Admin access required</h2>
            <p className="mt-2 text-sm text-red-100/80">This area is restricted to the platform owner.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-black text-white">
      <AuroraBackground />
      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      <PricingModal isOpen={isPricingModalOpen} onClose={() => setIsPricingModalOpen(false)} />

      <main className="relative z-10 ml-64 px-8 py-10">
        <div className="relative mx-auto max-w-7xl">
          <div className="mb-8 flex flex-col justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-[0_20px_90px_rgba(0,217,255,0.08)] md:flex-row md:items-center">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
                <ShieldCheck className="h-4 w-4" />
                Admin Control
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-white">KINETIC AI Admin</h1>
              <p className="mt-2 max-w-2xl text-sm text-gray-400">
                Manage platform health, account-separated assets, personas, and recent generation activity.
              </p>
            </div>
            <Link
              href="/"
              className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-gray-200 transition hover:bg-white/10"
            >
              Back to studio
            </Link>
          </div>

          {isLoading ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-10 text-gray-300">
              Loading admin overview...
            </div>
          ) : errorMessage ? (
            <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-8 text-red-100">
              <h2 className="text-xl font-semibold">Admin access is not active</h2>
              <p className="mt-2 text-sm text-red-100/80">{errorMessage}</p>
              <p className="mt-4 text-sm text-red-100/70">
                Add your account email to `ADMIN_EMAILS` or set your Supabase user role to `admin`.
              </p>
            </div>
          ) : overview ? (
            <>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-5">
                <StatCard icon={Users} label="Users" value={overview.totals.users} />
                <StatCard icon={Folder} label="Assets" value={overview.totals.assets} />
                <StatCard icon={Sparkles} label="Personas" value={overview.totals.personas} />
                <StatCard icon={Video} label="Videos" value={overview.totals.videos} />
                <StatCard icon={BarChart3} label="Images" value={overview.totals.images} />
              </div>

              <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
                <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-6">
                  <h2 className="mb-4 text-xl font-semibold">Recent Assets</h2>
                  <div className="space-y-3">
                    {overview.recentAssets.length === 0 ? (
                      <p className="text-sm text-gray-500">No assets yet.</p>
                    ) : overview.recentAssets.map((asset) => (
                      <div key={asset.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-medium text-white">{asset.name}</p>
                          <span className="rounded-full bg-cyan-300/10 px-2 py-1 text-xs text-cyan-200">{asset.type}</span>
                        </div>
                        <p className="mt-1 truncate text-xs text-gray-500">User: {asset.userId}</p>
                        {asset.model && <p className="mt-1 text-xs text-gray-500">Model: {asset.model}</p>}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-6">
                  <h2 className="mb-4 text-xl font-semibold">Recent Personas</h2>
                  <div className="space-y-3">
                    {overview.recentPersonas.length === 0 ? (
                      <p className="text-sm text-gray-500">No personas yet.</p>
                    ) : overview.recentPersonas.map((persona) => (
                      <div key={persona.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-medium text-white">{persona.name}</p>
                          <span className="rounded-full bg-violet-300/10 px-2 py-1 text-xs text-violet-200">{persona.status}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">Subject: {persona.subjectType}</p>
                        <p className="mt-1 truncate text-xs text-gray-500">User: {persona.userId}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
