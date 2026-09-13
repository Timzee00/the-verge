export type MinorAmount = number;

export function assertMinorAmount(value: number, field = 'amount'): MinorAmount {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer minor-unit amount`);
  }
  return value;
}

export function addMinor(a: number, b: number): MinorAmount {
  assertMinorAmount(a, 'a');
  assertMinorAmount(b, 'b');
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error('Money overflow');
  return result;
}

export function subtractSigned(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) throw new Error('Money values must be safe integers');
  const result = a - b;
  if (!Number.isSafeInteger(result)) throw new Error('Money overflow');
  return result;
}

/** Exact decimal parsing for user-entered money. Avoids binary floating-point surprises. */
export function parseMajorToMinor(input: string, fractionDigits = 2): MinorAmount {
  const normalized = input.trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error('Invalid monetary amount');
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > fractionDigits) throw new Error(`Amount supports at most ${fractionDigits} decimal places`);
  const minor = Number(whole) * (10 ** fractionDigits) + Number((fraction + '0'.repeat(fractionDigits)).slice(0, fractionDigits));
  return assertMinorAmount(minor);
}

export const toMinor = (major: number): MinorAmount => {
  if (!Number.isFinite(major) || major < 0) throw new Error('Invalid amount');
  const minor = Math.round((major + Number.EPSILON) * 100);
  return assertMinorAmount(minor);
};

export const toMajor = (minor: number): number => assertMinorAmount(minor) / 100;

export function formatMinor(minor: number, currency = 'NGN', locale = 'en-NG'): string {
  assertMinorAmount(minor);
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(toMajor(minor));
}
