export type User = {
  id?: string;
  plan?: 'free' | 'premium';
  isPremium?: boolean;
};

export function isPremiumUser(user?: User | null): boolean {
  return user?.plan === 'premium' || user?.isPremium === true;
}

export function canUsePersona(user?: User | null): boolean {
  return isPremiumUser(user);
}

export function canTrainVisualPersona(user?: User | null): boolean {
  return isPremiumUser(user);
}

export function canTrainVoicePersona(user?: User | null): boolean {
  return isPremiumUser(user);
}
