'use client';

import { useCallback, useState } from 'react';

interface UploadZoneProps {
  onFileUpload: (file: File) => void;
  uploadedFile: File | null;
}

export default function UploadZone({ onFileUpload, uploadedFile }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    const imageFile = files.find(file => file.type.startsWith('image/'));
    if (imageFile) {
      onFileUpload(imageFile);
    }
  }, [onFileUpload]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFileUpload(files[0]);
    }
  }, [onFileUpload]);

  return (
    <div
      className={`animated-border ${isDragging ? 'scale-[1.02]' : ''} transition-transform duration-300`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="animated-border-content">
      <input
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
        id="file-upload"
      />
      
      <label
        htmlFor="file-upload"
        className="flex min-h-[300px] cursor-pointer flex-col items-center justify-center gap-4 p-8"
      >
        {uploadedFile ? (
          <div className="flex flex-col items-center gap-4">
            <div className="relative h-32 w-32 overflow-hidden rounded-lg">
              <img
                src={URL.createObjectURL(uploadedFile)}
                alt="Uploaded"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-white">{uploadedFile.name}</p>
              <p className="mt-1 text-xs text-gray-400">
                {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <p className="text-xs text-gray-500">Click to upload a different image</p>
          </div>
        ) : (
          <>
            <div className="rounded-full bg-[#1a1a1a] p-6">
              <svg
                className="h-12 w-12 text-[#00d9ff]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-lg font-medium text-white">
                Drag & Drop your image here
              </p>
              <p className="mt-2 text-sm text-gray-400">or click to browse</p>
            </div>
          </>
        )}
      </label>
      </div>
    </div>
  );
}

