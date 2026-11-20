import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { createQueryClient } from '@/api/queryClient';
import { applyAppearance, storedAppearance } from '@/lib/appearance';
import { SessionExpiryListener } from '@/features/auth/guards';
import { router } from '@/router';
import './index.css';

// D-45: light/dark from this device's last choice; the per-user setting refines it after sign-in.
applyAppearance(storedAppearance());

const queryClient = createQueryClient();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionExpiryListener />
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
