'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import { Folder, Image as ImageIcon, Video, FileText, Download, Trash2, Volume2 } from 'lucide-react';

interface Asset {
  id: string;
  type: 'image' | 'video' | 'script' | 'audio';
  url: string;
  name: string;
  createdAt: string;
  metadata?: {
    model?: string;
    prompt?: string;
    scriptText?: string;
    [key: string]: any;
  };
}

export default function MyAssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);

  useEffect(() => {
    // Load assets from localStorage using the storage utility
    if (typeof window !== 'undefined') {
      import('@/lib/assets-storage').then(({ getAssets }) => {
        setAssets(getAssets());
      });
    }
    
    // Listen for storage updates from other tabs
    const handleStorageChange = () => {
      if (typeof window !== 'undefined') {
        import('@/lib/assets-storage').then(({ getAssets }) => {
          setAssets(getAssets());
        });
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    // Also check for local updates (same tab)
    const interval = setInterval(() => {
      if (typeof window !== 'undefined') {
        import('@/lib/assets-storage').then(({ getAssets }) => {
          const currentAssets = getAssets();
          if (currentAssets.length !== assets.length) {
            setAssets(currentAssets);
          }
        });
      }
    }, 1000);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [assets.length]);

  const handleDelete = async (id: string) => {
    if (typeof window !== 'undefined') {
      const { deleteAsset, getAssets } = await import('@/lib/assets-storage');
      deleteAsset(id);
      setAssets(getAssets());
    }
  };

  const handleDownload = (asset: Asset) => {
    if (asset.type === 'script' && asset.metadata?.scriptText) {
      // For scripts, download as text file
      const blob = new Blob([asset.metadata.scriptText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${asset.name}.txt`;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      const link = document.createElement('a');
      link.href = asset.url;
      link.download = asset.name;
      link.click();
    }
  };

  return (
    <div className="relative min-h-screen bg-black">
      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      <PricingModal isOpen={isPricingModalOpen} onClose={() => setIsPricingModalOpen(false)} />

      <main className="relative z-10 ml-64">
        <div className="container mx-auto px-8 py-12">
          {/* Header */}
          <div className="mb-8">
            <Link href="/" className="text-[#00d9ff] hover:text-[#0099ff] mb-4 inline-block transition-colors">
              ← Back to Studio
            </Link>
            <div className="flex items-center gap-3 mb-2">
              <Folder className="w-8 h-8 text-[#6366f1]" style={{ filter: 'drop-shadow(0 0 8px #6366f1)' }} />
              <h1 className="text-4xl font-bold text-white">
                <span className="bg-gradient-to-r from-[#6366f1] via-[#8b5cf6] to-[#6366f1] bg-clip-text text-transparent">
                  My Assets
                </span>
              </h1>
            </div>
            <p className="text-gray-400 text-lg">
              Access all your created content in one place.
            </p>
          </div>

          {/* Assets Grid */}
          {assets.length === 0 ? (
            <div className="glass rounded-2xl p-16 text-center">
              <Folder className="w-24 h-24 text-gray-600 mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-white mb-2">No assets yet</h2>
              <p className="text-gray-400">Generated content will appear here</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="glass rounded-2xl p-6 border border-white/10 hover:border-[#6366f1]/50 transition-all interactive-element"
                >
                  <div className="relative aspect-video mb-4 rounded-lg overflow-hidden bg-black/30">
                    {asset.type === 'image' ? (
                      <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
                    ) : asset.type === 'video' ? (
                      <video src={asset.url} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <FileText className="w-16 h-16 text-gray-400" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-white font-medium truncate flex-1">{asset.name}</h3>
                    <div className="flex items-center gap-2 ml-2">
                      {asset.type === 'image' && <ImageIcon className="w-4 h-4 text-gray-400" />}
                      {asset.type === 'video' && <Video className="w-4 h-4 text-gray-400" />}
                      {asset.type === 'script' && <FileText className="w-4 h-4 text-gray-400" />}
                    </div>
                  </div>
                  <p className="text-sm text-gray-500 mb-4">
                    {new Date(asset.createdAt).toLocaleDateString()}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDownload(asset)}
                      className="interactive-element flex-1 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </button>
                    <button
                      onClick={() => handleDelete(asset.id)}
                      className="interactive-element px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 text-sm transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
