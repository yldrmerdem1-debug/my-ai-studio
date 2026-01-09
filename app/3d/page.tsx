'use client';

import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import { Box, Upload, Sparkles } from 'lucide-react';

export default function CharacterLabPage() {
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-black via-gray-900 to-black">
      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      
      <main className="ml-64 flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          {/* Header Section */}
          <div className="mb-12">
            <h1 className="text-4xl font-bold text-white mb-3 flex items-center gap-3">
              <Box className="w-10 h-10 text-[#00d9ff]" />
              Advanced 3D Character Studio
            </h1>
            <p className="text-lg text-gray-400">
              Create, rig, and animate high-fidelity 3D assets
            </p>
          </div>

          {/* Main Content Area */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Upload Section */}
            <div className="glass-strong rounded-2xl p-8 border border-white/10">
              <div className="flex items-center gap-3 mb-6">
                <Upload className="w-6 h-6 text-[#00d9ff]" />
                <h2 className="text-2xl font-semibold text-white">Import Character</h2>
              </div>
              <div className="border-2 border-dashed border-white/20 rounded-xl p-12 text-center hover:border-[#00d9ff]/50 transition-colors cursor-pointer">
                <Box className="w-16 h-16 mx-auto mb-4 text-white/40" />
                <p className="text-white/60 mb-2">Drag & drop your 3D model here</p>
                <p className="text-sm text-gray-500">Supports .obj, .fbx, .gltf formats</p>
              </div>
            </div>

            {/* Character Settings */}
            <div className="glass-strong rounded-2xl p-8 border border-white/10">
              <div className="flex items-center gap-3 mb-6">
                <Sparkles className="w-6 h-6 text-[#00d9ff]" />
                <h2 className="text-2xl font-semibold text-white">Character Settings</h2>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Character Name</label>
                  <input
                    type="text"
                    placeholder="Enter character name"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[#00d9ff]/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Description</label>
                  <textarea
                    placeholder="Describe your character"
                    rows={4}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[#00d9ff]/50 transition-colors resize-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Features Grid */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="glass rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold text-white mb-2">Model Import</h3>
              <p className="text-sm text-gray-400">Import 3D models from popular formats</p>
            </div>
            <div className="glass rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold text-white mb-2">Rigging</h3>
              <p className="text-sm text-gray-400">Automatic bone rigging for animation</p>
            </div>
            <div className="glass rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold text-white mb-2">Animation</h3>
              <p className="text-sm text-gray-400">Create smooth character animations</p>
            </div>
          </div>
        </div>
      </main>

      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={() => setIsPricingModalOpen(false)}
      />
    </div>
  );
}
