'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { SiOpenai, SiFlux, SiElevenlabs } from 'react-icons/si';
import { Sparkles, Film, PlayCircle, Zap, Box, Eraser, Image as ImageIcon, FileText } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import UploadZone from '@/components/UploadZone';
import PreviewArea from '@/components/PreviewArea';
import PricingModal from '@/components/PricingModal';

export default function Home() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastApiResponse, setLastApiResponse] = useState<any>(null); // Store last API response for Force Display
  const [studioBackgroundPrompt, setStudioBackgroundPrompt] = useState<string>('professional studio background, clean white background, professional photography, high quality, studio lighting');
  const [videoMotionPrompt, setVideoMotionPrompt] = useState<string>(''); // Optional prompt for 3D motion video
  const [currentAction, setCurrentAction] = useState<string | null>(null); // Track current action for loading message
  const [selectedPersona, setSelectedPersona] = useState<string>(''); // Selected trained persona trigger word
  const [availablePersonas, setAvailablePersonas] = useState<string[]>([]); // Available trained personas
  const [response, setResponse] = useState<any>(null); // Single response state
  const [chatInput, setChatInput] = useState<string>(''); // Chat input state
  const [selectedActionType, setSelectedActionType] = useState<string>('Video'); // Selected action type: Video, Studio Background, or Ad Script

  // Load available personas on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('trainedPersonas');
      if (saved) {
        try {
          setAvailablePersonas(JSON.parse(saved));
        } catch (e) {
          console.error('Failed to load personas:', e);
        }
      }

      // Also try to load from API
      fetch('/api/save-persona')
        .then(res => res.json())
        .then(data => {
          if (data.personas && Array.isArray(data.personas)) {
            const triggerWords = data.personas.map((p: any) => p.triggerWord).filter(Boolean);
            setAvailablePersonas(prev => [...new Set([...prev, ...triggerWords])]);
          }
        })
        .catch(err => console.error('Failed to load personas from API:', err));
    }
  }, []);

  const handleFileUpload = (file: File) => {
    setUploadedFile(file);
    const url = URL.createObjectURL(file);
    setOriginalImageUrl(url);
    setResultImageUrl(null); // Reset result when new file is uploaded
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  // Robust recursive search function to find ANY string starting with 'http' anywhere in nested objects
  const recursiveSearchForUrl = (obj: any, visited = new Set(), depth = 0, maxDepth = 20): string | null => {
    if (obj === null || obj === undefined) return null;
    if (depth > maxDepth) return null; // Prevent too deep recursion
    
    // Prevent infinite loops on circular references
    if (typeof obj === 'object' && visited.has(obj)) return null;
    if (typeof obj === 'object') visited.add(obj);

    // Priority 1: Check if it's a string and starts with 'http' - return immediately
    if (typeof obj === 'string') {
      const trimmed = obj.trim();
      // Prioritize replicate.delivery URLs
      if (trimmed.includes('replicate.delivery') || trimmed.includes('https://')) {
        if (trimmed.startsWith('https://replicate.delivery/')) {
          console.log(`✓ Found replicate.delivery URL at depth ${depth}:`, trimmed);
          return trimmed;
        }
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          console.log(`✓ Found HTTP URL at depth ${depth}:`, trimmed);
          return trimmed;
        }
      }
      return null;
    }

    // If it's an array, recursively search each element
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const result = recursiveSearchForUrl(obj[i], visited, depth + 1, maxDepth);
        if (result) return result;
      }
      return null;
    }

    // If it's an object, search all properties recursively
    if (typeof obj === 'object') {
      // First, check common key names (quick check)
      const commonKeys = [
        'url', 'image', 'file', 'output', 'src', 'result', 
        'image_url', 'file_url', 'download_url', 'uri', 
        'link', 'href', 'path', 'location', 'address',
        'output_url', 'result_url', 'imageUrl', 'imageUrl'
      ];
      
      for (const key of commonKeys) {
        if (obj[key] !== undefined && obj[key] !== null && typeof obj[key] === 'string') {
          const trimmed = obj[key].trim();
          // Prioritize replicate.delivery URLs
          if (trimmed.includes('replicate.delivery') || trimmed.includes('https://')) {
            if (trimmed.startsWith('https://replicate.delivery/')) {
              console.log(`✓ Found replicate.delivery URL in key "${key}" at depth ${depth}:`, trimmed);
              return trimmed;
            }
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
              console.log(`✓ Found HTTP URL in key "${key}" at depth ${depth}:`, trimmed);
              return trimmed;
            }
          }
        }
      }
      
      // Then do a deep recursive search of ALL properties (thorough search)
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          const result = recursiveSearchForUrl(obj[key], visited, depth + 1, maxDepth);
          if (result) return result;
        }
      }
    }

    return null;
  };

  const handleAction = async (action: string) => {
    // Only require image for non-text actions
    if (!uploadedFile && action !== 'ad-script' && action !== '3d-motion') {
      alert('Please upload an image first');
      return;
    }

    setIsProcessing(true);
    setCurrentAction(action);
    setResultImageUrl(null);

    try {
      // Route video generation to the dedicated video API
      if (action === '3d-motion') {
        let imageBase64: string | undefined;
        const images: string[] = [];

        // Convert image to base64 if uploaded
        if (uploadedFile) {
          imageBase64 = await fileToBase64(uploadedFile);
          images.push(imageBase64);
        }

        // Use chat input if available, otherwise use videoMotionPrompt
        const promptToUse = chatInput.trim() || videoMotionPrompt || 'cinematic motion with depth, smooth transitions';

        // Determine if this is text-to-video or image-to-video
        const isTextOnly = !uploadedFile;

        console.log('=== VIDEO GENERATION REQUEST ===');
        console.log('Mode:', isTextOnly ? 'Text-to-Video' : 'Image-to-Video');
        console.log('Prompt:', promptToUse);
        console.log('Has Image:', !!imageBase64);
        console.log('Trigger Word:', selectedPersona || 'None');

        const requestBody = {
          images: images,
          descriptions: [],
          narrative: promptToUse,
          prompt: promptToUse,
          triggerWord: selectedPersona || undefined,
          isTextOnly: isTextOnly,
          mode: isTextOnly ? 'text-to-video' : 'image-to-video',
        };

        console.log('Request Payload:', JSON.stringify(requestBody, null, 2));

        const apiResponse = await fetch('/api/generate-video', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        console.log('API Response Status:', apiResponse.status);
        console.log('API Response Headers:', Object.fromEntries(apiResponse.headers.entries()));

        if (!apiResponse.ok) {
          const errorData = await apiResponse.json();
          console.error('API Error Response:', errorData);
          throw new Error(errorData.error || `API returned ${apiResponse.status}: ${apiResponse.statusText}`);
        }

        const data = await apiResponse.json();
        console.log('API Response Data:', data);

        // Video generation is async, so we get a videoId to poll
        if (data.videoId) {
          // Start polling for video status
          const pollVideoStatus = async (videoId: string) => {
            let attempts = 0;
            const maxAttempts = 60; // 5 minutes max

            while (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5 seconds

              try {
                const statusResponse = await fetch(`/api/generate-video/status?videoId=${videoId}`);
                const statusData = await statusResponse.json();
                console.log('Video Status Check:', statusData);

                if (statusData.status === 'succeeded' && statusData.output) {
                  const videoUrl = Array.isArray(statusData.output) ? statusData.output[0] : statusData.output;
                  console.log('Video generated successfully:', videoUrl);
                  setResultImageUrl(videoUrl);
                  setIsProcessing(false);
                  return;
                }

                if (statusData.status === 'failed' || statusData.status === 'canceled') {
                  throw new Error(statusData.error || 'Video generation failed');
                }
              } catch (error: any) {
                console.error('Error polling video status:', error);
                throw error;
              }

              attempts++;
            }

            throw new Error('Video generation timed out');
          };

          await pollVideoStatus(data.videoId);
        } else {
          throw new Error('No videoId returned from API');
        }

        return; // Exit early for video generation
      }

      // Handle other actions (remove-background, studio-background, ad-script)
      let imageBase64: string | undefined;

      // Convert image to base64 if needed
      if (uploadedFile && action !== 'ad-script') {
        imageBase64 = await fileToBase64(uploadedFile);
      }

      // Use chat input if available, otherwise use specific prompts
      let promptToUse: string | undefined;
      if (chatInput.trim()) {
        promptToUse = chatInput.trim();
      } else if (action === 'studio-background') {
        promptToUse = studioBackgroundPrompt;
      } else if (action === '3d-motion') {
        promptToUse = videoMotionPrompt;
      }

      console.log('=== API REQUEST ===');
      console.log('Action:', action);
      console.log('Has Image:', !!imageBase64);
      console.log('Prompt:', promptToUse);
      console.log('Trigger Word:', selectedPersona || 'None');

      const requestBody = {
        action,
        image: imageBase64,
        prompt: promptToUse,
        triggerWord: selectedPersona || undefined,
      };

      console.log('Request Payload:', JSON.stringify(requestBody, null, 2));

      const apiResponse = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      console.log('API Response Status:', apiResponse.status);
      console.log('API Response Headers:', Object.fromEntries(apiResponse.headers.entries()));

      if (!apiResponse.ok) {
        const error = await apiResponse.json();
        throw new Error(error.error || 'Failed to process request');
      }

      const data = await apiResponse.json();
      
      // Store the response for Force Display button
      setLastApiResponse(data);
      setResponse(data); // Also set the single response state
      
      // Debug: Log the entire response structure
      console.log('=== CLIENT SIDE: API RESPONSE ===');
      console.log('Full response data:', data);
      console.log('Output type:', typeof data.output);
      console.log('Is array?', Array.isArray(data.output));
      console.log('Output value:', data.output);
      
      // Check if output is empty or invalid
      const isEmptyOutput = !data.output || 
                           (typeof data.output === 'object' && Object.keys(data.output).length === 0) ||
                           (Array.isArray(data.output) && data.output.length === 0);
      
      if (isEmptyOutput) {
        console.warn('Output is empty, this means processing may not be complete yet');
        alert('AI is taking longer than expected, please try again in a moment.');
        setIsProcessing(false);
        return;
      }
      
      // Extract image URL from response using robust recursive search
      let imageUrl: string | null = null;
      
      // Priority 1: Check if output is a string URL (direct)
      if (typeof data.output === 'string') {
        const trimmed = data.output.trim();
        if (trimmed.startsWith('https://replicate.delivery/')) {
          imageUrl = trimmed;
          console.log('✓ Found replicate.delivery URL in output (string):', imageUrl);
        } else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          imageUrl = trimmed;
          console.log('✓ Found URL in output (string):', imageUrl);
        } else if (trimmed.startsWith('data:')) {
          imageUrl = trimmed;
          console.log('✓ Found base64 data URL in output');
        } else if (action === 'ad-script') {
          // Text output for ad-script
          console.log('Generated script:', data.output);
          alert(`Generated Ad Script:\n\n${data.output}`);
          setIsProcessing(false);
          return;
        }
      }
      
      // Priority 2: If output exists (object or array), search it recursively
      if (!imageUrl && data.output !== undefined && data.output !== null) {
        console.log('=== SEARCHING OUTPUT RECURSIVELY ===');
        console.log('Output structure:', JSON.stringify(data.output, null, 2).substring(0, 500));
        imageUrl = recursiveSearchForUrl(data.output);
        if (imageUrl) {
          console.log('✓ Found URL via recursive search in output:', imageUrl);
        } else {
          console.log('✗ No URL found in output after recursive search');
        }
      }
      
      // Priority 3: If still not found, search the ENTIRE data object recursively
      if (!imageUrl) {
        console.log('=== SEARCHING ENTIRE DATA OBJECT RECURSIVELY ===');
        console.log('Data structure preview:', JSON.stringify(data, null, 2).substring(0, 1000));
        imageUrl = recursiveSearchForUrl(data);
        if (imageUrl) {
          console.log('✓ Found URL via recursive search in entire data object:', imageUrl);
        } else {
          console.log('✗ No URL found in entire data object after recursive search');
        }
      }
      
      // Priority 4: Last resort - use regex to find any URL pattern in the stringified response
      if (!imageUrl) {
        console.log('=== USING REGEX FALLBACK ===');
        const responseString = JSON.stringify(data);
        // Look for any URL pattern
        const urlPattern = /https?:\/\/[^\s"',}\]]+/g;
        const matches = responseString.match(urlPattern);
        if (matches && matches.length > 0) {
          // Filter for replicate.delivery URLs first
          const replicateUrl = matches.find(url => url.includes('replicate.delivery'));
          if (replicateUrl) {
            imageUrl = replicateUrl.replace(/[",}\]]+$/, ''); // Clean trailing chars
            console.log('✓ Found URL via regex (replicate.delivery):', imageUrl);
          } else {
            imageUrl = matches[0].replace(/[",}\]]+$/, ''); // Clean trailing chars
            console.log('✓ Found URL via regex (first match):', imageUrl);
          }
        }
      }
      
      // Only say "Processing complete" when we actually have a valid URL
      if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://') || imageUrl.startsWith('data:'))) {
        console.log('=== SETTING RESULT IMAGE URL ===');
        console.log('Valid URL found:', imageUrl);
        const cleanedUrl = imageUrl.trim();
        setResultImageUrl(cleanedUrl);
        console.log('✓ Successfully set resultImageUrl state:', cleanedUrl);
        console.log('✓ Processing complete - Image should now display in AI RESULT section');
        // Don't show alert - let the image display speak for itself
      } else {
        // Log the entire response for debugging
        console.error('=== NO VALID URL FOUND ===');
        const fullResponseString = JSON.stringify(data, null, 2);
        console.error('Full stringified response:', fullResponseString);
        console.error('Output value:', data.output);
        console.error('Output type:', typeof data.output);
        
        // Show specific error message
        alert('AI is taking longer than expected, please try again in a moment.');
      }
    } catch (error: any) {
      console.error('Error processing action:', error);
      alert(`Error: ${error.message || 'Failed to process request'}`);
    } finally {
      setIsProcessing(false);
      setCurrentAction(null);
    }
  };

  // Force Display function - manually search for URL in last API response
  const handleForceDisplay = () => {
    if (!lastApiResponse) {
      alert('No API response available. Please process an image first.');
      return;
    }

    console.log('=== FORCE DISPLAY: SEARCHING FOR URL ===');
    console.log('Last API Response:', lastApiResponse);
    
    // Use the recursive search function to find URL
    const foundUrl = recursiveSearchForUrl(lastApiResponse);
    
    if (foundUrl && (foundUrl.startsWith('http://') || foundUrl.startsWith('https://') || foundUrl.startsWith('data:'))) {
      console.log('✓ Force Display found URL:', foundUrl);
      setResultImageUrl(foundUrl.trim());
      alert('Image URL found and displayed!');
    } else {
      // Try regex fallback
      const responseString = JSON.stringify(lastApiResponse);
      const urlPattern = /https?:\/\/[^\s"',}\]]+/g;
      const matches = responseString.match(urlPattern);
      
      if (matches && matches.length > 0) {
        const replicateUrl = matches.find(url => url.includes('replicate.delivery'));
        const url = replicateUrl || matches[0];
        const cleanedUrl = url.replace(/[",}\]]+$/, '');
        console.log('✓ Force Display found URL via regex:', cleanedUrl);
        setResultImageUrl(cleanedUrl);
        alert('Image URL found via regex and displayed!');
      } else {
        console.error('✗ Force Display: No URL found');
        alert(`No URL found in response.\n\nFull Response:\n${responseString}\n\nCheck console for details.`);
      }
    }
  };

  return (
    <div className="relative flex min-h-screen bg-black overflow-hidden">
      {/* Animated Gradient Background */}
      <div className="fixed inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-black via-gray-900 to-black" />
        <div className="absolute inset-0 animated-gradient-bg opacity-40" />
        <div className="video-background-overlay" />
      </div>

      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      
      <main className="relative z-10 ml-64 flex-1 p-8">
        <div className="mx-auto max-w-7xl">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-white via-[#00d9ff] to-white bg-clip-text text-transparent">
              Ultra-Premium AI Studio
            </h1>
            <p className="mt-2 text-gray-300">
              Upload your media and transform it with AI-powered tools
            </p>
          </div>

          {/* 1. TOP: Dropzone */}
          <div className="mb-8">
            <UploadZone
              onFileUpload={handleFileUpload}
              uploadedFile={uploadedFile}
            />
          </div>

          {/* 2. PROFESSIONAL TOOL CARDS - No Emojis */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { 
                id: 'remove-background', 
                label: 'Remove Background', 
                icon: <Eraser className="w-6 h-6" />, 
                action: 'remove-background' 
              },
              { 
                id: 'studio-background', 
                label: 'Studio Background', 
                icon: <ImageIcon className="w-6 h-6" />, 
                action: 'studio-background' 
              },
              { 
                id: '3d-motion', 
                label: 'Generate 3D Motion', 
                icon: <Box className="w-6 h-6" />, 
                action: '3d-motion' 
              },
              { 
                id: 'ad-script', 
                label: 'AI Ad Script', 
                icon: <FileText className="w-6 h-6" />, 
                action: 'ad-script' 
              },
            ].map((card) => (
              <button
                key={card.id}
                onClick={() => {
                  setSelectedActionType(card.label);
                  handleAction(card.action);
                }}
                disabled={isProcessing}
                className="tool-card bg-white/5 backdrop-blur-md rounded-xl p-4 text-left border border-white/10 hover:border-white/30 transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <div className="flex flex-col gap-3 relative">
                  <div className="flex items-center gap-2">
                    <div className="tool-icon" style={{ color: 'white' }}>
                      {card.icon}
                    </div>
                  </div>
                  <h3 className="text-sm font-semibold text-white">{card.label}</h3>
                </div>
              </button>
            ))}
          </div>

          {/* 3. STATIONARY NEON CHAT - Directly Below Cards */}
          <div className="relative max-w-4xl mx-auto mb-8">
            <input 
              type="text" 
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && chatInput.trim() && !isProcessing) {
                  e.preventDefault();
                  const actionMap: { [key: string]: string } = {
                    'Generate 3D Motion': '3d-motion',
                    'Professional Studio Background': 'studio-background',
                    'AI Ad Script': 'ad-script',
                    'Remove Background': 'remove-background'
                  };
                  const actionId = actionMap[selectedActionType] || '3d-motion';
                  if (actionId) {
                    // Update the appropriate prompt based on action type
                    if (selectedActionType === 'Generate 3D Motion') {
                      setVideoMotionPrompt(chatInput);
                    } else if (selectedActionType === 'Professional Studio Background') {
                      setStudioBackgroundPrompt(chatInput);
                    }
                    handleAction(actionId);
                    setChatInput(''); // Clear input after submission
                  }
                }
              }}
              placeholder="Ask AI to create something..." 
              className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-white focus:outline-none transition-all focus:border-[#00d9ff]/50 focus:ring-2 focus:ring-[#00d9ff]/20"
              style={{ boxShadow: '0 0 15px rgba(255,0,0,0.1), 0 0 15px rgba(0,0,255,0.1)' }}
              disabled={isProcessing}
            />
          </div>

          {/* Persona Selector */}
          {availablePersonas.length > 0 && (
            <div className="mb-6 glass rounded-xl p-4">
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Use Trained AI Persona (Optional)
              </label>
              <select
                value={selectedPersona}
                onChange={(e) => setSelectedPersona(e.target.value)}
                disabled={isProcessing}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-white backdrop-blur-sm focus:border-[#00d9ff]/50 focus:outline-none focus:ring-2 focus:ring-[#00d9ff]/20"
              >
                <option value="">No persona (use default)</option>
                {availablePersonas.map((persona, index) => (
                  <option key={index} value={persona}>
                    {persona}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-gray-400">
                Select a trained persona to get 100% consistent character results. 
                <Link href="/persona" className="text-[#00d9ff] hover:underline ml-1">
                  Train a new persona
                </Link>
              </p>
              {selectedPersona && (
                <p className="mt-2 text-xs text-[#00d9ff]">
                  ✓ Persona "{selectedPersona}" will be used in all prompts
                </p>
              )}
            </div>
          )}

          {/* Preview Area */}
          <div className="mb-8">
            <PreviewArea
              originalImage={originalImageUrl}
              resultImage={resultImageUrl}
              isProcessing={isProcessing}
              processingMessage={currentAction === 'studio-background' ? 'AI is reimagining your photo...' : undefined}
            />
          </div>

          {/* Force Display Button - only show if processing is done and no image is displayed */}
          {!isProcessing && !resultImageUrl && lastApiResponse && (
            <div className="mb-8 text-center">
              <button
                onClick={handleForceDisplay}
                className="rounded-lg bg-[#00d9ff]/20 px-6 py-3 text-sm font-medium text-[#00d9ff] transition-all hover:bg-[#00d9ff]/30 active:scale-95"
              >
                Show Image
              </button>
              <p className="mt-2 text-xs text-gray-500">
                If the image didn't display automatically, click to manually extract the URL
              </p>
            </div>
          )}

          {/* 4. BOTTOM: Professional AI Engine Footer Grid */}
          <div className="mt-auto mb-8">
            {/* Dynamic Section Header */}
            <div className="flex items-center justify-center gap-3 mb-6">
              <h2 className="text-sm font-medium bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                Powered by Industry-Leading AI Models
              </h2>
              <div className="relative">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" style={{ boxShadow: '0 0 8px rgba(74, 222, 128, 0.8)' }} />
                <div className="absolute inset-0 w-2 h-2 rounded-full bg-green-400 animate-ping opacity-75" />
              </div>
            </div>
            
            <div className="grid grid-cols-7 gap-4 w-full">
              {[
                { 
                  name: 'Sora', 
                  icon: <SiOpenai className="w-8 h-8" />,
                  tag: 'High-End Video',
                  brandColor: '#FF3F3F',
                  techInfo: 'Diffusion Transformer'
                },
                { 
                  name: 'Gemini', 
                  icon: <Sparkles className="w-8 h-8" strokeWidth={2.5} />,
                  tag: 'Multimodal AI',
                  brandColor: '#4285F4',
                  techInfo: 'Multimodal LLM'
                },
                { 
                  name: 'Veo', 
                  icon: <PlayCircle className="w-8 h-8" strokeWidth={2.5} />,
                  tag: 'Cinematic Video',
                  brandColor: '#FF8C00',
                  techInfo: 'Video Generation AI'
                },
                { 
                  name: 'Flux', 
                  icon: <SiFlux className="w-8 h-8" />,
                  tag: 'Image Specialist',
                  brandColor: '#7C3AED',
                  techInfo: 'Diffusion Model'
                },
                { 
                  name: 'Kling AI', 
                  icon: <Film className="w-8 h-8" strokeWidth={2.5} />,
                  tag: 'Real-to-Video',
                  brandColor: '#A855F7',
                  techInfo: 'Video Synthesis AI'
                },
                { 
                  name: 'Luma', 
                  icon: <Zap className="w-8 h-8" strokeWidth={2.5} />,
                  tag: 'Dream Machine',
                  brandColor: '#00D9FF',
                  techInfo: 'Cinematic Video AI'
                },
                { 
                  name: 'ElevenLabs', 
                  icon: <SiElevenlabs className="w-8 h-8" />,
                  tag: 'Professional Voice',
                  brandColor: '#FF6B35',
                  techInfo: 'Voice Synthesis AI'
                }
              ].map((engine) => {
                // Memoize color conversion for performance
                const hexToRgba = (hex: string, alpha: number) => {
                  const r = parseInt(hex.slice(1, 3), 16);
                  const g = parseInt(hex.slice(3, 5), 16);
                  const b = parseInt(hex.slice(5, 7), 16);
                  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
                };

                const brandGlow = hexToRgba(engine.brandColor, 0.8);
                const brandGlowSoft = hexToRgba(engine.brandColor, 0.4);

                return (
                  <div 
                    key={engine.name} 
                    className="engine-logo-card flex flex-col items-center justify-center p-4 bg-white/5 rounded-xl border-2 border-black/20 hover:scale-105 transition-all duration-300 ease-in-out cursor-pointer group overflow-hidden relative"
                    style={{
                      '--brand-color': engine.brandColor,
                      '--brand-glow': brandGlow,
                      '--brand-glow-soft': brandGlowSoft,
                    } as React.CSSProperties & { '--brand-color': string; '--brand-glow': string; '--brand-glow-soft': string }}
                  >
                    {/* LED Border Animation */}
                    <div className="led-border absolute inset-0 rounded-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    
                    {/* Info Tag - Shows on Hover */}
                    {engine.techInfo && (
                      <div className="info-tag absolute top-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
                        <div className="bg-black/80 backdrop-blur-md px-2 py-1 rounded-lg border border-white/20 text-[9px] text-white whitespace-nowrap">
                          {engine.techInfo}
                        </div>
                      </div>
                    )}
                    
                    <div
                      className="engine-icon mb-2 flex items-center justify-center transition-all duration-300 ease-in-out"
                      style={{
                        opacity: 0.7,
                      }}
                    >
                      <div style={{ color: 'white' }}>
                        {engine.icon}
                      </div>
                    </div>
                    <h4 className="text-xs font-bold text-white mb-1">{engine.name}</h4>
                    <p className="text-[10px] text-gray-400 text-center">{engine.tag}</p>
                  </div>
                );
              })}

            </div>
          </div>
        </div>
      </main>

      {/* Pricing Modal - can be triggered from sidebar or elsewhere */}
      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={() => setIsPricingModalOpen(false)}
      />
    </div>
  );
}
