'use client'

import { Suspense, lazy, useState, useEffect, useRef } from 'react'
import type { ReactEventHandler } from 'react'
import { Loader2, AlertCircle, Maximize2, Minimize2, RotateCcw } from 'lucide-react'
const Spline = lazy(() => import('@splinetool/react-spline'))

interface SplineSceneProps {
  scene: string
  className?: string
  autoRotate?: boolean
  showControls?: boolean
  onLoad?: () => void
  onError?: (error: Error) => void
}

export function SplineScene({ 
  scene, 
  className = '',
  autoRotate = false,
  showControls = true,
  onLoad,
  onError
}: SplineSceneProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isIntersecting, setIsIntersecting] = useState(true)
  const [isPageVisible, setIsPageVisible] = useState(true)
  const [renderKey, setRenderKey] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const splineRef = useRef<any>(null)

  useEffect(() => {
    const handleVisibility = () => {
      setIsPageVisible(!document.hidden)
    }

    handleVisibility()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(!!entry?.isIntersecting)
      },
      { threshold: 0.2 }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const isActive = isIntersecting && isPageVisible

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const handleLoad = (spline: any) => {
    splineRef.current = spline
    setIsLoading(false)
    setIsLoaded(true)
    onLoad?.()
  }

  const handleError: ReactEventHandler<HTMLDivElement> = () => {
    const err = new Error('Failed to load scene')
    setError(err)
    setIsLoading(false)
    onError?.(err)
  }

  const toggleFullscreen = async () => {
    if (!containerRef.current) return

    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch (err) {
      console.error('Fullscreen error:', err)
    }
  }

  const resetCamera = () => {
    if (splineRef.current) {
      // Reset to default camera position
      splineRef.current.setZoom(1)
    }
  }

  useEffect(() => {
    if (!isActive) {
      if (splineRef.current?.dispose) {
        splineRef.current.dispose()
      } else if (splineRef.current?.destroy) {
        splineRef.current.destroy()
      }
      splineRef.current = null
      setIsLoaded(false)
      setIsLoading(false)
      return
    }

    setError(null)
    setIsLoading(true)
    setIsLoaded(false)
    setRenderKey((prev) => prev + 1)
  }, [isActive])

  useEffect(() => {
    return () => {
      if (splineRef.current?.dispose) {
        splineRef.current.dispose()
      } else if (splineRef.current?.destroy) {
        splineRef.current.destroy()
      }
      splineRef.current = null
    }
  }, [])

  if (error) {
    return (
      <div className={`relative w-full h-full min-h-[400px] rounded-2xl overflow-hidden bg-black/50 border border-red-500/30 ${className}`}>
        <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">Failed to Load Scene</h3>
          <p className="text-sm text-gray-400 mb-4">{error.message}</p>
          <button
            onClick={() => {
              setError(null)
              setIsLoading(true)
              setIsLoaded(false)
            }}
            className="px-4 py-2 bg-[#00d9ff]/20 hover:bg-[#00d9ff]/30 border border-[#00d9ff]/50 rounded-lg text-[#00d9ff] transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div 
      ref={containerRef}
      className={`relative w-full h-full min-h-[400px] rounded-2xl overflow-hidden bg-gradient-to-br from-black via-gray-900 to-black border border-white/10 ${className}`}
    >
      {/* Loading State */}
      {isActive && isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-[#00d9ff]/20 border-t-[#00d9ff] rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-[#00d9ff] animate-spin" />
            </div>
          </div>
          <p className="mt-4 text-sm text-gray-400">Loading 3D scene...</p>
        </div>
      )}

      {/* Spline Scene */}
      {isActive && (
        <Suspense fallback={null}>
          <Spline
            key={renderKey}
            scene={scene}
            onLoad={handleLoad}
            onError={handleError}
            className="w-full h-full"
          />
        </Suspense>
      )}

      {/* Controls Overlay */}
      {showControls && isLoaded && (
        <div className="absolute bottom-4 right-4 flex gap-2 z-20">
          <button
            onClick={resetCamera}
            className="p-3 glass rounded-lg border border-white/10 hover:border-[#00d9ff]/50 hover:bg-[#00d9ff]/10 transition-all group"
            title="Reset Camera"
          >
            <RotateCcw className="w-4 h-4 text-white group-hover:text-[#00d9ff] transition-colors" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-3 glass rounded-lg border border-white/10 hover:border-[#00d9ff]/50 hover:bg-[#00d9ff]/10 transition-all group"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4 text-white group-hover:text-[#00d9ff] transition-colors" />
            ) : (
              <Maximize2 className="w-4 h-4 text-white group-hover:text-[#00d9ff] transition-colors" />
            )}
          </button>
        </div>
      )}

      {/* Gradient Overlay for better visibility */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/20 via-transparent to-transparent z-0" />

      {/* Neon Glow Effect */}
      {isLoaded && (
        <div className="absolute inset-0 pointer-events-none z-0">
          <div className="absolute -inset-1 bg-gradient-to-r from-[#00d9ff]/20 via-[#0099ff]/20 to-[#00d9ff]/20 rounded-2xl blur-xl opacity-50 animate-pulse" />
        </div>
      )}
    </div>
  )
}