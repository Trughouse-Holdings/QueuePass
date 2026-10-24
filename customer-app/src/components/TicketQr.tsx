import qrcode from 'qrcode-generator';

/**
 * Spec 017 FR-012 (research R8): the QR code encodes the ticket's code and nothing else. Type
 * number 0 picks the smallest size that fits; 12 alphanumeric characters at level M fit version 1
 * (21 × 21 modules), which scans easily from paper or a screen. Spec 018 (research R8) draws a
 * live code with it too: any text in QR's alphanumeric set (upper case, digits, and `:`); a
 * 62-character live code is version 4 (33 × 33).
 */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Alphanumeric');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

const QUIET_ZONE = 4;

/** The dark modules of `text`'s QR code as one SVG path, offset by the 4-module quiet zone. */
export function qrPath(text: string): string {
  return pathOf(qrMatrix(text));
}

function pathOf(matrix: boolean[][]): string {
  return matrix
    .flatMap((row, r) =>
      row.flatMap((dark, c) => (dark ? [`M${c + QUIET_ZONE} ${r + QUIET_ZONE}h1v1h-1z`] : [])),
    )
    .join('');
}

/**
 * The matrix as one SVG path of the dark modules with a 4-module quiet zone, black on white:
 * no HTML strings, and it prints sharply at any size (research R8). Its accessible name is 017's
 * "QR code for ticket <code>" unless `label` says otherwise.
 */
export function TicketQr({
  code,
  label,
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const matrix = qrMatrix(code);
  const size = matrix.length + 2 * QUIET_ZONE;
  return (
    <svg
      className={className ? `ticket-qr ${className}` : 'ticket-qr'}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label ?? `QR code for ticket ${code}`}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={pathOf(matrix)} fill="#000" />
    </svg>
  );
}
