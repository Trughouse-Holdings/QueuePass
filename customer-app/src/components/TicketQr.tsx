import qrcode from 'qrcode-generator';

/**
 * Spec 017 FR-012 (research R8): the QR code encodes the ticket's code and nothing else. Type
 * number 0 picks the smallest size that fits; 12 alphanumeric characters at level M fit version 1
 * (21 × 21 modules), which scans easily from paper or a screen.
 */
export function qrMatrix(code: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(code, 'Alphanumeric');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

const QUIET_ZONE = 4;

/**
 * The matrix as one SVG path of the dark modules with a 4-module quiet zone, black on white:
 * no HTML strings, and it prints sharply at any size (research R8).
 */
export function TicketQr({ code }: { code: string }) {
  const matrix = qrMatrix(code);
  const size = matrix.length + 2 * QUIET_ZONE;
  const path = matrix
    .flatMap((row, r) =>
      row.flatMap((dark, c) => (dark ? [`M${c + QUIET_ZONE} ${r + QUIET_ZONE}h1v1h-1z`] : [])),
    )
    .join('');
  return (
    <svg
      className="ticket-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`QR code for ticket ${code}`}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
