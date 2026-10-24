import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
// Spec 014: object URLs, matchMedia, IntersectionObserver, and Node's Blob, File, and FormData.
import './web/browser-stubs';

// Spec 011 (review round 2, m1): findBy* and waitFor wait up to 3 s, as in the three apps, so a
// busy run does not fail a test that only waits for the screen. No assertion changes (FR-018).
configure({ asyncUtilTimeout: 3000 });
