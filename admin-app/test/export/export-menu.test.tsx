import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportMenu } from '../../src/export/ExportMenu';
import { save } from '../../src/export/save';
import { toCsv } from '../../src/export/csv';
import { toXlsx } from '../../src/export/xlsx';
import { toPdf } from '../../src/export/pdf';
import { SAMPLE } from './sample';

/** Spec 023 FR-001, FR-011, FR-014, FR-015 (research R11): the Download control. */
vi.mock('../../src/export/save', () => ({ save: vi.fn() }));
vi.mock('../../src/export/csv', () => ({ toCsv: vi.fn() }));
vi.mock('../../src/export/xlsx', () => ({ toXlsx: vi.fn() }));
vi.mock('../../src/export/pdf', () => ({ toPdf: vi.fn() }));

const CSV = new Blob(['csv'], { type: 'text/csv' });
const XLSX = new Blob(['xlsx']);
const PDF = new Blob(['pdf']);

beforeEach(() => {
  vi.mocked(save).mockReset();
  vi.mocked(toCsv).mockReset().mockReturnValue(CSV);
  vi.mocked(toXlsx).mockReset().mockResolvedValue(XLSX);
  vi.mocked(toPdf).mockReset().mockResolvedValue(PDF);
});

const makeTable = vi.fn(() => SAMPLE);
const renderMenu = (note?: string) =>
  render(
    <ExportMenu
      label="Download the attendee list"
      makeTable={makeTable}
      fileName={(ext) => `attendees-x.${ext}`}
      note={note}
    />,
  );
const formats = () => [
  screen.getByRole('button', { name: 'CSV', hidden: true }),
  screen.getByRole('button', { name: 'Excel (XLSX)', hidden: true }),
  screen.getByRole('button', { name: 'PDF', hidden: true }),
];

describe('ExportMenu', () => {
  it('is a Download disclosure with three formats, in a labelled group', () => {
    const { container } = renderMenu();
    const summary = screen.getByText('Download');
    expect(summary.closest('summary')).toHaveClass('btn');
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('group', { name: 'Download the attendee list', hidden: true })).toBe(
      formats()[0].closest('[role="group"]'),
    );
    formats().forEach((b) => expect(b).toHaveClass('btn'));
  });

  it('opens with the keyboard and saves the chosen format (FR-015)', async () => {
    const user = userEvent.setup();
    const { container } = renderMenu();
    await user.tab();
    expect(screen.getByText('Download').closest('summary')).toHaveFocus();
    // A browser opens a focused <summary> on Enter by clicking it; jsdom has no such key
    // behavior, so the click stands in for it here (the running-system walk checks the key).
    await user.click(screen.getByText('Download'));
    expect(container.querySelector('details')).toHaveAttribute('open');
    await user.tab();
    expect(screen.getByRole('button', { name: 'CSV' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(save).toHaveBeenCalledWith(CSV, 'attendees-x.csv'));
    expect(toCsv).toHaveBeenCalledWith(SAMPLE);
  });

  it.each([
    ['Excel (XLSX)', toXlsx, XLSX, 'attendees-x.xlsx'],
    ['PDF', toPdf, PDF, 'attendees-x.pdf'],
  ] as const)('saves %s with its file name', async (button, writer, blob, name) => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByText('Download'));
    await user.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(blob, name));
    expect(writer).toHaveBeenCalledWith(SAMPLE);
  });

  it('says it is preparing the file and cannot start a second one meanwhile (FR-014)', async () => {
    let finish: (b: Blob) => void = () => undefined;
    vi.mocked(toPdf).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByText('Download'));
    await user.click(screen.getByRole('button', { name: 'PDF' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Preparing the PDF…');
    formats().forEach((b) => expect(b).toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'CSV' }));
    expect(toCsv).not.toHaveBeenCalled();

    finish(PDF);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    formats().forEach((b) => expect(b).toBeEnabled());
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('shows a failure naming the format and lets the admin try again (FR-014)', async () => {
    vi.mocked(toXlsx).mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByText('Download'));
    await user.click(screen.getByRole('button', { name: 'Excel (XLSX)' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't make the Excel file. Try again.");
    expect(alert).toHaveClass('banner', 'banner--error');
    expect(save).not.toHaveBeenCalled();
    formats().forEach((b) => expect(b).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Excel (XLSX)' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(XLSX, 'attendees-x.xlsx'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a failure when the browser will not save the file', async () => {
    vi.mocked(save).mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByText('Download'));
    await user.click(screen.getByRole('button', { name: 'CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't make the CSV. Try again.");
  });

  it('shows the note, and describes each format button with it (FR-011)', async () => {
    renderMenu("The file contains customers' names and usernames. Keep it private.");
    const note = screen.getByText(
      "The file contains customers' names and usernames. Keep it private.",
    );
    expect(note).toHaveClass('note');
    formats().forEach((b) => expect(b).toHaveAttribute('aria-describedby', note.id));
  });
});
