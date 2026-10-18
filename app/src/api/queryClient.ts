import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { ApiError } from './http';

const isClientError = (error: unknown) =>
  error instanceof ApiError && error.status !== undefined && error.status >= 400 && error.status < 500;

const isNetworkError = (error: unknown) => error instanceof ApiError && error.status === undefined;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: (failureCount, error) => !isClientError(error) && failureCount < 2,
    },
    mutations: {
      retry: (failureCount, error) => isNetworkError(error) && failureCount < 1,
    },
  },
});

// On web, React Query already listens to `visibilitychange`.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
    return () => subscription.remove();
  });
}
