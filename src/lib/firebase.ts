import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  memoryLocalCache,
  setLogLevel,
} from 'firebase/firestore';
import firebaseConfig from '@/firebase-applet-config.json';

// Silence internal Firestore SDK retry and backoff log outputs
setLogLevel('silent');

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Purge any stuck mutation queues from previous sessions in IndexedDB
if (typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined') {
  try {
    const dbId = firebaseConfig.firestoreDatabaseId || 'ai-studio-b02c9969-4ff2-4890-9989-dce518b8587c';
    window.indexedDB.deleteDatabase(`firestore/[DEFAULT]/${dbId}/main`);
    window.indexedDB.deleteDatabase('firestore/[DEFAULT]/ai-studio-b02c9969-4ff2-4890-9989-dce518b8587c/main');
    window.indexedDB.deleteDatabase('firestore/[DEFAULT]/(default)/main');
  } catch {
    // Ignore deletion errors in private browsing modes
  }
}

export const db = initializeFirestore(
  app,
  {
    localCache: memoryLocalCache(),
    experimentalForceLongPolling: true,
    ignoreUndefinedProperties: true,
  },
  firebaseConfig.firestoreDatabaseId
);


