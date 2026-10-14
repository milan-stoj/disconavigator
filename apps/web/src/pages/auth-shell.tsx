import type { ReactNode } from 'react';
import { Headphones } from 'lucide-react';
import { ModeToggle } from '@/components/app/mode-toggle';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-muted/40 relative flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>
      <div className="flex items-center gap-2 font-semibold">
        <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
          <Headphones className="size-4" />
        </div>
        Disco Controller
      </div>
      <main className="w-full max-w-sm">{children}</main>
    </div>
  );
}
