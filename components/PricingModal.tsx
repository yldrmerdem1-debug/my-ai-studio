'use client';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const plans = [
  {
    name: 'Starter',
    price: '$19',
    period: '/month',
    features: [
      'Generate content',
      'Generic AI identity',
      'HD quality output',
      'Standard processing speed',
      'Watermark on exports',
    ],
    popular: false,
  },
  {
    name: 'Premium',
    price: '$49',
    period: '/month',
    features: [
      'Generate content as YOU',
      'Persona training (visual)',
      'Consistent face across outputs',
      '4K quality output',
      'Priority support',
      'No watermark',
    ],
    popular: true,
  },
  {
    name: 'Elite',
    price: '$79',
    period: '/month',
    features: [
      'Your face + your voice',
      'Persona training (voice)',
      'Voice persona generation',
      'Fastest processing speed',
      'Dedicated support',
      'API access',
    ],
    popular: false,
  },
];

export default function PricingModal({ isOpen, onClose }: PricingModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl rounded-2xl border border-gray-800 bg-[#0a0a0a] p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-6 top-6 rounded-lg p-2 text-gray-400 transition-colors hover:bg-[#1a1a1a] hover:text-white"
        >
          <svg
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold text-white">Choose Your Plan</h2>
          <p className="mt-2 text-gray-400">Select the perfect plan for your needs</p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-xl border p-6 transition-all ${
                plan.popular
                  ? 'border-[#00d9ff]/50 bg-[#00d9ff]/5'
                  : 'border-gray-800 bg-[#0a0a0a]'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="rounded-full bg-[#00d9ff] px-4 py-1 text-xs font-semibold text-black">
                    MOST POPULAR
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-white">{plan.price}</span>
                  <span className="text-gray-400">{plan.period}</span>
                </div>
              </div>

              <ul className="mb-6 space-y-3">
                {plan.features.map((feature, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg
                      className={`mt-0.5 h-5 w-5 flex-shrink-0 ${
                        plan.popular ? 'text-[#00d9ff]' : 'text-gray-400'
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <span className="text-sm text-gray-300">{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                className={`w-full rounded-lg py-3 font-semibold transition-all ${
                  plan.popular
                    ? 'bg-[#00d9ff] text-black hover:bg-[#00b8d9]'
                    : 'border border-gray-700 bg-[#1a1a1a] text-white hover:border-gray-600 hover:bg-[#252525]'
                }`}
              >
                Get Started
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

