import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './lib/api.js';
import App from './app/App.jsx';
import './styles/tokens.css';
import './styles/global.css';

// Sessão expirada a meio da utilização: esquece o utilizador e volta ao ecrã de entrada.
function onAuthError(err) {
  if (err instanceof ApiError && err.status === 401 && queryClient.getQueryData(['me'])) {
    queryClient.clear();
    window.location.assign('/entrar');
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      // Não insistir em pedidos recusados pelo servidor (sessão expirada, inexistente...).
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
