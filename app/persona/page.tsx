'use client';

import { useState, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import JSZip from 'jszip';
import { Sparkles, Camera, Target, Mic, Lock } from 'lucide-react';
import { usePersona } from '@/hooks/usePersona';
import { canTrainVisualPersona, canTrainVoicePersona } from '@/lib/subscription';

export default function PersonaPage() {
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState<number>(0);
  const [trainingStatus, setTrainingStatus] = useState<string>('');
  const [triggerWord, setTriggerWord] = useState<string>('');
  const [trainingId, setTrainingId] = useState<string>('');
  const [isTrainingComplete, setIsTrainingComplete] = useState(false);
  const [completedModelId, setCompletedModelId] = useState<string | null>(null);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);
  const { user, persona, requestVisualPersona, requestVoicePersona, setVisualStatus, setVoiceStatus } = usePersona();
  const canTrainVisual = canTrainVisualPersona(user);
  const canTrainVoice = canTrainVoicePersona(user);
  const visualStatus = persona?.visualStatus ?? 'none';
  const voiceStatus = persona?.voiceStatus ?? 'none';
  const [voiceFiles, setVoiceFiles] = useState<File[]>([]);
  const [voiceDurationSec, setVoiceDurationSec] = useState<number>(0);
  const [isVoiceTraining, setIsVoiceTraining] = useState(false);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const calculateTotalDuration = async (files: File[]): Promise<number> => {
    const durations = await Promise.all(files.map(file => {
      return new Promise<number>((resolve) => {
        const audio = new Audio();
        audio.src = URL.createObjectURL(file);
        audio.addEventListener('loadedmetadata', () => {
          const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
          URL.revokeObjectURL(audio.src);
          resolve(duration);
        });
        audio.addEventListener('error', () => {
          URL.revokeObjectURL(audio.src);
          resolve(0);
        });
      });
    }));
    return durations.reduce((sum, duration) => sum + duration, 0);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canTrainVisual) {
      setIsPricingModalOpen(true);
      alert('Premium plan required to upload photos for persona training.');
      return;
    }
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length + uploadedFiles.length > 20) {
      alert('Maximum 20 images allowed. Please select fewer images.');
      return;
    }
    
    setUploadedFiles(prev => [...prev, ...imageFiles]);
  };

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canTrainVisual) {
      setIsPricingModalOpen(true);
      alert('Premium plan required to upload photos for persona training.');
      return;
    }
    const file = e.target.files?.[0];
    if (!file || !file.name.endsWith('.zip')) {
      alert('Please upload a ZIP file');
      return;
    }

    try {
      const zip = new JSZip();
      const zipData = await zip.loadAsync(file);
      
      const imageFiles: File[] = [];
      let imageCount = 0;

      // Extract images from ZIP
      for (const [filename, zipEntry] of Object.entries(zipData.files)) {
        if (!zipEntry.dir && /\.(jpg|jpeg|png|webp)$/i.test(filename)) {
          if (imageCount >= 20) {
            alert('Maximum 20 images allowed. Only the first 20 will be used.');
            break;
          }
          
          const blob = await zipEntry.async('blob');
          const file = new File([blob], filename, { type: blob.type });
          imageFiles.push(file);
          imageCount++;
        }
      }

      if (imageFiles.length < 20) {
        alert(`ZIP file contains only ${imageFiles.length} images. Exactly 20 images are required.`);
        return;
      }

      setUploadedFiles(imageFiles);
      alert(`Successfully extracted ${imageFiles.length} images from ZIP file.`);
    } catch (error) {
      console.error('ZIP extraction error:', error);
      alert('Failed to extract images from ZIP file. Please try again.');
    }
  };

  const handleVoiceSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canTrainVoice) {
      setIsPricingModalOpen(true);
      alert('Premium plan required to upload voice samples.');
      return;
    }
    const files = Array.from(e.target.files || []);
    const audioFiles = files.filter(file => file.type.startsWith('audio/'));
    if (audioFiles.length === 0) {
      alert('Please upload audio files for voice samples.');
      return;
    }
    setVoiceFiles(audioFiles);
    const totalDuration = await calculateTotalDuration(audioFiles);
    setVoiceDurationSec(totalDuration);
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const generateTriggerWord = (): string => {
    // Generate a unique trigger word for this user
    const adjectives = ['cool', 'epic', 'amazing', 'stellar', 'radiant', 'mystic', 'noble', 'brave'];
    const nouns = ['hero', 'legend', 'star', 'champion', 'warrior', 'sage', 'guardian', 'spirit'];
    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomNum = Math.floor(Math.random() * 1000);
    return `${randomAdj}${randomNoun}${randomNum}`;
  };

  const createZipFromFiles = async (files: File[]): Promise<Blob> => {
    const zip = new JSZip();
    
    console.log(`Creating ZIP file from ${files.length} images...`);
    
    // Add all image files to ZIP with proper naming
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const arrayBuffer = await file.arrayBuffer();
        // Use a simple, clean naming scheme: image_001.jpg, image_002.jpg, etc.
        // This ensures compatibility with fast-flux-trainer
        const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const filename = `image_${String(i + 1).padStart(3, '0')}.${extension}`;
        zip.file(filename, arrayBuffer);
        console.log(`Added ${filename} to ZIP`);
      } catch (error) {
        console.error(`Failed to add file ${file.name} to ZIP:`, error);
        throw new Error(`Failed to process image ${i + 1}: ${file.name}`);
      }
    }

    // Generate ZIP file with compression
    console.log('Generating ZIP file...');
    const zipBlob = await zip.generateAsync({ 
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 } // Balanced compression
    });
    
    console.log(`ZIP file created successfully (${(zipBlob.size / 1024 / 1024).toFixed(2)} MB)`);
    return zipBlob;
  };

  const startTraining = async () => {
    if (!canTrainVisual) {
      setIsPricingModalOpen(true);
      alert('Premium plan required to create or train personas.');
      return;
    }

    if (uploadedFiles.length < 20) {
      alert('Please upload exactly 20 images to train your AI persona');
      return;
    }

    if (uploadedFiles.length > 20) {
      alert('Maximum 20 images allowed');
      return;
    }

    const personaRequest = requestVisualPersona(uploadedFiles.length);
    if (!personaRequest.ok) {
      if (personaRequest.reason === 'premium_required') {
        setIsPricingModalOpen(true);
        alert('Premium plan required to create or train personas.');
      } else if (personaRequest.reason === 'requires_20_photos') {
        alert('Please upload exactly 20 images to train your AI persona');
      }
      return;
    }

    setIsTraining(true);
    setTrainingProgress(0);
    setTrainingStatus('Preparing training data...');
    const newTriggerWord = generateTriggerWord();
    setTriggerWord(newTriggerWord);
    const personaId = personaRequest.personaId ?? persona?.id;

    try {
      setTrainingStatus(`Creating ZIP file from ${uploadedFiles.length} images...`);
      setTrainingProgress(10);

      // Automatically create ZIP file from uploaded images (invisible to user)
      // This provides a premium, seamless experience
      const zipBlob = await createZipFromFiles(uploadedFiles);
      
      setTrainingStatus('Preparing ZIP for upload...');
      setTrainingProgress(15);
      
      // Convert ZIP to base64 data URL for API transmission
      // This format is compatible with Replicate's fast-flux-trainer
      const zipBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(zipBlob);
        reader.onload = () => {
          const result = reader.result as string;
          console.log('ZIP converted to base64, size:', result.length, 'characters');
          resolve(result);
        };
        reader.onerror = (error) => {
          console.error('Failed to convert ZIP to base64:', error);
          reject(new Error('Failed to prepare ZIP file for upload'));
        };
      });

      setTrainingStatus('Uploading ZIP to training service...');
      setTrainingProgress(20);

      // Call training API with ZIP file
      const response = await fetch('/api/train-persona', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          zipFile: zipBase64,
          triggerWord: newTriggerWord,
          imageCount: uploadedFiles.length,
          user,
          personaId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Training failed');
      }

      const data = await response.json();
      setTrainingId(data.trainingId);
      setTrainingStatus('Training started! Monitoring progress...');
      setTrainingProgress(40);

      // Poll for training status
      pollTrainingStatus(data.trainingId);

    } catch (error: any) {
      console.error('Training error:', error);
      alert(`Training failed: ${error.message}`);
      setIsTraining(false);
      setTrainingProgress(0);
      setTrainingStatus('');
    }
  };

  const startVoiceTraining = async () => {
    if (!canTrainVoice) {
      setIsPricingModalOpen(true);
      alert('Premium plan required to train voice personas.');
      return;
    }
    if (voiceDurationSec < 120 || voiceDurationSec > 300) {
      alert('Please upload 2–5 minutes of voice samples total.');
      return;
    }
    const voiceRequest = requestVoicePersona(voiceDurationSec);
    if (!voiceRequest.ok) {
      if (voiceRequest.reason === 'premium_required') {
        setIsPricingModalOpen(true);
        alert('Premium plan required to train voice personas.');
      } else if (voiceRequest.reason === 'requires_voice_samples') {
        alert('Please upload 2–5 minutes of voice samples total.');
      }
      return;
    }
    setIsVoiceTraining(true);
    setVoiceStatus('training');
    setTimeout(() => {
      setIsVoiceTraining(false);
      setVoiceStatus('ready');
      const personaId = voiceRequest.personaId ?? persona?.id;
      if (personaId) {
        fetch('/api/save-voice-persona', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personaId,
            user,
            voiceStatus: 'ready',
          }),
        }).catch((error) => {
          console.error('Failed to save voice persona status:', error);
        });
      }
    }, 3000);
  };

  const pollTrainingStatus = async (id: string) => {
    const maxAttempts = 120; // 10 minutes max (5 second intervals)
    let attempts = 0;

    const poll = async () => {
      try {
        const response = await fetch(`/api/train-persona/status?id=${id}`);
        const data = await response.json();

        if (data.status === 'succeeded') {
          setTrainingProgress(100);
          setTrainingStatus('Training complete! Your AI persona is ready.');
          setIsTraining(false);
          setVisualStatus('ready');
          
          // Get model ID from status response
          const modelId = data.modelId || data.output || null;
          setCompletedModelId(modelId);
          setIsTrainingComplete(true);
          
          // Save persona data to database (localStorage for now, can be replaced with API)
          if (typeof window !== 'undefined' && triggerWord) {
            const personaData = {
              personaId: persona?.id,
              triggerWord: triggerWord,
              modelId: modelId, // Model ID from training output
              trainingId: id, // Use the polling ID
              createdAt: new Date().toISOString(),
              imageCount: uploadedFiles.length,
            };

            // Save to localStorage
            const saved = localStorage.getItem('trainedPersonasData');
            const personas = saved ? JSON.parse(saved) : [];
            personas.push(personaData);
            localStorage.setItem('trainedPersonasData', JSON.stringify(personas));

            // Also save trigger words list for quick access
            const savedWords = localStorage.getItem('triggerWords');
            const words = savedWords ? JSON.parse(savedWords) : [];
            if (!words.includes(triggerWord)) {
              words.push(triggerWord);
              localStorage.setItem('triggerWords', JSON.stringify(words));
            }

            // Save to trainedPersonas for dropdown
            const savedPersonasList = localStorage.getItem('trainedPersonas');
            const personasList = savedPersonasList ? JSON.parse(savedPersonasList) : [];
            if (!personasList.includes(triggerWord)) {
              personasList.push(triggerWord);
              localStorage.setItem('trainedPersonas', JSON.stringify(personasList));
            }

            // Also save to server/database via API
            // Only save if we have a modelId (might be null initially)
            if (modelId) {
              try {
                const saveResponse = await fetch('/api/save-persona', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ persona: personaData, user }),
                });
                
                if (saveResponse.ok) {
                  console.log('✓ Persona saved to database successfully');
                } else {
                  console.warn('Failed to save persona to database, but localStorage backup is in place');
                }
              } catch (error) {
                console.error('Failed to save persona to database:', error);
                // Continue anyway - localStorage backup is in place
              }
            } else {
              console.warn('Model ID not available yet, will retry saving later');
              // Could implement a retry mechanism here if needed
            }
          }
          return;
        }

        if (data.status === 'failed') {
          throw new Error(data.error || 'Training failed');
        }

        // Update progress based on status
        if (data.progress) {
          setTrainingProgress(40 + (data.progress * 0.6)); // 40-100% range
        }

        setTrainingStatus(data.statusMessage || 'Training in progress...');

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000); // Poll every 5 seconds
        } else {
          throw new Error('Training timeout');
        }
      } catch (error: any) {
        console.error('Polling error:', error);
        setTrainingStatus(`Error: ${error.message}`);
        setIsTraining(false);
        setVisualStatus('none');
      }
    };

    poll();
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
            <div className="flex items-center gap-3 mb-2">
              <Sparkles className="w-8 h-8 text-[#00d9ff]" style={{ filter: 'drop-shadow(0 0 8px #00d9ff)' }} />
              <h1 className="text-4xl font-bold text-white">
                <span className="bg-gradient-to-r from-[#00d9ff] via-[#0099cc] to-[#00d9ff] bg-clip-text text-transparent">
                  AI Persona Lab
                </span>
              </h1>
              <span className="px-3 py-1 text-xs font-semibold bg-gradient-to-r from-yellow-500 to-orange-500 text-black rounded-full">
                PREMIUM
              </span>
            </div>
            <p className="text-gray-300 text-base mb-2">
              One persona, trained once, used across every tool.
            </p>
            <p className="text-gray-400 text-lg">
              Train your custom AI model. Upload exactly 20 high-quality images to create your digital twin. Use your unique trigger word to generate consistent personas in all your creations.
            </p>
          </div>

          {/* Visual Persona Training */}
          <div className="glass rounded-2xl p-8 mb-8">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-2xl font-semibold text-white mb-2">Visual Persona Training</h2>
                <p className="text-gray-400">
                  Upload exactly 20 high-quality images of yourself or the subject you want to train.
                  Use clear, well-lit photos from different angles for best results.
                </p>
              </div>
              <span className="px-3 py-1 text-xs font-semibold rounded-full bg-white/10 text-white">
                Status: {visualStatus}
              </span>
            </div>

            {!canTrainVisual && (
              <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-6 text-center mb-6">
                <div className="flex items-center justify-center gap-2 text-yellow-300 mb-3">
                  <Lock className="w-4 h-4" />
                  <span>Premium required for visual persona training.</span>
                </div>
                <button
                  onClick={() => setIsPricingModalOpen(true)}
                  className="px-6 py-3 rounded-lg bg-gradient-to-r from-[#00d9ff] to-[#0099cc] text-white font-semibold hover:from-[#00d9ff]/90 hover:to-[#0099cc]/90 transition-all"
                >
                  Upgrade to Premium
                </button>
              </div>
            )}
            <p className="text-sm text-[#00d9ff] mb-6 flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> ZIP file will be created automatically - just select your images and click "Train My AI Persona"
            </p>

            {/* File Upload Buttons */}
            <div className="flex gap-4 mb-6">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isTraining || !canTrainVisual}
                className="interactive-element glass rounded-lg px-6 py-3 text-white font-medium hover:bg-[#00d9ff]/10 border border-[#00d9ff]/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Camera className="w-4 h-4" /> Upload Images (Multiple)
              </button>

              <input
                ref={zipInputRef}
                type="file"
                accept=".zip"
                onChange={handleZipUpload}
                className="hidden"
              />
              <button
                onClick={() => zipInputRef.current?.click()}
                disabled={isTraining || !canTrainVisual}
                className="glass rounded-lg px-6 py-3 text-white font-medium hover:bg-[#00d9ff]/10 border border-[#00d9ff]/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                📦 Upload ZIP File
              </button>
            </div>

            {!canTrainVisual && (
              <p className="text-sm text-yellow-300 mb-4">
                Visual uploads are visible but disabled on the free plan.
              </p>
            )}

            {/* Uploaded Files List */}
            {uploadedFiles.length > 0 && (
              <div className="mb-6">
                <p className="text-sm text-gray-400 mb-3">
                  {uploadedFiles.length} / 20 images uploaded
                </p>
                <div className="grid grid-cols-5 gap-4">
                  {uploadedFiles.map((file, index) => (
                    <div key={index} className="relative group">
                      <img
                        src={URL.createObjectURL(file)}
                        alt={`Upload ${index + 1}`}
                        className="w-full h-32 object-cover rounded-lg"
                      />
                      {!isTraining && (
                        <button
                          onClick={() => removeFile(index)}
                          className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Training Button */}
            <button
              onClick={startTraining}
              disabled={isTraining || uploadedFiles.length < 20 || !canTrainVisual}
              className="w-full glass rounded-lg px-6 py-4 text-white font-semibold bg-gradient-to-r from-[#00d9ff] to-[#0099cc] hover:from-[#00d9ff]/90 hover:to-[#0099cc]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isTraining ? 'Training in Progress...' : '🚀 Train My AI Persona'}
            </button>

            {uploadedFiles.length < 20 && uploadedFiles.length > 0 && (
              <p className="mt-4 text-sm text-yellow-400 text-center">
                Upload {20 - uploadedFiles.length} more image(s) to reach 20
              </p>
            )}
          </div>

          {/* Voice Persona Training */}
          <div className="glass rounded-2xl p-8 mb-8">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-2xl font-semibold text-white mb-2">Voice Persona Training</h2>
                <p className="text-gray-400">
                  Upload voice samples totaling 2–5 minutes. Clear audio with varied tones works best.
                </p>
                <p className="text-gray-500 text-sm mt-2">
                  Voice personas power AI voiceovers in scripts and ads.
                </p>
              </div>
              <span className="px-3 py-1 text-xs font-semibold rounded-full bg-white/10 text-white">
                Status: {voiceStatus}
              </span>
            </div>

            {!canTrainVoice && (
              <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-6 text-center mb-6">
                <div className="flex items-center justify-center gap-2 text-yellow-300 mb-3">
                  <Lock className="w-4 h-4" />
                  <span>Premium required for voice persona training.</span>
                </div>
                <button
                  onClick={() => setIsPricingModalOpen(true)}
                  className="px-6 py-3 rounded-lg bg-gradient-to-r from-[#00d9ff] to-[#0099cc] text-white font-semibold hover:from-[#00d9ff]/90 hover:to-[#0099cc]/90 transition-all"
                >
                  Upgrade to Premium
                </button>
              </div>
            )}
            <div className="flex gap-4 mb-6">
              <input
                ref={voiceInputRef}
                type="file"
                accept="audio/*"
                multiple
                onChange={handleVoiceSelect}
                className="hidden"
              />
              <button
                onClick={() => voiceInputRef.current?.click()}
                disabled={isVoiceTraining || !canTrainVoice}
                className="interactive-element glass rounded-lg px-6 py-3 text-white font-medium hover:bg-[#00d9ff]/10 border border-[#00d9ff]/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Mic className="w-4 h-4" /> Upload Voice Samples
              </button>
              {voiceFiles.length > 0 && (
                <button
                  onClick={() => {
                    setVoiceFiles([]);
                    setVoiceDurationSec(0);
                  }}
                  className="glass rounded-lg px-6 py-3 text-white font-medium hover:bg-white/5 border border-white/10 transition-all"
                >
                  Clear Samples
                </button>
              )}
            </div>

            {!canTrainVoice && (
              <p className="text-sm text-yellow-300 mb-4">
                Voice uploads are visible but disabled on the free plan.
              </p>
            )}

            {voiceFiles.length > 0 && (
              <div className="mb-4 text-sm text-gray-300">
                Total duration: <span className="text-white font-semibold">{formatDuration(voiceDurationSec)}</span>
              </div>
            )}
            {voiceDurationSec > 0 && (voiceDurationSec < 120 || voiceDurationSec > 300) && (
              <p className="text-sm text-yellow-400 mb-4">
                Voice samples must total between 2–5 minutes.
              </p>
            )}

            <button
              onClick={startVoiceTraining}
              disabled={isVoiceTraining || voiceDurationSec < 120 || voiceDurationSec > 300 || !canTrainVoice}
              className="w-full glass rounded-lg px-6 py-4 text-white font-semibold bg-gradient-to-r from-[#00d9ff] to-[#0099cc] hover:from-[#00d9ff]/90 hover:to-[#0099cc]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isVoiceTraining ? 'Training in Progress...' : '🎙️ Train My Voice Persona'}
            </button>
          </div>

          {/* Cinematic Training Progress Screen */}
          {isTraining && (
            <div className="relative glass rounded-2xl p-8 mb-8 overflow-hidden">
              {/* Animated background effect */}
              <div className="absolute inset-0 opacity-20">
                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-[#00d9ff]/20 via-transparent to-[#0099cc]/20 animate-pulse" />
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#00d9ff]/10 rounded-full blur-3xl animate-ping" style={{ animationDuration: '3s' }} />
              </div>

              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="relative">
                    <div className="absolute inset-0 bg-[#00d9ff] rounded-full blur-xl opacity-50 animate-pulse" />
                    <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-[#00d9ff] to-[#0099cc] flex items-center justify-center">
                      <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">Training Your AI Persona</h2>
                    <p className="text-sm text-gray-400">Creating your unique digital twin...</p>
                  </div>
                </div>

                {triggerWord && (
                  <div className="mb-6 p-5 bg-gradient-to-r from-[#00d9ff]/20 to-[#0099cc]/20 rounded-xl border-2 border-[#00d9ff]/50">
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="w-5 h-5 text-[#00d9ff]" style={{ filter: 'drop-shadow(0 0 6px #00d9ff)' }} />
                      <p className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Your Unique Trigger Word</p>
                    </div>
                    <div className="bg-black/50 rounded-lg p-4 border border-[#00d9ff]/30">
                      <p className="text-3xl font-mono font-bold text-[#00d9ff] text-center mb-2 tracking-wider">
                        {triggerWord}
                      </p>
                      <p className="text-xs text-gray-400 text-center">
                        Use this word in any prompt to activate your persona: "{triggerWord} walking in a park"
                      </p>
                    </div>
                  </div>
                )}

                {/* Progress Bar with Animation */}
                <div className="mb-6">
                  <div className="flex justify-between items-center text-sm mb-3">
                    <span className="text-gray-300 font-medium">{trainingStatus}</span>
                    <span className="text-[#00d9ff] font-bold text-lg">{Math.round(trainingProgress)}%</span>
                  </div>
                  <div className="relative w-full bg-gray-800/50 rounded-full h-6 overflow-hidden border border-gray-700">
                    {/* Animated gradient bar */}
                    <div
                      className="relative h-full bg-gradient-to-r from-[#00d9ff] via-[#0099cc] to-[#00d9ff] transition-all duration-700 ease-out shadow-lg"
                      style={{ width: `${trainingProgress}%` }}
                    >
                      {/* Shimmer effect */}
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                    </div>
                    {/* Progress glow */}
                    <div
                      className="absolute top-0 h-full bg-[#00d9ff]/50 blur-md transition-all duration-700"
                      style={{ width: `${trainingProgress}%` }}
                    />
                  </div>
                  
                  {/* Step indicators */}
                  <div className="flex justify-between mt-4 text-xs text-gray-500">
                    <span className={trainingProgress > 10 ? 'text-[#00d9ff]' : ''}>✓ Preparing</span>
                    <span className={trainingProgress > 30 ? 'text-[#00d9ff]' : ''}>✓ Uploading</span>
                    <span className={trainingProgress > 50 ? 'text-[#00d9ff]' : ''}>✓ Training</span>
                    <span className={trainingProgress > 90 ? 'text-[#00d9ff]' : ''}>✓ Finalizing</span>
                  </div>
                </div>

                {/* Estimated time */}
                <div className="flex items-center justify-center gap-2 text-sm text-gray-400 mb-4">
                  <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Estimated time: {Math.max(1, Math.ceil((100 - trainingProgress) / 10))} minutes remaining</span>
                </div>

                {trainingId && (
                  <div className="text-center">
                    <p className="text-xs text-gray-500">
                      Training ID: <span className="font-mono text-gray-400">{trainingId.substring(0, 8)}...</span>
                    </p>
                  </div>
                )}

                {/* Floating particles effect */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
                  {[...Array(20)].map((_, i) => (
                    <div
                      key={i}
                      className="absolute w-1 h-1 bg-[#00d9ff] rounded-full opacity-20"
                      style={{
                        left: `${Math.random() * 100}%`,
                        top: `${Math.random() * 100}%`,
                        animation: `float ${3 + Math.random() * 4}s ease-in-out infinite`,
                        animationDelay: `${Math.random() * 2}s`,
                      }}
                    />
                  ))}
                </div>
              </div>

              <style jsx>{`
                @keyframes shimmer {
                  0% { transform: translateX(-100%); }
                  100% { transform: translateX(100%); }
                }
                @keyframes float {
                  0%, 100% { transform: translateY(0) translateX(0); opacity: 0.2; }
                  50% { transform: translateY(-20px) translateX(10px); opacity: 0.5; }
                }
                .animate-shimmer {
                  animation: shimmer 2s infinite;
                }
              `}</style>
            </div>
          )}

          {/* Success Screen */}
          {isTrainingComplete && triggerWord && (
            <div className="glass rounded-2xl p-8 mb-8 border-2 border-[#00d9ff]/50 bg-gradient-to-br from-[#00d9ff]/10 to-transparent">
              <div className="text-center">
                <div className="mb-6">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-[#00d9ff] to-[#0099cc] mb-4 animate-bounce">
                    <span className="text-4xl">✓</span>
                  </div>
                  <h2 className="text-3xl font-bold text-white mb-2">Training Complete!</h2>
                  <p className="text-gray-400">Your AI persona is ready to use</p>
                </div>

                <div className="bg-black/50 rounded-xl p-6 mb-6 border border-[#00d9ff]/30">
                  <p className="text-sm text-gray-400 mb-2 uppercase tracking-wide">Your Trigger Word</p>
                  <p className="text-4xl font-mono font-bold text-[#00d9ff] mb-4">{triggerWord}</p>
                  <p className="text-sm text-gray-300 mb-4">
                    Use this word in any prompt to activate your persona
                  </p>
                  <div className="bg-gray-900 rounded-lg p-4 text-left">
                    <p className="text-xs text-gray-500 mb-1">Example:</p>
                    <p className="text-sm font-mono text-[#00d9ff]">
                      "{triggerWord} walking in a park, cinematic, high quality"
                    </p>
                  </div>
                </div>

                {completedModelId && (
                  <div className="mb-6 p-4 bg-gray-800/50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Model ID:</p>
                    <p className="text-xs font-mono text-gray-400 break-all">{completedModelId}</p>
                  </div>
                )}

                <div className="flex gap-4 justify-center">
                  <Link
                    href="/"
                    className="px-6 py-3 bg-gradient-to-r from-[#00d9ff] to-[#0099cc] text-white font-semibold rounded-lg hover:from-[#00d9ff]/90 hover:to-[#0099cc]/90 transition-all"
                  >
                    🎬 Start Creating with Your Persona
                  </Link>
                  <button
                    onClick={() => {
                      setIsTrainingComplete(false);
                      setUploadedFiles([]);
                      setTriggerWord('');
                      setTrainingProgress(0);
                      setTrainingStatus('');
                      setCompletedModelId(null);
                    }}
                    className="px-6 py-3 glass text-white font-semibold rounded-lg hover:bg-[#00d9ff]/10 transition-all border border-white/10"
                  >
                    Train Another Persona
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Info Section - Only show when training is not complete */}
          {!isTrainingComplete && (
            <div className="glass rounded-2xl p-8">
              <h2 className="text-2xl font-semibold text-white mb-4">How It Works</h2>
              <div className="space-y-4 text-gray-400">
                <div className="flex gap-4">
                  <span className="text-2xl">1️⃣</span>
                  <div>
                    <h3 className="text-white font-medium mb-1">Upload Images</h3>
                    <p>Upload exactly 20 high-quality images. More variety = better results.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <span className="text-2xl">2️⃣</span>
                  <div>
                    <h3 className="text-white font-medium mb-1">Training</h3>
                    <p>Our AI trains a custom model based on your images. This takes 5-10 minutes.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <span className="text-2xl">3️⃣</span>
                  <div>
                    <h3 className="text-white font-medium mb-1">Use Your Persona</h3>
                    <p>Use your unique trigger word in prompts to generate images with your persona.</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={() => setIsPricingModalOpen(false)}
      />
    </div>
  );
}
