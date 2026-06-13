'use client';

import { useCallback, useMemo, useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Film, Sparkles, Video, FileText, Folder, Gem, Image as ImageIcon, Volume2, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { usePersona } from '@/hooks/usePersona';
import { buildAvatarBackground, getAvatarGradient, getAvatarInitials } from '@/lib/avatar';

const navItems = [
  { name: 'Studio', href: '/', icon: Film },
  { name: 'AI Persona Lab', href: '/persona', icon: Sparkles, isPremium: true, emphasis: 'primary' },
  { name: 'Image Studio', href: '/background-change', icon: ImageIcon, emphasis: 'secondary' },
  { name: 'AI Video Factory', href: '/video', icon: Video, emphasis: 'secondary' },
  { name: 'AI Director', href: '/ad-script', icon: Volume2, emphasis: 'secondary' },
  { name: 'Auto-Editor', href: '/ad-creation', icon: FileText, emphasis: 'utility' },
  { name: 'My Assets', href: '/my-assets', icon: Folder, emphasis: 'utility' },
  { name: 'Subscription', href: '#', icon: Gem, isModal: true, emphasis: 'utility' },
];

interface SidebarProps {
  onSubscriptionClick?: () => void;
}

export default function Sidebar({ onSubscriptionClick }: SidebarProps) {
  const pathname = usePathname();
  const { user, setUser } = usePersona();
  const [activeIndicatorStyle, setActiveIndicatorStyle] = useState({ top: 0, height: 0 });
  const [hasAuthSession, setHasAuthSession] = useState(false);
  const [hasAdminAccess, setHasAdminAccess] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  const displayName = user?.fullName || user?.username || user?.email?.split('@')[0] || 'Guest workspace';
  const displayHandle = user?.username ? `@${user.username}` : user?.email || (hasAuthSession ? 'Signed in' : 'Guest');
  const avatarSeed = user?.username || user?.email || user?.id || 'kinetic';
  const avatarInitial = getAvatarInitials(user?.fullName, user?.username, user?.email);
  const avatarGradient = getAvatarGradient(avatarSeed);
  const visibleNavItems = useMemo(() => [
    ...navItems,
    ...(hasMounted && hasAdminAccess ? [{ name: 'Admin', href: '/admin', icon: ShieldCheck, emphasis: 'utility' }] : []),
  ], [hasAdminAccess, hasMounted]);

  const handleSignOut = async () => {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    localStorage.removeItem('assetCacheUserId');
    setHasAuthSession(false);
    setHasAdminAccess(false);
    setUser(null);
  };

  const refreshAdminAccess = useCallback(async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      } else {
        const localUserId = localStorage.getItem('localUserId');
        if (localUserId) headers['X-Local-User-Id'] = localUserId;
      }
      const response = await fetch('/api/admin/me', { cache: 'no-store', headers });
      const payload = await response.json().catch(() => ({}));
      setHasAdminAccess(Boolean(response.ok && payload.isAdmin));
    } catch {
      setHasAdminAccess(false);
    }
  }, []);

  useEffect(() => {
    setHasMounted(true);
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      setHasAuthSession(Boolean(data.session?.user?.id));
      void refreshAdminAccess();
    }).catch(() => setHasAuthSession(false));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasAuthSession(Boolean(session?.user?.id));
      if (session?.user?.id) {
        void refreshAdminAccess();
      } else {
        setHasAdminAccess(false);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [refreshAdminAccess]);

  // Find active item and calculate indicator position
  useEffect(() => {
    const activeIndex = visibleNavItems.findIndex(item => {
      if (item.isModal) return false;
      if (item.href === '/') return pathname === '/';
      return pathname?.startsWith(item.href);
    });

    if (activeIndex !== -1 && !visibleNavItems[activeIndex].isModal) {
      // Item box ≈ 44px (py-3 + text-sm line) + 8px space-y-2 gap between items.
      const itemStep = 52;
      const itemHeight = 44;
      const topPosition = activeIndex * itemStep;
      setActiveIndicatorStyle({ top: topPosition, height: itemHeight });
    }
  }, [pathname, visibleNavItems]);

  return (
    <aside className="glass-strong fixed left-0 top-0 z-20 flex h-screen w-64 flex-col border-r border-white/10 p-6 shadow-2xl shadow-cyan-500/5">
      <div className="relative mb-6 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full bg-[#00d9ff]/20 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent"
        />
        <h1 className="text-xl font-black tracking-[0.18em] text-white">
          <span className="text-[#00d9ff] [text-shadow:0_0_18px_rgba(0,217,255,0.45)]">KINETIC</span> AI
        </h1>
        <p className="mt-1 text-xs text-gray-500">Product Ad Studio</p>
      </div>

      {/* Scrollable nav: never collides with the footer card, even on short viewports. */}
      <nav className="relative min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.18)_transparent]">
        {/* Animated Active Indicator */}
        <div
          className="absolute left-0 w-1 bg-gradient-to-b from-[#00d9ff] to-[#0099ff] rounded-r-full transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{
            top: `${activeIndicatorStyle.top}px`,
            height: `${activeIndicatorStyle.height}px`,
          }}
        />

        {visibleNavItems.map((item) => {
          const IconComponent = item.icon;
          const isActive = item.isModal 
            ? false 
            : (item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href));

          const baseClassName = `interactive-element flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition-all relative ${
            isActive
              ? 'bg-[#00d9ff]/20 text-[#00d9ff] border border-[#00d9ff]/30'
              : 'text-gray-300 hover:bg-white/5 hover:text-white'
          }`;

          const emphasisClassName =
            item.emphasis === 'primary'
              ? 'border border-[#fbbf24]/30 shadow-[0_0_20px_rgba(251,191,36,0.2)] animate-pulse'
              : item.emphasis === 'secondary'
                ? 'hover:shadow-[0_10px_35px_rgba(0,217,255,0.25)] hover:-translate-y-0.5'
                : '';

          if (item.isModal) {
            return (
              <button
                key={item.name}
                onClick={() => onSubscriptionClick?.()}
                className={`${baseClassName} ${emphasisClassName}`}
              >
                <div className="flex items-center justify-center" style={{ color: 'inherit' }}>
                  <IconComponent className="w-5 h-5" />
                </div>
                <span>{item.name}</span>
                {item.isPremium && (
                  <span className="ml-auto px-2 py-0.5 text-xs font-semibold bg-gradient-to-r from-yellow-500 to-orange-500 text-black rounded">
                    PREMIUM
                  </span>
                )}
              </button>
            );
          }

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`${baseClassName} ${emphasisClassName}`}
            >
              <div className="flex items-center justify-center" style={{ color: 'inherit' }}>
                <IconComponent className="w-5 h-5" />
              </div>
              <span>{item.name}</span>
              {item.isPremium && (
                <span className="ml-auto px-2 py-0.5 text-xs font-semibold bg-gradient-to-r from-yellow-500 to-orange-500 text-black rounded">
                  PREMIUM
                </span>
              )}
            </Link>
          );
        })}

      </nav>

      <div className="mt-4 shrink-0 border-t border-white/10 pt-4">
        <Link
          href={hasAuthSession ? '/profile' : '/login'}
          className="group mb-3 block overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-[1px] transition hover:border-cyan-300/30"
          style={{
            boxShadow: hasAuthSession ? `0 0 24px -10px ${avatarGradient.glow}` : undefined,
          }}
        >
          <div className="rounded-[15px] bg-black/40 px-3 py-3 transition group-hover:bg-black/20">
            <div className="flex items-center gap-3">
              <span className="relative shrink-0">
                {user?.avatarUrl ? (
                  <span
                    aria-hidden="true"
                    className="block h-11 w-11 rounded-2xl bg-cover bg-center"
                    style={{
                      backgroundImage: `url(${user.avatarUrl})`,
                      boxShadow: `0 0 0 2px rgba(0,0,0,0.4), 0 0 18px -4px ${avatarGradient.glow}`,
                    }}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-bold text-white"
                    style={{
                      background: buildAvatarBackground(avatarSeed),
                      boxShadow: `0 0 0 1px rgba(255,255,255,0.12), 0 0 18px -4px ${avatarGradient.glow}`,
                    }}
                  >
                    {hasMounted ? avatarInitial : 'K'}
                  </span>
                )}
                {hasMounted && hasAuthSession && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-black bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-white">{hasMounted ? displayName : 'Loading...'}</span>
                  {hasAdminAccess && (
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-amber-300" style={{ filter: 'drop-shadow(0 0 4px rgba(251,191,36,0.6))' }} />
                  )}
                </div>
                <p className="truncate text-xs text-gray-400">{displayHandle}</p>
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5 pl-[56px]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${hasAuthSession ? 'bg-emerald-400' : 'bg-gray-500'}`}
              />
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-500">
                {hasAuthSession ? 'Online' : 'Offline'}
              </p>
            </div>
          </div>
        </Link>
        {hasAuthSession ? (
          <button
            type="button"
            onClick={handleSignOut}
            className="interactive-element flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-gray-300 transition-all hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-5 w-5" />
            <span>Sign out</span>
          </button>
        ) : (
          <Link
            href="/login"
            className="interactive-element flex w-full items-center gap-3 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-left text-sm font-semibold text-cyan-100 transition-all hover:border-cyan-300/40 hover:bg-cyan-300/15"
          >
            <LogIn className="h-5 w-5" />
            <span>Sign in</span>
          </Link>
        )}
      </div>
    </aside>
  );
}
