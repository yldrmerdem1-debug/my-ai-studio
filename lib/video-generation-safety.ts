export const isSensitiveFlag = (error: any) => {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('flagged as sensitive') || message.includes('e005') || message.includes('sensitive');
};

export const softenVeoPrompt = (prompt: string, level: 1 | 2 | 3) => {
  let softened = prompt;
  const safetyTail = ' no blood, no injury, no harm, no violence, no weapons, no killing, family-friendly action.';
  const swaps: Array<[RegExp, string]> = [
    [/\bstrike\b/gi, 'forceful move'],
    [/\bpowerful\b/gi, 'dramatic'],
    [/\bimpact\b/gi, 'shockwave'],
    [/\bhit\b/gi, 'push'],
    [/\bpunch\b/gi, 'gesture'],
    [/\bknock(ed)?\b/gi, 'send'],
    [/\bflying backwards\b/gi, 'sliding backward'],
    [/\bexecuting\b/gi, 'performing'],
    [/\btough\b/gi, 'determined'],
  ];

  if (level >= 1) {
    for (const [re, rep] of swaps) softened = softened.replace(re, rep);
    if (!softened.toLowerCase().includes('no blood')) softened += ` ${safetyTail}`;
  }

  if (level >= 2) {
    softened = softened.replace(
      /\b(superhero)\s+(sliding backward|flying backwards)\s+from\s+the\s+(impact|shockwave)\b/gi,
      '$1 is pushed back by a visible shockwave (no contact, no injury)'
    );
    softened = softened.replace(/\b(stunt choreography)\b/gi, 'stage choreography (no contact)');
    softened += ' show no physical contact; depict a near-miss or shockwave-only moment.';
  }

  if (level >= 3) {
    softened =
      'dynamic low-angle cinematic shot, determined elderly man with a mustache makes a dramatic gesture, ' +
      'caped superhero slides backward as if pushed by wind or shockwave (no contact, no harm), ' +
      'motion blur, kinetic camera movement, dramatic lighting, high contrast, smooth tracking shot, realistic movement, ' +
      'family-friendly action, no violence, no injury, no blood.';
  }

  return softened.trim();
};
