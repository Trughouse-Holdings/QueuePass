import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import readExcelFile from 'read-excel-file/node';
import { AuthProvider } from '@queuepass/shared/web';
import type { SalesReport } from '@queuepass/shared';
import { App } from '../src/App';
import { Reports } from '../src/pages/Reports';
import { save } from '../src/export/save';
import { toCsv } from '../src/export/csv';
import { salesTable } from '../src/export/sales-rows';
import { json, stubApi } from './helpers/api-stub';
import { REPORT } from './fixtures-005';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';

/** Spec 023 US2, US3 (FR-002, FR-003, R13a): Download on the Reports page. */
vi.mock('../src/export/save', () => ({ save: vi.fn() }));

beforeEach(() => vi.mocked(save).mockReset());
afterEach(() => vi.unstubAllGlobals());

const renderReports = () =>
  render(
    <MemoryRouter initialEntries={['/reports']}>
      <Routes>
        <Route path="/reports" element={<Reports username="admin2" />} />
      </Routes>
    </MemoryRouter>,
  );

describe('Download on the Reports page', () => {
  it('is offered when the report is shown, and not while loading', async () => {
    stubApi({ 'GET /reports/sales': json(REPORT) });
    renderReports();
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
    expect(await screen.findByText('Download')).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Download the sales report', hidden: true }),
    ).toBeInTheDocument();
  });

  it('is not offered when the report cannot load', async () => {
    stubApi({ 'GET /reports/sales': 'network-error' });
    renderReports();
    await screen.findByRole('alert');
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
  });

  it('saves a CSV made at generatedAt', async () => {
    stubApi({ 'GET /reports/sales': json(REPORT) });
    const user = userEvent.setup();
    renderReports();
    await user.click(await screen.findByText('Download'));
    await user.click(screen.getByRole('button', { name: 'CSV' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [blob, name] = vi.mocked(save).mock.calls[0];
    const table = salesTable(REPORT as unknown as SalesReport, 'admin2');
    expect(await blob.text()).toBe(await toCsv(table).text());
    expect(name).toMatch(/^sales-report-2026-10-0[01]-\d{4}\.csv$/);
  });

  it("names the signed-in admin as made by, from the app's sign-in (R13a)", async () => {
    stubApi({ 'GET /reports/sales': json(REPORT) });
    const user = userEvent.setup();
    render(
      <AuthProvider
        userManager={fakeUserManager(makeUser({ username: 'admin1', roles: ['queuepass-admin'] }))}
      >
        <MemoryRouter initialEntries={['/reports']}>
          <App />
        </MemoryRouter>
      </AuthProvider>,
    );
    await user.click(await screen.findByText('Download'));
    await user.click(screen.getByRole('button', { name: 'Excel (XLSX)' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [blob] = vi.mocked(save).mock.calls[0];
    const sheets = await readExcelFile(Buffer.from(await blob.arrayBuffer()));
    expect(sheets[1].data.map((r) => r[0])).toContain('Made by admin1');
  });
});
