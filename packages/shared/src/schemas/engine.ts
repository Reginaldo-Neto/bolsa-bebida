import { z } from 'zod';
import { DEFAULT_ENGINE_PARAMS } from '../constants';

/**
 * Spec 5.2. The bounds are guard rails for the admin panel: outside them the
 * engine stops being a market and starts being a random number generator.
 */
export const engineParamsSchema = z.object({
  tickSeconds: z.number().int().min(10).max(3600).default(DEFAULT_ENGINE_PARAMS.tickSeconds),
  ewmaLambda: z.number().min(0).max(1).default(DEFAULT_ENGINE_PARAMS.ewmaLambda),
  demandSensitivity: z.number().min(0).max(1).default(DEFAULT_ENGINE_PARAMS.demandSensitivity),
  meanReversion: z.number().min(0).max(1).default(DEFAULT_ENGINE_PARAMS.meanReversion),
  stockPressure: z.number().min(0).max(1).default(DEFAULT_ENGINE_PARAMS.stockPressure),
  lowStockThreshold: z.number().min(0).max(1).default(DEFAULT_ENGINE_PARAMS.lowStockThreshold),
  maxStepPct: z.number().min(0).max(0.5).default(DEFAULT_ENGINE_PARAMS.maxStepPct),
  roundingCents: z.number().int().min(1).max(100).default(DEFAULT_ENGINE_PARAMS.roundingCents),
  renormalize: z.boolean().default(DEFAULT_ENGINE_PARAMS.renormalize),
});

export type EngineParamsInput = z.input<typeof engineParamsSchema>;

export const engineParamsPatchSchema = engineParamsSchema.partial();

export function parseEngineParams(input: unknown) {
  return engineParamsSchema.parse(input ?? {});
}
