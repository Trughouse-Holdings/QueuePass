const tickets = (n: number): string => `${n} ${n === 1 ? 'ticket' : 'tickets'}`;

/** Spec 016 research R4: the limit refusal, with the limit, what is held, and what is left. */
export function limitMessage(
  event: string,
  limit: number,
  held: number,
  requested: number,
): string {
  const allows = `${event} allows ${tickets(limit)} per customer`;
  const remaining = limit - held;
  if (remaining <= 0) return `${allows}, and you already hold ${held}.`;
  return (
    `${allows}. You already hold ${held}, so you can get ${remaining} more; ` +
    `${requested} ${requested === 1 ? 'was' : 'were'} requested.`
  );
}
