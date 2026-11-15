// The React fixtures' API stub imports vitest only for `vi.fn`; the generator never calls it.
export const vi = { fn: () => () => undefined, spyOn: () => undefined };
