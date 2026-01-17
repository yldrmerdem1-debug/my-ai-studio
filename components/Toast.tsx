'use client';

import { useEffect, useState } from 'react';
import { X, AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose?: () => void;
}

export default function Toast({ message, type = 'info', duration = 5000, onClose }: ToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => onClose?.(), 300);
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => onClose?.(), 300);
  };

  const typeConfig = {
    success: {
      icon: CheckCircle,
      bgColor: 'bg-green-500/20',
      borderColor: 'border-green-500/50',
      textColor: 'text-green-400',
      iconColor: 'text-green-400',
    },
    error: {
      icon: AlertCircle,
      bgColor: 'bg-red-500/20',
      borderColor: 'border-red-500/50',
      textColor: 'text-red-400',
      iconColor: 'text-red-400',
    },
    warning: {
      icon: AlertTriangle,
      bgColor: 'bg-yellow-500/20',
      borderColor: 'border-yellow-500/50',
      textColor: 'text-yellow-400',
      iconColor: 'text-yellow-400',
    },
    info: {
      icon: Info,
      bgColor: 'bg-blue-500/20',
      borderColor: 'border-blue-500/50',
      textColor: 'text-blue-400',
      iconColor: 'text-blue-400',
    },
  };

  const config = typeConfig[type];
  const Icon = config.icon;

  return (
    <div
      className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-6 py-4 rounded-xl border transition-all duration-300 ${
        config.bgColor
      } ${config.borderColor} ${isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full'}`}
    >
      <Icon className={`w-5 h-5 ${config.iconColor}`} />
      <p className={`font-medium ${config.textColor} flex-1`}>{message}</p>
      <button
        onClick={handleClose}
        className={`${config.textColor} hover:opacity-70 transition-opacity interactive-element`}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
