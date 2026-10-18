import { z } from 'zod';

// Valores monetários e preços circulam como strings decimais, para não perder precisão.
export const Decimal = z.string().describe('Valor decimal em texto, ex.: "1234.50"');
export const NullableDecimal = Decimal.nullable();
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data AAAA-MM-DD');
export const Id = z.coerce.number().int().positive();

/** Decimal positivo de entrada: aceita "150.5" ou 150.5; devolve string. */
export const PositiveDecimalInput = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,12}(\.\d{1,6})?$/.test(v) && Number(v) > 0, 'deve ser um número positivo com até 6 casas decimais');

export const ErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.any().optional() }),
});

export const User = z.object({ id: z.number(), email: z.string(), name: z.string(), isAdmin: z.boolean() });

export const InstrumentStatus = z.enum(['pending', 'active', 'invalid']);

export const LatestQuote = z.object({
  date: IsoDate,
  close: Decimal,
  volume: z.number().nullable().describe('Volume da última sessão'),
  previousDate: IsoDate.nullable(),
  previousClose: NullableDecimal,
  changePct: NullableDecimal,
});

export const InstrumentSummary = z.object({
  id: z.number(),
  symbol: z.string(),
  name: z.string().nullable(),
  exchange: z.string().nullable(),
  currency: z.string().nullable(),
  status: InstrumentStatus,
  statusReason: z.string().nullable(),
  firstSession: IsoDate.nullable(),
  lastSession: IsoDate.nullable(),
  inWatchlist: z.boolean(),
  latest: LatestQuote.nullable(),
});

export const Pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const Trade = z.object({
  id: z.number(), instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(),
  side: z.enum(['buy', 'sell']), quantity: z.number(), price: Decimal, amount: Decimal, currency: z.string(),
  quoteDate: IsoDate, realizedPnl: NullableDecimal, requestedAt: z.string(),
});

export const AlertKind = z.enum(['close_above', 'close_below', 'change_up', 'change_down']);

export const AlertRule = z.object({
  id: z.number(), instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(),
  currency: z.string().nullable(), kind: AlertKind, threshold: Decimal, active: z.boolean(),
  lastEvaluatedSession: IsoDate.nullable(), lastEventSession: IsoDate.nullable(), lastSentAt: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string(),
});
