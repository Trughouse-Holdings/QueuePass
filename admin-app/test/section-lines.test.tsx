import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import {
  SectionLines,
  toLinesInput,
  type LevelLine,
  type SectionLine,
} from '../src/components/SectionLines';

/**
 * Spec 024 US3 (FR-018 to FR-022; research R8): each section line has visible labels "Section
 * name", "Rows" × "Seats per row", its seat count, and names built from its legend and labels;
 * one hint above the lines says what a section is. Spec 038 FR-005 (research R15): a levels list
 * (name and color, most desirable first) and a "Price level" column on every line.
 */
const HINT =
  'A section is a grid of seats: rows run front to back, and every row has the same number of seats across.';

const LEVELS: LevelLine[] = [
  { name: 'Front', color: 'violet' },
  { name: 'Back', color: 'teal' },
];

function Lines({
  start,
  levels: startLevels = LEVELS,
  onLines,
}: {
  start: SectionLine[];
  levels?: LevelLine[];
  onLines?: (levels: LevelLine[], lines: SectionLine[]) => void;
}): React.ReactElement {
  const [lines, setLines] = useState(start);
  const [levels, setLevels] = useState(startLevels);
  onLines?.(levels, lines);
  return (
    <SectionLines levels={levels} onLevelsChange={setLevels} lines={lines} onChange={setLines} />
  );
}

const line = (name: string, rows: string, seatsPerRow: string, level = 'Front'): SectionLine => ({
  name,
  rows,
  seatsPerRow,
  level,
});
const group = (n: number) => screen.getByRole('group', { name: `Section ${n}` });
const box = (n: number, label: 'Rows' | 'Seats per row') =>
  screen.getByRole('spinbutton', { name: `Section ${n} ${label}` });
const set = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe('SectionLines (spec 024 US3)', () => {
  it.each([
    ['no lines', []],
    ['one line', [line('Floor', '10', '20')]],
    ['two lines', [line('Floor', '10', '20'), line('Balcony', '5', '10')]],
  ])('shows the hint exactly once with %s', (_label, start) => {
    render(<Lines start={start} />);
    expect(screen.getAllByText(HINT)).toHaveLength(1);
  });

  it('labels each line visibly, with "×" between Rows and Seats per row', () => {
    render(<Lines start={[line('Floor', '10', '20'), line('Balcony', '5', '10')]} />);
    for (const n of [1, 2]) {
      const g = within(group(n));
      expect(g.getByText('Section name')).toBeInTheDocument();
      expect(g.getByText('Rows')).toBeInTheDocument();
      expect(g.getByText('Seats per row')).toBeInTheDocument();
      expect(g.getByText('×')).toHaveAttribute('aria-hidden', 'true');
      expect(group(n)).toHaveClass('form__row', 'form__row--section');
    }
  });

  it("names each box by the section's legend and the box's visible label (WCAG 2.5.3)", () => {
    render(<Lines start={[line('Floor', '10', '20')]} />);
    expect(screen.getByRole('textbox', { name: 'Section 1 Section name' })).toHaveValue('Floor');
    const rows = box(1, 'Rows');
    const seats = box(1, 'Seats per row');
    expect(rows).toHaveValue(10);
    expect(seats).toHaveValue(20);
    expect(rows).toHaveAttribute('min', '1');
    expect(rows).toHaveAttribute('max', '100');
    expect(seats).toHaveAttribute('min', '1');
    expect(seats).toHaveAttribute('max', '200');
    const name = screen.getByRole('textbox', { name: 'Section 1 Section name' });
    const level = screen.getByRole('combobox', { name: 'Section 1 Price level' });
    for (const el of [name, rows, seats, level]) {
      expect(el).not.toHaveAttribute('aria-label');
    }
  });

  it.each([
    ['10', '20', '= 200 seats'],
    ['1', '1', '= 1 seat'],
    ['', '20', '= 0 seats'],
    ['10', '', '= 0 seats'],
    ['abc', '20', '= 0 seats'],
    ['100', '200', '= 20,000 seats'],
  ])('shows %s × %s as "%s"', (rows, seats, text) => {
    render(<Lines start={[line('Floor', '1', '1')]} />);
    set(box(1, 'Rows'), rows);
    set(box(1, 'Seats per row'), seats);
    expect(within(group(1)).getByText(text)).toBeInTheDocument();
  });

  it('renumbers the lines after Remove, names included, and adds a 1 × 1 line', () => {
    render(<Lines start={[line('Floor', '10', '20'), line('Balcony', '5', '10')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove section 1' }));
    expect(screen.queryByRole('group', { name: 'Section 2' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Section 1 Section name' })).toHaveValue('Balcony');
    expect(box(1, 'Rows')).toHaveValue(5);
    expect(within(group(1)).getByText('= 50 seats')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    expect(screen.getByRole('textbox', { name: 'Section 2 Section name' })).toHaveValue('');
    expect(within(group(2)).getByText('= 1 seat')).toBeInTheDocument();
  });

  it("gives every line a Price level select of the levels, by name, the line's level chosen", () => {
    render(<Lines start={[line('Floor', '10', '20', 'Back')]} />);
    const select = screen.getByRole('combobox', { name: 'Section 1 Price level' });
    expect(select).toHaveValue('Back');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Front', 'Back']);
    expect(within(group(1)).getByText('Price level')).toBeInTheDocument();
  });

  it('lists the levels, most desirable first, each with a name and one of the 12 colors', () => {
    render(<Lines start={[]} />);
    expect(screen.getByRole('textbox', { name: 'Level 1 Level name' })).toHaveValue('Front');
    const color = screen.getByRole('combobox', { name: 'Level 2 Color' });
    expect(color).toHaveValue('teal');
    expect(within(color).getAllByRole('option')).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: 'Add level' }));
    expect(screen.getByRole('textbox', { name: 'Level 3 Level name' })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Remove level 1' }));
    expect(screen.getByRole('textbox', { name: 'Level 1 Level name' })).toHaveValue('Back');
  });

  it('renames a level in every line that uses it, and adds a line in the first level', () => {
    let seen: SectionLine[] = [];
    render(
      <Lines
        start={[line('Floor', '10', '20', 'Front'), line('Balcony', '5', '10', 'Back')]}
        onLines={(_levels, lines) => (seen = lines)}
      />,
    );
    set(screen.getByRole('textbox', { name: 'Level 1 Level name' }), 'Courtside');
    expect(screen.getByRole('combobox', { name: 'Section 1 Price level' })).toHaveValue(
      'Courtside',
    );
    expect(seen.map((l) => l.level)).toEqual(['Courtside', 'Back']);
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    expect(screen.getByRole('combobox', { name: 'Section 3 Price level' })).toHaveValue(
      'Courtside',
    );
  });

  it('makes the request: names trimmed, numbers as numbers, levels in order', () => {
    expect(toLinesInput(' Club room ', LEVELS, [line(' Floor A ', '10', '20', 'Front')])).toEqual({
      name: 'Club room',
      levels: LEVELS,
      sections: [{ name: 'Floor A', rows: 10, seatsPerRow: 20, level: 'Front' }],
    });
  });
});
