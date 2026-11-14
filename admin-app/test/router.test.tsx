import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { AppRouter } from '../src/router';

/**
 * Spec 039 research R13 (found by the browser test of T037): the Admin app's data router is made
 * when the signed-in app first renders, not when the page loads. Sign-in returns to the app at
 * "/?code=…" and only then puts the page asked for back in the address bar; a router made before
 * that would start at "/" and lose it.
 */
function Here(): React.ReactElement {
  return <p>{`at ${useLocation().pathname}`}</p>;
}

describe('AppRouter', () => {
  it('starts at the address the page has when it first renders', () => {
    window.history.replaceState(null, '', '/');
    // What sign-in does after the redirect, before the app renders.
    window.history.replaceState(null, '', '/locations/v1');
    render(<AppRouter routes={[{ path: '*', element: <Here /> }]} />);
    expect(screen.getByText('at /locations/v1')).toBeInTheDocument();
  });
});
