import { NextRequest, NextResponse } from 'next/server';
import { createGeminiModel, getGeminiModelId, resolveGeminiModelId } from '@/lib/gemini';

const GEMINI_SYSTEM_PROMPT = `You are an expert AI Video Director. Your goal is to transform a short user idea into a production-ready asset package.
1. Analyze the user's input.
2. If the input is a simple action (e.g., 'walking on beach'), invent a short, engaging, 1st-person inner monologue (max 2 sentences) for the 'script'.
3. Create a 'visual_prompt' that describes the scene cinematically. ALWAYS include the placeholder '{TRIGGER_WORD}' in the visual description. Add keywords like '4k, photorealistic, cinematic lighting, shallow depth of field'.
4. Output MUST be a valid JSON object strictly following this structure:
{
  "script": "string",
  "visual_prompt": "string"
}
DO NOT add any conversational text, markdown, or explanations. Just the JSON.`;

const geminiModelId = resolveGeminiModelId(
  process.env.GEMINI_AD_MODEL_ID || process.env.GEMINI_MODEL_ID,
  'gemini-3-pro-preview'
);

export async function POST(request: NextRequest) {
  try {
    // Get API key from environment
    const apiKey = process.env.GEMINI_API_KEY;
    
    // Validate token exists
    if (!apiKey || apiKey.trim() === '') {
      console.error('GEMINI_API_KEY not found in environment');
      return NextResponse.json(
        {
          error: 'API token not configured',
          details: 'Please set GEMINI_API_KEY in your .env.local file and restart your dev server'
        },
        { status: 500 }
      );
    }

    // Initialize Gemini
    const resolvedModelId = await getGeminiModelId(apiKey, geminiModelId);
    const model = createGeminiModel(apiKey, resolvedModelId);

    const { prompt, context } = await request.json();

    if (!prompt || !prompt.trim()) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    // Build enhanced prompt with context
    let enhancedPrompt = prompt;

    // Add contextual information to the prompt if provided
    if (context) {
      const contextInstructions: string[] = [];

      if (context.tone && context.tone.trim()) {
        contextInstructions.push(`Use a ${context.tone} tone`);
      }

      if (context.targetAudience && context.targetAudience.trim()) {
        contextInstructions.push(`Target audience: ${context.targetAudience}`);
      }

      if (context.callToAction && context.callToAction.trim()) {
        contextInstructions.push(`Include a clear call-to-action: "${context.callToAction}"`);
      }

      if (context.length) {
        const lengthMap: Record<string, string> = {
          'short': '15-30 seconds',
          'medium': '30-60 seconds',
          'long': '60+ seconds',
        };
        contextInstructions.push(`Length: ${lengthMap[context.length] || '30-60 seconds'}`);
      }

      if (context.style && context.style.trim()) {
        contextInstructions.push(`Style: ${context.style}`);
      }

      if (contextInstructions.length > 0) {
        enhancedPrompt = `${prompt}\n\nAdditional instructions: ${contextInstructions.join('. ')}.`;
      }
    }

    // Build the full prompt for Gemini
    const fullPrompt = `${GEMINI_SYSTEM_PROMPT}

You are an expert copywriter specializing in creating compelling, persuasive ad scripts for marketing and advertising.

Create an engaging, high-converting ad script based on the following description and requirements:

${enhancedPrompt}

Make sure the script is:
- Clear and persuasive
- Includes a strong hook to grab attention
- Highlights key benefits and features
- Includes a clear call-to-action
- Optimized for voice-over or video production
- Ready to use immediately

Format the script in a way that's ready to use for voice-over or video production.`;

    console.log('Generating ad script with Gemini 1.5 Pro...');

    // Generate content with Gemini
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const script = response.text();

    console.log('Ad script generated successfully');
    console.log('Script length:', script.length, 'characters');

    return NextResponse.json({
      script: script.trim(),
      status: 'succeeded',
    });

  } catch (error: any) {
    console.error('Ad script generation error:', error);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to generate ad script',
        details: error.toString()
      },
      { status: 500 }
    );
  }
}
