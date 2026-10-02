/**
 * A decimal-string amount as US dollars with thousands separators, built from the string's
 * digits so it never passes through a floating-point number (Constitution, Money).
 */
export function usd(amount: string): string {
  const [whole, fraction = ''] = amount.split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}
