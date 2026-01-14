"use client"

import { useEffect, useState } from "react"
import { SplineScene } from "@/components/ui/splite"

export default function IntroOverlay() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const seen = localStorage.getItem("intro_seen")
    if (!seen) {
      setShow(true)
    }
  }, [])

  const handleEnter = () => {
    localStorage.setItem("intro_seen", "true")
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center">
      {/* ROBOT */}
      <div className="absolute inset-0">
        <SplineScene
          scene="BURAYA_SPLINE_SCENE_URL"
          className="w-full h-full"
        />
      </div>

      {/* OVERLAY UI */}
      <div className="relative z-10 text-center px-6">
        <h1 className="text-4xl font-bold text-white mb-4">
          Train Your AI Persona
        </h1>
        <p className="text-gray-400 mb-6 max-w-md mx-auto">
          Upload 20 photos. Your AI learns you. Create ads, images and videos.
        </p>
        <button
          onClick={handleEnter}
          className="rounded-xl bg-cyan-500 px-6 py-3 font-semibold text-black hover:bg-cyan-400 transition"
        >
          Enter Studio
        </button>
      </div>
    </div>
  )
}
