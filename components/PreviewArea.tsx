'use client';

interface PreviewAreaProps {
  originalImage: string | null;
  resultImage: string | null;
  isProcessing?: boolean;
  processingMessage?: string;
}

const downloadImage = async (imageUrl: string, filename: string = 'ai-result') => {
  try {
    // Fetch the image
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    // Create a temporary URL for the blob
    const blobUrl = URL.createObjectURL(blob);
    
    // Create a temporary anchor element and trigger download
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename || 'ai-result.jpg';
    document.body.appendChild(link);
    link.click();
    
    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    window.open(imageUrl, '_blank');
  }
};

export default function PreviewArea({ originalImage, resultImage, isProcessing = false, processingMessage }: PreviewAreaProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Original */}
      <div className="glass rounded-2xl p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-400">ORIGINAL</h3>
        </div>
        <div className="flex min-h-[400px] items-center justify-center rounded-lg bg-black/30 backdrop-blur-sm">
          {originalImage ? (
            <img
              src={originalImage}
              alt="Original"
              className="max-h-[500px] max-w-full rounded-lg object-contain"
            />
          ) : (
            <div className="text-center">
              <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-[#1a1a1a] flex items-center justify-center">
                <svg
                  className="h-8 w-8 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <p className="text-sm text-gray-500">No image uploaded</p>
            </div>
          )}
        </div>
      </div>

      {/* AI Result */}
      <div className="glass rounded-2xl p-6 shadow-2xl border border-[#00d9ff]/30">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#00d9ff]">AI RESULT</h3>
          {resultImage && (
            <button
              onClick={() => downloadImage(resultImage)}
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
              Download
            </button>
          )}
        </div>
        <div className="flex min-h-[400px] items-center justify-center rounded-lg bg-black/30 backdrop-blur-sm">
          {isProcessing ? (
            <div className="text-center">
              <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-4 border-[#00d9ff]/20 border-t-[#00d9ff]"></div>
              <p className="text-sm text-[#00d9ff]">{processingMessage || 'AI is processing your image...'}</p>
              <p className="mt-1 text-xs text-gray-500">This may take a few moments</p>
            </div>
          ) : resultImage ? (
            <div className="relative w-full">
              <img
                src={resultImage}
                alt="AI Result"
                className="zoom-in max-h-[500px] max-w-full rounded-lg object-contain"
                onLoad={() => {
                  console.log('Result image loaded successfully:', resultImage);
                }}
                onError={(e) => {
                  console.error('Error loading result image:', resultImage);
                  console.error('Image URL that failed:', resultImage);
                  // Show error message instead of hiding
                  e.currentTarget.style.display = 'none';
                  const errorDiv = document.createElement('div');
                  errorDiv.className = 'text-center text-red-400 p-4';
                  errorDiv.innerHTML = '<p>Failed to load image. Check console for URL.</p>';
                  e.currentTarget.parentElement?.appendChild(errorDiv);
                }}
              />
            </div>
          ) : (
            <div className="text-center">
              <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-[#00d9ff]/10 flex items-center justify-center">
                <svg
                  className="h-8 w-8 text-[#00d9ff]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <p className="text-sm text-gray-500">AI processing result will appear here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

