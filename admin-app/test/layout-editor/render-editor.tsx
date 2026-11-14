import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { LayoutEditorPage } from '../../src/layout-editor/LayoutEditor';
import { LAYOUT_ID, VENUE_ID } from './fixtures';

/**
 * Spec 039 (T022): the editor under a data router (`useBlocker` needs one, research R13), between
 * the venue page and the editor's two routes, as `App.tsx` declares them.
 */
export const NEW_PATH = `/locations/${VENUE_ID}/layouts/new`;
export const EDIT_PATH = `/locations/${VENUE_ID}/layouts/${LAYOUT_ID}/edit`;
export const DRAWING_PATH = `/layouts/${LAYOUT_ID}/drawing`;
export const CREATE_PATH = `/locations/${VENUE_ID}/layouts/drawing`;

export function renderEditor(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/locations/:id', element: <p>Venue page</p> },
      { path: '/locations/:id/layouts/new', element: <LayoutEditorPage /> },
      { path: '/locations/:id/layouts/:layoutId/edit', element: <LayoutEditorPage /> },
    ],
    { initialEntries: [path] },
  );
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

/** jsdom has no PointerEvent: a MouseEvent with a pointer id stands in for it. */
export function installPointerEvents(): void {
  if (typeof window.PointerEvent === 'function') return;
  class PointerEventStub extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  Object.assign(window, { PointerEvent: PointerEventStub });
}

/** The editor's map. */
export const map = () => screen.getByRole('application', { name: /^Layout map/ });
/** A section on the map, by name. */
export const sectionOnMap = (name: string) =>
  within(map()).getByRole('button', { name: new RegExp(`^Section ${name},`) });
/** A side panel, by its heading. */
export const panel = (name: string) => screen.getByRole('region', { name });
