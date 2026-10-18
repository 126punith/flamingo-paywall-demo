export const IAP_MOCK = process.env.EXPO_PUBLIC_IAP_MOCK === '1';

// Android emulators reach the host machine at 10.0.2.2; set EXPO_PUBLIC_API_URL for devices.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

export const LEGAL_URLS = {
  terms: 'https://flamingo.example.com/terms',
  privacy: 'https://flamingo.example.com/privacy',
};
