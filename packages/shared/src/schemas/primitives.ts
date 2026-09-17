import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const centsSchema = z
  .number()
  .int('deve ser um numero inteiro de centimos')
  .min(0, 'nao pode ser negativo');

export const positiveCentsSchema = centsSchema.min(1, 'deve ser maior que zero');

export const quantitySchema = z.number().int().min(1).max(99);

export const nicknameSchema = z
  .string()
  .trim()
  .min(2, 'minimo 2 caracteres')
  .max(20, 'maximo 20 caracteres')
  .regex(/^[\p{L}\p{N} _.-]+$/u, 'apenas letras, numeros, espaco, ponto, hifen ou underscore');

export const teamCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2)
  .max(12)
  .regex(/^[A-Z0-9-]+$/, 'apenas letras maiusculas, numeros e hifen');

export const shortCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(6)
  .regex(/^[A-HJ-NP-Z2-9]{6}$/, 'codigo invalido');

export const idempotencyKeySchema = z.string().trim().min(8).max(128);

/** Portuguese mobile number, the only kind MB WAY accepts. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s.-]/g, ''))
  .pipe(
    z
      .string()
      .regex(/^(\+351)?9[1236]\d{7}$/, 'numero de telemovel portugues invalido')
      .transform((value) => (value.startsWith('+351') ? value : `+351${value}`)),
  );

export function isValidNif(value: string): boolean {
  if (!/^\d{9}$/.test(value)) {
    return false;
  }
  const digits = [...value].map(Number) as number[];
  const first = digits[0];
  if (first === undefined || ![1, 2, 3, 5, 6, 8, 9].includes(first)) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < 8; i += 1) {
    sum += (digits[i] ?? 0) * (9 - i);
  }
  const remainder = sum % 11;
  const checkDigit = remainder < 2 ? 0 : 11 - remainder;
  return checkDigit === digits[8];
}

/** L6: the NIF is optional at checkout, but must be valid when supplied. */
export const nifSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s/g, ''))
  .refine(isValidNif, 'NIF invalido');

export const localeSchema = z.enum(['pt-PT', 'en']);

export const isoDateTimeSchema = z.string().datetime({ offset: true });
