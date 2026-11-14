import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LayoutPreview } from '../../src/web/venue-map/layout-preview';
import { outlinePath } from '../../src/web/venue-map/map-geometry';

/**
 * Spec 038 FR-007, research R13, R15 (T018): a layout's preview on the venue page: its sections in
 * place with their names, and its floor object, never its seats (FR-029). One image with a name
 * that says what it is.
 */
type Outline = [number, number][];
const box = (x: number, y: number, w = 30, h = 20): Outline => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

function layout(sectionCount: number, floor: Outline | null = box(400, 250, 200, 140)) {
  return {
    name: 'Basketball',
    size: { width: 1000, height: 640 },
    floorKind: floor ? ('COURT' as const) : ('NONE' as const),
    floorOutline: floor,
    sections: Array.from({ length: sectionCount }, (_, i) => ({
      id: `s${i}`,
      name: String(101 + i),
      outline: box(20 + (i % 9) * 100, 20 + Math.floor(i / 9) * 100),
      labelAt: [35 + (i % 9) * 100, 30 + Math.floor(i / 9) * 100] as [number, number],
    })),
  };
}

describe('LayoutPreview (038)', () => {
  it('is one image named for the layout and its section count', () => {
    render(<LayoutPreview layout={layout(54)} />);
    const img = screen.getByRole('img', { name: 'Basketball: 54 sections' });
    expect(img.tagName.toLowerCase()).toBe('svg');
    expect(img).toHaveAttribute('viewBox', '0 0 1000 640');
  });

  it('says "1 section" for one', () => {
    render(<LayoutPreview layout={layout(1)} />);
    expect(screen.getByRole('img', { name: 'Basketball: 1 section' })).toBeInTheDocument();
  });

  it('draws each section by its outline with its name at its label point, and no seats', () => {
    const l = layout(3);
    const { container } = render(<LayoutPreview layout={l} />);
    const sections = container.querySelectorAll('.layout-preview__section');
    expect([...sections].map((p) => p.getAttribute('d'))).toEqual(
      l.sections.map((s) => outlinePath(s.outline)),
    );
    const labels = [...container.querySelectorAll('.layout-preview__label')];
    expect(labels.map((t) => [t.textContent, t.getAttribute('x'), t.getAttribute('y')])).toEqual([
      ['101', '35', '30'],
      ['102', '135', '30'],
      ['103', '235', '30'],
    ]);
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });

  it('draws the floor object when there is one, and none for NONE', () => {
    const { container, rerender } = render(<LayoutPreview layout={layout(2)} />);
    const floor = container.querySelector('.layout-preview__floor');
    expect(floor?.getAttribute('d')).toBe(outlinePath(box(400, 250, 200, 140)));
    rerender(<LayoutPreview layout={layout(2, null)} />);
    expect(container.querySelector('.layout-preview__floor')).toBeNull();
  });

  it('takes its colors from theme classes, never from attributes or inline styles', () => {
    const { container } = render(<LayoutPreview layout={layout(2)} />);
    for (const el of container.querySelectorAll('*')) {
      expect(el.getAttribute('fill')).toBeNull();
      expect(el.getAttribute('stroke')).toBeNull();
      expect(el.getAttribute('style')).toBeNull();
    }
    expect(container.querySelector('svg')).toHaveClass('layout-preview');
  });
});
