import { AppError } from "./errors.js";

export type DecimalString = string & {
  readonly __decimalString: unique symbol;
};

type DecimalParts = {
  coefficient: bigint;
  scale: number;
};

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu;

function partsFromValue(value: string | number): DecimalParts {
  const raw = typeof value === "number" ? value.toString() : value.trim();
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new AppError("INVALID_ARGUMENT", "Monetary values must be finite.");
  }
  const match = DECIMAL_PATTERN.exec(raw);
  if (!match) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "Monetary values must be decimal numbers.",
    );
  }

  const [, sign = "", integer = "0", fraction = "", exponentText = "0"] = match;
  const exponent = Number(exponentText);
  if (
    !Number.isSafeInteger(exponent) ||
    exponent < -10_000 ||
    exponent > 10_000
  ) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "Monetary exponent is outside the supported range.",
    );
  }

  const digits = `${integer}${fraction}`.replace(/^0+(?=\d)/u, "");
  const scale = fraction.length - exponent;
  if (scale < 0) {
    return {
      coefficient: BigInt(
        `${sign === "-" ? "-" : ""}${digits}${"0".repeat(-scale)}`,
      ),
      scale: 0,
    };
  }
  return {
    coefficient: BigInt(`${sign === "-" ? "-" : ""}${digits || "0"}`),
    scale,
  };
}

function normalizeParts(parts: DecimalParts): DecimalParts {
  if (parts.coefficient === 0n) return { coefficient: 0n, scale: 0 };
  let coefficient = parts.coefficient;
  let scale = parts.scale;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function align(
  left: DecimalParts,
  right: DecimalParts,
): [DecimalParts, DecimalParts] {
  const scale = Math.max(left.scale, right.scale);
  return [
    {
      coefficient: left.coefficient * 10n ** BigInt(scale - left.scale),
      scale,
    },
    {
      coefficient: right.coefficient * 10n ** BigInt(scale - right.scale),
      scale,
    },
  ];
}

export function decimal(value: string | number): DecimalString {
  return formatParts(normalizeParts(partsFromValue(value)));
}

function formatParts(parts: DecimalParts): DecimalString {
  const normalized = normalizeParts(parts);
  const negative = normalized.coefficient < 0n;
  const digits = (
    negative ? -normalized.coefficient : normalized.coefficient
  ).toString();
  if (normalized.scale === 0) {
    return `${negative ? "-" : ""}${digits}` as DecimalString;
  }
  const padded = digits.padStart(normalized.scale + 1, "0");
  const split = padded.length - normalized.scale;
  return `${negative ? "-" : ""}${padded.slice(0, split)}.${padded.slice(split)}`.replace(
    /\.0+$/u,
    "",
  ) as DecimalString;
}

export function compareDecimal(
  left: string | number,
  right: string | number,
): -1 | 0 | 1 {
  const [a, b] = align(partsFromValue(left), partsFromValue(right));
  return a.coefficient < b.coefficient
    ? -1
    : a.coefficient > b.coefficient
      ? 1
      : 0;
}

export function addDecimal(...values: Array<string | number>): DecimalString {
  if (values.length === 0) return decimal(0);
  const first = values[0];
  if (first === undefined) return decimal(0);
  return formatParts(
    normalizeParts(
      values.slice(1).reduce<DecimalParts>((total, value) => {
        const [left, right] = align(total, partsFromValue(value));
        return {
          coefficient: left.coefficient + right.coefficient,
          scale: left.scale,
        };
      }, partsFromValue(first)),
    ),
  );
}

export function subtractDecimal(
  left: string | number,
  right: string | number,
): DecimalString {
  const [a, b] = align(partsFromValue(left), partsFromValue(right));
  return formatParts(
    normalizeParts({
      coefficient: a.coefficient - b.coefficient,
      scale: a.scale,
    }),
  );
}

export function multiplyDecimal(
  left: string | number,
  right: string | number,
): DecimalString {
  const a = partsFromValue(left);
  const b = partsFromValue(right);
  return formatParts(
    normalizeParts({
      coefficient: a.coefficient * b.coefficient,
      scale: a.scale + b.scale,
    }),
  );
}

export function averageDecimal(values: Array<string | number>): DecimalString {
  if (values.length === 0)
    throw new AppError(
      "INSUFFICIENT_HISTORY",
      "Cannot average an empty sample.",
    );
  return divideDecimal(addDecimal(...values), values.length);
}

export function divideDecimal(
  value: string | number,
  divisor: number,
  precision = 8,
): DecimalString {
  if (!Number.isInteger(divisor) || divisor === 0) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "Decimal divisor must be a non-zero integer.",
    );
  }
  if (!Number.isInteger(precision) || precision < 0 || precision > 100) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "Decimal precision is outside the supported range.",
    );
  }
  const parts = partsFromValue(value);
  const coefficient =
    (parts.coefficient * 10n ** BigInt(precision)) / BigInt(divisor);
  return formatParts({ coefficient, scale: parts.scale + precision });
}

export function ratioDecimal(
  numerator: string | number,
  denominator: string | number,
  precision = 8,
): DecimalString {
  if (compareDecimal(denominator, 0) === 0) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "Decimal denominator cannot be zero.",
    );
  }
  if (!Number.isInteger(precision) || precision < 0 || precision > 100) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "Decimal precision is outside the supported range.",
    );
  }
  const numeratorParts = partsFromValue(numerator);
  const denominatorParts = partsFromValue(denominator);
  const scaledNumerator =
    numeratorParts.coefficient *
    10n ** BigInt(denominatorParts.scale + precision);
  const scaledDenominator =
    denominatorParts.coefficient * 10n ** BigInt(numeratorParts.scale);
  return formatParts({
    coefficient: scaledNumerator / scaledDenominator,
    scale: precision,
  });
}

export function decimalToNumber(value: string | number): number {
  const parsed = Number(decimal(value));
  if (!Number.isFinite(parsed)) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "Decimal value cannot be represented as a finite number.",
    );
  }
  return parsed;
}

export function percentDifference(
  observed: string | number,
  reference: string | number,
): DecimalString | null {
  if (compareDecimal(reference, 0) === 0) return null;
  return ratioDecimal(subtractDecimal(observed, reference), reference);
}
