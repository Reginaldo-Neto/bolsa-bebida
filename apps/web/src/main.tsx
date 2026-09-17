import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Venue wifi is unreliable; retry, but never long enough to look frozen.
      retry: 2,
      refetchOnWindowFocus: true,
      staleTime: 5_000,
    },
  },
});

const root = document.getElementById('root');
if (!root) {
  throw new Error('missing #root');
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
