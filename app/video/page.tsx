'use client';

import { useState, useRef, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import { Video, Camera, Lightbulb, Film, User, Music, Building2, Lock } from 'lucide-react';
import { usePersona } from '@/hooks/usePersona';
import { canUsePersona } from '@/lib/subscription';

interface ImageSequence {
  id: string;
  file: File;
  preview: string;
  description: string;
  order: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function VideoPage() {
  const [selectedPersona, setSelectedPersona] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<number>(0);
  const [generationStatus, setGenerationStatus] = useState<string>('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string>('');
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [imageSequence, setImageSequence] = useState<ImageSequence[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [generationMode, setGenerationMode] = useState<'images' | 'text-only'>('images');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const { user, persona } = usePersona();
  const canUsePersonaFeatures = canUsePersona(user);
  const personaReady = persona?.visualStatus === 'ready';
  const [personaMode, setPersonaMode] = useState<'generic' | 'persona'>('generic');

  // In a real app, this would come from a database/API
  // For now, we'll use localStorage or allow manual entry
  const [trainedPersonas, setTrainedPersonas] = useState<string[]>([]);

  // Load trained personas from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('trainedPersonas');
      if (saved) {
        try {
          setTrainedPersonas(JSON.parse(saved));
        } catch (e) {
          console.error('Failed to load personas:', e);
        }
      }

      // Also load trigger words from training completions
      const savedTriggerWords = localStorage.getItem('triggerWords');
      if (savedTriggerWords) {
        try {
          const words = JSON.parse(savedTriggerWords);
          setTrainedPersonas(prev => {
            const combined = [...new Set([...prev, ...words])];
            return combined;
          });
        } catch (e) {
          console.error('Failed to load trigger words:', e);
        }
      }
    }
  }, []);

  // Scroll chat to bottom when new messages are added
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleChatSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (!chatInput.trim()) {
      alert('Please enter a video description');
      return;
    }
    
    // In images mode, warn if no images but allow text-only generation
    if (generationMode === 'images' && imageSequence.length === 0) {
      const proceed = confirm('No images uploaded. Continue with text-to-video generation?');
      if (!proceed) return;
    }

    // Disable button immediately to prevent multiple requests
    setIsGenerating(true);

    // Add user message to chat
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: chatInput.trim(),
      timestamp: new Date(),
    };

    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');

    // Generate video based on chat input
    await generateVideoFromChat(chatInput.trim());
  };

  const generateVideoFromChat = async (userPrompt: string) => {
    const triggerWord = personaMode === 'persona' ? selectedPersona : '';
    const isTextOnlyMode = generationMode === 'text-only' || imageSequence.length === 0;

    if (personaMode === 'persona') {
      if (!canUsePersonaFeatures) {
        setIsPricingModalOpen(true);
        alert('Premium plan required to use Persona Mode.');
        return;
      }
      if (!personaReady) {
        alert('Persona Mode requires a ready visual persona.');
        return;
      }
      if (!persona?.id) {
        alert('Persona Mode requires a persona identity.');
        return;
      }
    }
    
    setIsGenerating(true);
    setGenerationProgress(0);
    setGenerationStatus(isTextOnlyMode ? 'Starting text-to-video generation...' : 'Preparing video generation...');
    setVideoUrl(null);

    try {
      // Build comprehensive prompt from chat
      // The user's chat input may already reference images, so we preserve it
      let fullPrompt = userPrompt;

      // If we have images and user hasn't referenced them, auto-add references
      if (imageSequence.length > 0 && !userPrompt.toLowerCase().includes('image')) {
        const imageReferences = imageSequence
          .sort((a, b) => a.order - b.order)
          .map((img, index) => {
            const desc = img.description.trim() || 'action/transition';
            return `Image ${index + 1}: ${desc}`;
          });
        // Add image references before user's prompt
        fullPrompt = `${imageReferences.join('. ')}. ${userPrompt}`;
      }

      // Enhance prompt with dynamic control suggestions if not already present
      // Add cinematic enhancements if user mentions camera/lighting/etc
      const hasCameraMention = /camera|pan|zoom|rotate|movement/i.test(userPrompt);
      const hasLightingMention = /lighting|light|bright|dark|mood/i.test(userPrompt);
      const hasTransitionMention = /transition|smooth|quick|fade/i.test(userPrompt);
      
      // Prepend persona trigger word if selected
      if (triggerWord && triggerWord.trim()) {
        fullPrompt = `${triggerWord} ${fullPrompt}`;
      }
      
      // Add quality and cinematic enhancements
      if (!fullPrompt.toLowerCase().includes('cinematic') && !fullPrompt.toLowerCase().includes('high quality')) {
        fullPrompt = `${fullPrompt}, cinematic, high quality, professional video`;
      }

      setGenerationStatus('Sending request to AI video generator...');
      setGenerationProgress(20);

      // Prepare request body
      const requestBody: any = {
        prompt: fullPrompt,
        triggerWord: triggerWord || undefined,
        personaMode,
        personaStatus: persona?.visualStatus ?? 'none',
        personaId: persona?.id,
        isTextOnly: isTextOnlyMode,
        mode: isTextOnlyMode ? 'text-to-video' : 'image-to-video',
        user,
      };

      // Add images if we have them
      if (imageSequence.length > 0) {
        setGenerationStatus('Converting images to sequence...');
        setGenerationProgress(30);

        const imagePromises = imageSequence
          .sort((a, b) => a.order - b.order)
          .map(async (img) => {
            return new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.readAsDataURL(img.file);
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
            });
          });

        const imageBase64Array = await Promise.all(imagePromises);
        requestBody.images = imageBase64Array;
        requestBody.descriptions = imageSequence
          .sort((a, b) => a.order - b.order)
          .map(img => img.description);
      }

      setGenerationStatus('Starting video generation...');
      setGenerationProgress(40);

      // Retry logic for 429 errors
      let videoResponse;
      let retryCount = 0;
      const maxRetries = 1; // Retry once

      // Helper to extract retry_after duration from response
      const getRetryAfter = (response: Response): number => {
        const retryAfterHeader = response.headers.get('retry-after');
        if (retryAfterHeader) {
          const retryAfter = parseInt(retryAfterHeader, 10);
          if (!isNaN(retryAfter) && retryAfter > 0) {
            return retryAfter * 1000; // Convert to milliseconds
          }
        }
        // Default to 5 seconds if not specified
        return 5000;
      };

      while (retryCount <= maxRetries) {
        try {
          videoResponse = await fetch('/api/generate-video', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });

          // If 429 error and we haven't retried yet, wait and retry
          if (videoResponse.status === 429 && retryCount < maxRetries) {
            const retryAfter = getRetryAfter(videoResponse);
            const retrySeconds = Math.ceil(retryAfter / 1000);
            setGenerationStatus(`Replicate is processing other requests. Retrying in ${retrySeconds} seconds...`);
            setGenerationProgress(40);
            
            // Wait for retry_after duration before retrying
            await new Promise(resolve => setTimeout(resolve, retryAfter));
            
            retryCount++;
            setGenerationStatus('Retrying video generation request...');
            continue;
          }

          // If not 429 or we've already retried, break out of loop
          break;
        } catch (fetchError: any) {
          // If it's a network error and we haven't retried, wait and retry
          if (retryCount < maxRetries) {
            setGenerationStatus('Replicate is processing other requests. Retrying in 5 seconds...');
            setGenerationProgress(40);
            
            // Wait 5 seconds before retrying (network errors don't have retry_after)
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            retryCount++;
            setGenerationStatus('Retrying video generation request...');
            continue;
          }
          // If we've already retried or it's not a retryable error, throw it
          throw fetchError;
        }
      }

      if (!videoResponse || !videoResponse.ok) {
        const error = await videoResponse?.json().catch(() => ({ error: 'Video generation failed' }));
        throw new Error(error.error || 'Video generation failed');
      }

      const data = await videoResponse.json();
      setVideoId(data.videoId);
      setGenerationStatus('Video generation started! Monitoring progress...');
      setGenerationProgress(20);

      // Poll for video generation status
      pollVideoStatus(data.videoId);

    } catch (error: any) {
      console.error('Video generation error:', error);
      
      // Check for safety filter error (E005)
      if (error.message?.includes('E005') || error.message?.toLowerCase().includes('sensitive') || error.message?.toLowerCase().includes('safety')) {
        alert('Üzgünüz, bu içerik güvenlik filtresine takıldı. Lütfen daha farklı bir açıklama yazmayı deneyin.');
        
        // Add error message to chat
        const errorMessage: ChatMessage = {
          id: `msg-${Date.now()}-error`,
          role: 'assistant',
          content: '⚠️ Üzgünüz, bu içerik güvenlik filtresine takıldı. Lütfen daha farklı bir açıklama yazmayı deneyin.',
          timestamp: new Date(),
        };
        setChatMessages(prev => [...prev, errorMessage]);
      } else if (error.message?.includes('429') || error.message?.includes('Too Many Requests')) {
        // Check if it's a 429 error that we couldn't retry
        alert('Video generation failed: Replicate is currently processing too many requests. Please try again in a few moments.');
      } else {
        alert(`Video generation failed: ${error.message}`);
      }
      
      // Always reset generating state so button becomes active again
      setIsGenerating(false);
      setGenerationProgress(0);
      setGenerationStatus('');
    }
  };

  const pollVideoStatus = async (id: string) => {
    const maxAttempts = 180; // 15 minutes max (5 second intervals)
    let attempts = 0;

    const poll = async () => {
      try {
        const statusResponse = await fetch(`/api/generate-video/status?id=${id}`);
        const data = await statusResponse.json();

        if (data.status === 'succeeded' && data.videoUrl) {
          setGenerationProgress(100);
          setGenerationStatus('Video generation complete!');
          const videoUrlResult = data.videoUrl;
          setVideoUrl(videoUrlResult);
          setIsGenerating(false);
          
          // Auto-save to My Assets
          if (typeof window !== 'undefined') {
            import('@/lib/assets-storage').then(({ saveVideoAsset }) => {
              saveVideoAsset(videoUrlResult, `AI Video - ${new Date().toLocaleDateString()}`, {
                model: 'minimax/video-01',
              });
            });
          }
          
          // Add success message to chat
          const successMessage: ChatMessage = {
            id: `msg-${Date.now()}-success`,
            role: 'assistant',
            content: '🎬 Video generation complete! Your video is ready to download.',
            timestamp: new Date(),
          };
          setChatMessages(prev => [...prev, successMessage]);
          return;
        }

        if (data.status === 'failed') {
          const errorMessage = data.error || 'Video generation failed';
          // Check for safety filter error (E005) or sensitive content
          if (errorMessage.includes('E005') || errorMessage.toLowerCase().includes('sensitive') || errorMessage.toLowerCase().includes('safety')) {
            throw new Error('SAFETY_FILTER_E005');
          }
          throw new Error(errorMessage);
        }

        // Update progress based on status
        if (data.progress !== undefined) {
          setGenerationProgress(20 + (data.progress * 0.8)); // 20-100% range
        }

        setGenerationStatus(data.statusMessage || 'Generating video...');

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000); // Poll every 5 seconds
        } else {
          throw new Error('Video generation timeout');
        }
      } catch (error: any) {
        console.error('Polling error:', error);
        
        // Check for safety filter error (E005)
        if (error.message === 'SAFETY_FILTER_E005' || error.message?.includes('E005') || error.message?.toLowerCase().includes('sensitive') || error.message?.toLowerCase().includes('safety')) {
          setGenerationStatus('Güvenlik filtresi hatası');
          alert('Üzgünüz, bu içerik güvenlik filtresine takıldı. Lütfen daha farklı bir açıklama yazmayı deneyin.');
          
          // Add error message to chat
          const errorMessage: ChatMessage = {
            id: `msg-${Date.now()}-error`,
            role: 'assistant',
            content: '⚠️ Üzgünüz, bu içerik güvenlik filtresine takıldı. Lütfen daha farklı bir açıklama yazmayı deneyin.',
            timestamp: new Date(),
          };
          setChatMessages(prev => [...prev, errorMessage]);
        } else {
          setGenerationStatus(`Error: ${error.message}`);
          alert(`Video generation failed: ${error.message}`);
        }
        
        // Always reset generating state so button becomes active again
        setIsGenerating(false);
        setGenerationProgress(0);
        setGenerationStatus('');
      }
    };

    poll();
  };

  const downloadVideo = () => {
    if (!videoUrl) return;

    const link = document.createElement('a');
    link.href = videoUrl;
    link.download = `ai-video-${Date.now()}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle multiple image uploads
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    const newImages: ImageSequence[] = imageFiles.map((file, index) => ({
      id: `img-${Date.now()}-${index}`,
      file,
      preview: URL.createObjectURL(file),
      description: '',
      order: imageSequence.length + index,
    }));

    setImageSequence(prev => [...prev, ...newImages]);
    
    // Clear input
    if (e.target) {
      e.target.value = '';
    }
  };

  // Remove image from sequence
  const removeImage = (id: string) => {
    setImageSequence(prev => {
      const filtered = prev.filter(img => img.id !== id);
      // Reorder remaining images
      return filtered.map((img, index) => ({ ...img, order: index }));
    });
  };

  // Update image description
  const updateImageDescription = (id: string, description: string) => {
    setImageSequence(prev =>
      prev.map(img => (img.id === id ? { ...img, description } : img))
    );
  };

  // Drag and drop handlers for reordering images
  const handleDragStart = (e: React.DragEvent, imgId: string) => {
    const sortedSequence = [...imageSequence].sort((a, b) => a.order - b.order);
    const index = sortedSequence.findIndex(img => img.id === imgId);
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropImgId: string) => {
    e.preventDefault();
    if (draggedIndex === null) {
      setDraggedIndex(null);
      return;
    }

    const sortedSequence = [...imageSequence].sort((a, b) => a.order - b.order);
    const dropIndex = sortedSequence.findIndex(img => img.id === dropImgId);
    
    if (draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }

    const draggedItem = sortedSequence[draggedIndex];
    sortedSequence.splice(draggedIndex, 1);
    sortedSequence.splice(dropIndex, 0, draggedItem);

    // Update order numbers
    const reordered = sortedSequence.map((img, index) => ({
      ...img,
      order: index,
    }));

    setImageSequence(reordered);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0a] via-[#1a1a1a] to-[#0a0a0a]">
      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      
      <main className="ml-64 p-8">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <div className="mb-8">
            <Link href="/" className="text-[#00d9ff] hover:text-[#00d9ff]/80 mb-4 inline-block">
              ← Back to Studio
            </Link>
            <h1 className="text-4xl font-bold text-white mb-2">
              <span className="bg-gradient-to-r from-[#00d9ff] via-[#0099cc] to-[#00d9ff] bg-clip-text text-transparent">
                Generate 3D Motion
              </span>
            </h1>
            <p className="text-gray-400 text-lg">
              Create videos from text prompts or image sequences. Describe camera movements, lighting, transitions, and actions. Use your trained AI Personas for consistent characters.
            </p>
          </div>

          {/* Persona Mode */}
          <div className="glass rounded-2xl p-6 mb-8">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2 className="text-xl font-semibold text-white">Use Persona</h2>
              <span className="text-xs text-white/50">Requires ready visual persona</span>
            </div>
            <div className="flex items-center justify-between gap-4 mb-6">
              <p className="text-sm text-gray-300">
                {personaMode === 'persona'
                  ? 'Persona mode enabled — consistent identity across frames.'
                  : 'Generic mode — no persona reference.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (personaMode === 'persona') {
                    setPersonaMode('generic');
                    setSelectedPersona('');
                  } else {
                    setPersonaMode('persona');
                  }
                }}
                className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors ${
                  personaMode === 'persona' ? 'bg-[#00d9ff]' : 'bg-white/10'
                }`}
                disabled={isGenerating || !canUsePersonaFeatures || !personaReady}
                title={
                  !canUsePersonaFeatures
                    ? 'Premium required to use Persona Mode.'
                    : !personaReady
                      ? 'Persona Mode requires a ready visual persona.'
                      : ''
                }
                aria-pressed={personaMode === 'persona'}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                    personaMode === 'persona' ? 'translate-x-9' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            {!canUsePersonaFeatures && (
              <p className="text-sm text-yellow-400 mb-4 flex items-center gap-2">
                <Lock className="w-4 h-4" />
                Premium required to use Persona Mode.
              </p>
            )}
            {canUsePersonaFeatures && !personaReady && (
              <p className="text-sm text-yellow-400 mb-4">
                Persona Mode is disabled until your visual persona is ready.
              </p>
            )}

            {/* Persona Selection - Only in Persona Mode */}
            {personaMode === 'persona' && (
              <div className="mb-4">
                {trainedPersonas.length > 0 ? (
                  <select
                    value={selectedPersona}
                    onChange={(e) => setSelectedPersona(e.target.value)}
                    disabled={isGenerating || !canUsePersonaFeatures}
                    className="w-full glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none"
                  >
                    <option value="">Select a persona</option>
                    {trainedPersonas.map((persona, index) => (
                      <option key={index} value={persona}>
                        {persona}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-yellow-400 text-sm">
                      No trained personas found. Train one in the Persona Lab.
                      {' '}
                      <Link href="/persona" className="underline ml-1">
                        Train your first persona
                      </Link>
                      {' '}for consistent character results.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mode Selector */}
          <div className="glass rounded-2xl p-6 mb-8">
            <div className="flex items-center gap-4 mb-4">
              <button
                onClick={() => {
                  setGenerationMode('text-only');
                  setImageSequence([]);
                }}
                className={`flex-1 px-4 py-3 rounded-lg font-medium transition-all ${
                  generationMode === 'text-only'
                    ? 'bg-gradient-to-r from-[#00d9ff] to-[#0099cc] text-white'
                    : 'glass text-gray-300 hover:bg-white/5 border border-white/10'
                }`}
                disabled={isGenerating}
              >
                📝 Text-to-Video Only
              </button>
              <button
                onClick={() => setGenerationMode('images')}
                className={`flex-1 px-4 py-3 rounded-lg font-medium transition-all ${
                  generationMode === 'images'
                    ? 'bg-gradient-to-r from-[#00d9ff] to-[#0099cc] text-white'
                    : 'glass text-gray-300 hover:bg-white/5 border border-white/10'
                }`}
                disabled={isGenerating}
              >
                🖼️ With Images
              </button>
            </div>
            <p className="text-xs text-gray-400 text-center">
              {generationMode === 'text-only' 
                ? 'Generate videos purely from text descriptions. No images needed.'
                : 'Upload images and describe how they should be used in your video.'}
            </p>
          </div>

          {/* Interactive Chat Interface */}
          <div className="glass rounded-2xl p-6 mb-8 flex flex-col h-[500px]">
            <h2 className="text-xl font-semibold text-white mb-4">Video Creation Chat</h2>
            
            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-2">
              {chatMessages.length === 0 && (
                <div className="text-center text-gray-500 py-12">
                  <p className="text-lg mb-2">👋 Start creating your video!</p>
                  <p className="text-sm mb-4">Type your instructions below. You can describe:</p>
                  <div className="grid grid-cols-2 gap-2 text-xs text-left max-w-md mx-auto">
                    <div className="glass p-3 rounded-lg">🎥 Camera movements</div>
                    <div className="glass p-3 rounded-lg">💡 Lighting & mood</div>
                    <div className="glass p-3 rounded-lg">🎬 Scene transitions</div>
                    <div className="glass p-3 rounded-lg">👤 Character actions</div>
                    <div className="glass p-3 rounded-lg">🎵 Music suggestions</div>
                    <div className="glass p-3 rounded-lg">🌆 Environment details</div>
                  </div>
                  {generationMode === 'images' && imageSequence.length > 0 && (
                    <p className="text-sm mt-4 text-[#00d9ff]">
                      Reference images like: "Image 1: character walking, Image 2: car approaching"
                    </p>
                  )}
                </div>
              )}

              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-3 ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-r from-[#00d9ff] to-[#0099cc] text-white'
                        : 'glass text-gray-300 border border-white/10'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    <p className="text-xs opacity-70 mt-1">
                      {msg.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input */}
            <form onSubmit={handleChatSubmit} className="flex gap-2">
              <textarea
                ref={chatInputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleChatSubmit();
                  }
                }}
                placeholder={
                  generationMode === 'text-only'
                    ? 'Describe your video: "A futuristic city at sunset with flying cars, cinematic camera movement, dramatic lighting, smooth transitions, epic music mood..."'
                    : imageSequence.length > 0
                    ? 'Reference images: "Image 1: character walking, Image 2: car following. Camera pans slowly. Add dramatic lighting. Smooth transition between scenes..."'
                    : 'Upload images below first, or switch to text-only mode. Describe camera movements (pan, zoom, rotate), lighting (dramatic, soft, neon), transitions (smooth, quick), character actions, and mood...'
                }
                disabled={isGenerating}
                rows={3}
                className="flex-1 glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none placeholder-gray-500 resize-none"
              />
              <button
                type="submit"
                disabled={isGenerating || !chatInput.trim()}
                className="px-6 py-3 bg-gradient-to-r from-[#00d9ff] to-[#0099cc] text-white font-semibold rounded-lg hover:from-[#00d9ff]/90 hover:to-[#0099cc]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <span>🚀</span>
                <span>Generate</span>
              </button>
            </form>

            {generationMode === 'images' && imageSequence.length === 0 && (
              <p className="text-xs text-blue-400 mt-2 text-center">
                💡 Tip: Upload images below to reference them, or switch to text-only mode to generate videos purely from text descriptions
              </p>
            )}
          </div>

          {/* Image Sequence Upload - Only show when mode is 'images' */}
          {generationMode === 'images' && (
            <div className="glass rounded-2xl p-8 mb-8">
              <h2 className="text-2xl font-semibold text-white mb-4">Upload Images (Optional)</h2>
              <p className="text-gray-400 mb-4">
                Upload images to reference in your chat. Drag to reorder. You can reference them as "Image 1", "Image 2", etc. in your chat.
              </p>

            {/* Image Upload Input */}
            <div className="mb-6">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                disabled={isGenerating}
                className="hidden"
                id="video-image-upload"
              />
              <label
                htmlFor="video-image-upload"
                className={`inline-flex items-center gap-2 rounded-lg px-6 py-3 text-white font-medium border border-[#00d9ff]/30 cursor-pointer transition-all hover:bg-[#00d9ff]/10 ${
                  isGenerating ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <Camera className="w-4 h-4 inline mr-2" /> Upload Images (Multiple)
              </label>
              <p className="text-xs text-gray-400 mt-2">
                Upload images to reference in your chat. Reference them as "Image 1", "Image 2", etc. in your chat commands. Images are optional - you can also generate videos purely from text.
              </p>
            </div>

            {/* Image Sequence with Drag-and-Drop */}
            {imageSequence.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white">
                  Image Sequence ({imageSequence.length} images)
                </h3>
                <p className="text-xs text-gray-400 mb-4">
                  Drag images to reorder. Add descriptions for each image to define the narrative.
                </p>

                {imageSequence
                  .sort((a, b) => a.order - b.order)
                  .map((img, index) => (
                    <div
                      key={img.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, img.id)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, img.id)}
                      onDragEnd={handleDragEnd}
                      className={`glass rounded-lg p-4 border-2 transition-all cursor-move ${
                        (() => {
                          const sorted = [...imageSequence].sort((a, b) => a.order - b.order);
                          const sortedIndex = sorted.findIndex(i => i.id === img.id);
                          return draggedIndex === sortedIndex;
                        })()
                          ? 'border-[#00d9ff] opacity-50 bg-[#00d9ff]/10'
                          : 'border-white/10 hover:border-[#00d9ff]/30'
                      }`}
                    >
                      <div className="flex gap-4 items-start">
                        {/* Image Preview */}
                        <div className="relative flex-shrink-0">
                          <div className="absolute -top-2 -left-2 w-8 h-8 rounded-full bg-[#00d9ff] text-black font-bold flex items-center justify-center text-sm">
                            {img.order + 1}
                          </div>
                          <img
                            src={img.preview}
                            alt={`Frame ${img.order + 1}`}
                            className="w-32 h-32 object-cover rounded-lg"
                          />
                        </div>

                        {/* Description Input */}
                        <div className="flex-1">
                          <label className="block text-sm font-medium text-gray-300 mb-2">
                            Image {img.order + 1} - Action/Transition:
                          </label>
                          <input
                            type="text"
                            value={img.description}
                            onChange={(e) => updateImageDescription(img.id, e.target.value)}
                            placeholder={`e.g., character walking, car approaching, explosion, transition to...`}
                            disabled={isGenerating}
                            className="w-full glass rounded-lg px-4 py-2 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none placeholder-gray-500"
                          />
                          <p className="text-xs text-gray-400 mt-1">
                            Optional: Describe what happens in this image (e.g., "character walking"). Reference as "Image {img.order + 1}" in your chat.
                          </p>
                        </div>

                        {/* Remove Button */}
                        <button
                          onClick={() => removeImage(img.id)}
                          disabled={isGenerating}
                          className="flex-shrink-0 w-8 h-8 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 flex items-center justify-center transition-all disabled:opacity-50"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
          )}

          {/* Generation Progress */}
          {isGenerating && (
            <div className="glass rounded-2xl p-8 mb-8">
              <h2 className="text-2xl font-semibold text-white mb-4">Generation Progress</h2>
              
              <div className="mb-4">
                <div className="flex justify-between text-sm text-gray-400 mb-2">
                  <span>{generationStatus}</span>
                  <span>{Math.round(generationProgress)}%</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#00d9ff] to-[#0099cc] transition-all duration-500"
                    style={{ width: `${generationProgress}%` }}
                  />
                </div>
              </div>

              {videoId && (
                <p className="text-xs text-gray-500 mt-4">
                  Video ID: {videoId}
                </p>
              )}
            </div>
          )}

          {/* Video Result */}
          {videoUrl && (
            <div className="glass rounded-2xl p-8 mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-semibold text-white">Generated Video</h2>
                <button
                  onClick={downloadVideo}
                  className="flex items-center gap-2 rounded-lg bg-[#00d9ff]/10 px-4 py-2 text-sm font-medium text-[#00d9ff] transition-all hover:bg-[#00d9ff]/20"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  Download Video
                </button>
              </div>
              
              <div className="rounded-lg overflow-hidden bg-black">
                <video
                  src={videoUrl}
                  controls
                  className="w-full max-h-[600px]"
                  autoPlay
                  loop
                >
                  Your browser does not support the video tag.
                </video>
              </div>
            </div>
          )}

          {/* Info Section */}
          <div className="glass rounded-2xl p-8">
            <h2 className="text-2xl font-semibold text-white mb-4">How It Works</h2>
            <div className="space-y-4 text-gray-400">
              <div className="flex gap-4">
                <span className="text-2xl">1️⃣</span>
                <div>
                  <h3 className="text-white font-medium mb-1">Upload Image Sequence</h3>
                  <p>Upload multiple images that will form your video sequence. Drag images to reorder them.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <span className="text-2xl">2️⃣</span>
                <div>
                  <h3 className="text-white font-medium mb-1">Describe Each Frame</h3>
                  <p>Add descriptions for each image (e.g., "character walking", "car approaching", "explosion").</p>
                </div>
              </div>
              <div className="flex gap-4">
                <span className="text-2xl">3️⃣</span>
                <div>
                  <h3 className="text-white font-medium mb-1">Generate & Download</h3>
                  <p>AI creates a cohesive video narrative from your image sequence. Download when ready!</p>
                </div>
              </div>
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
