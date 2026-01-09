'use client';

interface ActionButtonsProps {
  onAction: (action: string) => void;
  disabled?: boolean;
}

const actions = [
  {
    id: 'remove-background',
    label: 'Remove Background',
    subtitle: 'AI Cleanup',
    icon: '✨',
  },
  {
    id: 'studio-background',
    label: 'Professional Studio Background',
    subtitle: 'AI Photo',
    icon: '📸',
  },
  {
    id: '3d-motion',
    label: 'Generate 3D Motion',
    subtitle: 'AI Video',
    icon: '🎥',
  },
  {
    id: 'ad-script',
    label: 'AI Ad Script',
    subtitle: 'Text generator',
    icon: '✍️',
  },
];

export default function ActionButtons({ onAction, disabled = false }: ActionButtonsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {actions.map((action) => (
        <button
          key={action.id}
          onClick={() => onAction(action.id)}
          disabled={disabled}
          className={`group relative overflow-hidden glass rounded-xl p-6 text-left transition-all ${
            disabled
              ? 'cursor-not-allowed opacity-50'
              : 'hover:border-[#00d9ff]/50 hover:bg-[#00d9ff]/10 active:scale-[0.98] shadow-lg hover:shadow-[#00d9ff]/20'
          }`}
        >
          <div className="flex flex-col gap-2">
            <div className="text-2xl">{action.icon}</div>
            <div>
              <h3 className="text-sm font-semibold text-white">{action.label}</h3>
              <p className="mt-1 text-xs text-gray-400">{action.subtitle}</p>
            </div>
          </div>
          
          {!disabled && (
            <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[#00d9ff]/10 blur-2xl transition-all group-hover:bg-[#00d9ff]/20" />
          )}
        </button>
      ))}
    </div>
  );
}

