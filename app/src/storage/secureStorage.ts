import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { StateStorage } from 'zustand/middleware';

// expo-secure-store has no web implementation; localStorage keeps the web demo usable.
export const secureStorage: StateStorage = {
  getItem: (key) =>
    Platform.OS === 'web' ? globalThis.localStorage?.getItem(key) ?? null : SecureStore.getItemAsync(key),
  setItem: (key, value) =>
    Platform.OS === 'web' ? globalThis.localStorage?.setItem(key, value) : SecureStore.setItemAsync(key, value),
  removeItem: (key) =>
    Platform.OS === 'web' ? globalThis.localStorage?.removeItem(key) : SecureStore.deleteItemAsync(key),
};
