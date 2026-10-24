import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// Spec 011 (review round 1, S1): findBy* and waitFor wait up to 3 s instead of 1 s, so a busy
// run (coverage on, a slower CI runner) does not fail a test that only waits for the screen.
// No assertion changes (FR-018).
configure({ asyncUtilTimeout: 3000 });
