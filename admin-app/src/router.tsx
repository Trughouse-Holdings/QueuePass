import { useState } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router-dom';

/**
 * Spec 039 research R13: the Admin app's data router, so the layout editor can ask before unsaved
 * changes go (`useBlocker`). It is made when the signed-in app first renders, not when the page
 * loads: sign-in comes back to "/?code=…" and puts the page asked for back in the address bar just
 * before the app renders, and a router made earlier would start at "/".
 */
export function AppRouter({ routes }: { routes: RouteObject[] }): React.ReactElement {
  const [router] = useState(() => createBrowserRouter(routes));
  return <RouterProvider router={router} />;
}
