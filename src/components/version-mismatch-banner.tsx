import React from 'react';
import { Warning } from '@phosphor-icons/react';

interface VersionMismatchBannerProps {
  clientVersion: string;
  serverVersion: string;
  onReload: () => void;
}

export function VersionMismatchBanner({
  clientVersion,
  serverVersion,
  onReload,
}: VersionMismatchBannerProps) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 dark:bg-amber-600 shadow-lg">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Warning
              className="text-white flex-shrink-0"
              size={20}
              weight="bold"
            />
            <div className="text-white">
              <p className="font-semibold">New version available</p>
              <p className="text-sm text-white/90">
                Server has been updated ({serverVersion}). You're running{' '}
                {clientVersion}. Please reload to get the latest version.
              </p>
            </div>
          </div>
          <button
            onClick={onReload}
            className="px-4 py-2 bg-white text-amber-600 dark:text-amber-700 rounded-lg hover:bg-amber-50 font-medium transition-colors flex-shrink-0"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
