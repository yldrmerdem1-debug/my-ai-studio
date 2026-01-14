'use client';

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20 pb-20">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#00d9ff]/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#0099ff]/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <div className="relative z-10 container mx-auto px-8 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        {/* Left: Text Content */}
        <div className="text-center lg:text-left space-y-6 animate-fade-in-up">
          <h1 className="text-6xl lg:text-7xl font-bold bg-gradient-to-r from-white via-[#00d9ff] to-white bg-clip-text text-transparent leading-tight">
            The Future of<br />AI Production
          </h1>
          <p className="text-xl lg:text-2xl text-gray-300 leading-relaxed max-w-2xl">
            Transform your creative workflow with cutting-edge AI tools. Create, edit, and produce professional content in seconds.
          </p>
        </div>

        {/* Right: 3D Character Placeholder */}
        <div className="flex items-center justify-center min-h-[500px]">
          <div className="relative w-full max-w-md h-[500px] flex items-center justify-center">
            {/* Placeholder for Splite component - Will be replaced when Splite is installed */}
            <div className="w-80 h-80 rounded-full bg-gradient-to-br from-[#00d9ff]/20 via-[#0099ff]/20 to-purple-500/20 blur-2xl animate-pulse" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="w-32 h-32 mx-auto mb-4 rounded-full bg-white/5 border border-white/10 backdrop-blur-md flex items-center justify-center">
                  <svg className="w-16 h-16 text-[#00d9ff]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                  </svg>
                </div>
                <p className="text-gray-400 text-sm">3D Character</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
