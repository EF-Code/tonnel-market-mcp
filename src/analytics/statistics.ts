import {
  addDecimal,
  compareDecimal,
  decimal,
  divideDecimal,
  subtractDecimal,
  type DecimalString,
} from "../domain/money.js";

export function sum(values: Array<string | number>): DecimalString {
  return addDecimal(...values);
}

export function minimum(
  values: Array<string | number>,
): DecimalString | undefined {
  if (values.length === 0) return undefined;
  const first = values[0];
  if (first === undefined) return undefined;
  return decimal(
    values.reduce(
      (best, value) => (compareDecimal(value, best) < 0 ? value : best),
      first,
    ),
  );
}

export function maximum(
  values: Array<string | number>,
): DecimalString | undefined {
  if (values.length === 0) return undefined;
  const first = values[0];
  if (first === undefined) return undefined;
  return decimal(
    values.reduce(
      (best, value) => (compareDecimal(value, best) > 0 ? value : best),
      first,
    ),
  );
}

export function median(
  values: Array<string | number>,
): DecimalString | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.map((value) => decimal(value)).sort(compareDecimal);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle];
  if (middleValue === undefined) return undefined;
  if (sorted.length % 2 === 1) return middleValue;
  const lower = sorted[middle - 1];
  if (lower === undefined) return middleValue;
  return average(lower, middleValue);
}

export function percentile(
  values: Array<string | number>,
  percentage: number,
): DecimalString | undefined {
  if (values.length === 0) return undefined;
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)
    return undefined;
  const sorted = values.map((value) => decimal(value)).sort(compareDecimal);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

export function differencePercent(
  observed: string | number,
  reference: string | number,
): DecimalString | null {
  if (compareDecimal(reference, 0) === 0) return null;
  return decimal(subtractDecimal(observed, reference));
}

function average(left: string, right: string): DecimalString {
  return divideDecimal(addDecimal(left, right), 2);
}
