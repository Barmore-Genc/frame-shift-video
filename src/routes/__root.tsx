import { createRootRoute, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useEffect, useState } from 'react';
import { checkVersion } from '@/lib/version-checker';
import { VersionMismatchBanner } from '@/components/version-mismatch-banner';
import { AppErrorBoundary } from '@/components/app-error-boundary';
import { DiscsCornerButton } from '@/components/discs-corner-button';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const [versionMismatch, setVersionMismatch] = useState<{
    clientVersion: string;
    serverVersion: string;
  } | null>(null);

  useEffect(() => {
    // Check version on mount
    checkVersion().then((status) => {
      if (status.enabled && status.mismatch) {
        setVersionMismatch({
          clientVersion: status.clientVersion!,
          serverVersion: status.serverVersion!,
        });
      }
    });

    // Check version periodically (every 5 minutes)
    const interval = setInterval(
      () => {
        checkVersion().then((status) => {
          if (status.enabled && status.mismatch) {
            setVersionMismatch({
              clientVersion: status.clientVersion!,
              serverVersion: status.serverVersion!,
            });
          }
        });
      },
      5 * 60 * 1000,
    );

    return () => clearInterval(interval);
  }, []);

  const handleReload = () => {
    window.location.reload();
  };

  return (
    <>
      <AppErrorBoundary variant="page">
        {versionMismatch && (
          <VersionMismatchBanner
            clientVersion={versionMismatch.clientVersion}
            serverVersion={versionMismatch.serverVersion}
            onReload={handleReload}
          />
        )}
        <div className="min-h-screen">
          <DiscsCornerButton />
          <Outlet />
        </div>
        <TanStackRouterDevtools />
        <ReactQueryDevtools initialIsOpen={false} />
      </AppErrorBoundary>
    </>
  );
}
