import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { translate } from '@vitalets/google-translate-api';

/**
 * Translates text to English if it's not already in English
 * Ensures Replicate models receive English prompts for best results
 */
async function translateToEnglish(text: string): Promise<string> {
  try {
    if (!text || text.trim().length === 0) {
      return text;
    }

    const englishPattern = /^[a-zA-Z0-9\s.,!?'"()-]+$/;
    const isAsciiOnly = englishPattern.test(text);
    
    const commonEnglishWords = [
      'ad', 'script', 'advertisement', 'promotional', 'marketing', 'product', 'service',
      'compelling', 'engaging', 'persuasive', 'tone', 'audience', 'call', 'action',
      'professional', 'humorous', 'energetic', 'buy', 'learn', 'sign', 'up'
    ];
    
    const lowerText = text.toLowerCase();
    const hasEnglishWords = commonEnglishWords.some(word => lowerText.includes(word));
    
    if (isAsciiOnly && hasEnglishWords) {
      return text;
    }
    
    if (!isAsciiOnly || !hasEnglishWords) {
      console.log('Translating ad script prompt to English...');
      const translationPromise = translate(text, { to: 'en' });
      const timeoutPromise = new Promise<string>((_, reject) => 
        setTimeout(() => reject(new Error('Translation timeout')), 5000)
      );
      
      const result = await Promise.race([translationPromise, timeoutPromise]) as any;
      return result.text || text;
    }
    
    return text;
  } catch (error: any) {
    console.warn('Translation unavailable, using original text:', error.message);
    return text;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get API token from environment
    const apiToken = process.env.REPLICATE_API_TOKEN;
    
    // Validate token exists
    if (!apiToken || apiToken.trim() === '') {
      console.error('REPLICATE_API_TOKEN not found in environment');
      return NextResponse.json(
        {
          error: 'API token not configured',
          details: 'Please set REPLICATE_API_TOKEN in your .env.local file and restart your dev server'
        },
        { status: 500 }
      );
    }

    // Validate token format
    if (!apiToken.startsWith('r8_')) {
      return NextResponse.json(
        { error: 'Invalid API token format' },
        { status: 500 }
      );
    }

    // Initialize Replicate client
    const replicate = new Replicate({
      auth: apiToken.trim(),
    });

    const { prompt, context } = await request.json();

    if (!prompt || !prompt.trim()) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    // Translate prompt to English
    let translatedPrompt = prompt;
    console.log('Original prompt (any language):', translatedPrompt);
    translatedPrompt = await translateToEnglish(translatedPrompt);
    console.log('Translated prompt (English):', translatedPrompt);

    // Build enhanced prompt with context
    let enhancedPrompt = translatedPrompt;

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
        enhancedPrompt = `${translatedPrompt}\n\nAdditional instructions: ${contextInstructions.join('. ')}.`;
      }
    }

    console.log('Enhanced prompt with context:', enhancedPrompt);

    // Use Llama 3.1 8B Instruct model for text generation
    const model = 'meta/llama-3.1-8b-instruct:af1c688b4a10d836358128ace4b7821950d6cbcd3d4532511146196b3b7c5c2b';

    // Build the prompt for the LLM
    // Llama 3.1 Instruct models use a simpler prompt format
    const fullPrompt = `You are an expert copywriter specializing in creating compelling, persuasive ad scripts.

Create an engaging ad script based on the following description and requirements:

${enhancedPrompt}

Make sure the script is clear, persuasive, and includes all necessary elements like hooks, benefits, and call-to-action. Format the script in a way that's ready to use for voice-over or video production.`;

    console.log('Full prompt for ad script:', fullPrompt);

    // Create prediction
    const prediction = await replicate.predictions.create({
      version: model,
      input: {
        prompt: fullPrompt,
        max_tokens: 1000,
        temperature: 0.7,
      },
    });

    console.log('Ad script generation started, ID:', prediction.id);

    // Poll for completion
    let result: any = null;
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max (5 second intervals)

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      result = await replicate.predictions.get(prediction.id);

      if (result.status === 'succeeded' && result.output) {
        break;
      }
      if (result.status === 'failed' || result.status === 'canceled') {
        throw new Error(`Ad script generation failed: ${result.error || 'Unknown error'}`);
      }
      attempts++;
    }

    if (!result || result.status !== 'succeeded' || !result.output) {
      throw new Error('Failed to generate ad script: timeout or no output');
    }

    // Extract script from output
    // The output might be an array of strings or a single string
    let script = '';
    if (Array.isArray(result.output)) {
      script = result.output.join('\n');
    } else if (typeof result.output === 'string') {
      script = result.output;
    } else {
      script = JSON.stringify(result.output);
    }

    // Clean up the script (remove any LLM formatting artifacts)
    script = script.trim();
    
    // Remove common LLM response markers if present
    script = script.replace(/^<\|start_header_id\|>assistant<\|end_header_id\|>\n\n/, '');
    script = script.replace(/<\|eot_id\|>.*$/, '');
    script = script.trim();

    console.log('Ad script generated successfully');
    console.log('Script length:', script.length, 'characters');

    return NextResponse.json({
      script: script,
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
