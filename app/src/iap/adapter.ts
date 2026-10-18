import { Platform } from 'react-native';

import { IAP_MOCK } from '@/config';

import type { StoreAdapter } from './types';

// expo-iap loads a native module on import, so it is only required when used;
// this keeps mock mode working in Expo Go and on web.
export const isMockStore = IAP_MOCK || Platform.OS === 'web';

export const storeAdapter: StoreAdapter = isMockStore
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./mockAdapter').mockAdapter
  : // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./nativeAdapter').nativeAdapter;
