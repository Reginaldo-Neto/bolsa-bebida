import { uuidv7 } from 'uuidv7';

/**
 * UUID v7 (spec 9). The timestamp prefix keeps inserts at the end of the
 * B-tree, which matters for price_ticks and audit_log: both grow fast during
 * an event and are always read in time order.
 */
export function newId(): string {
  return uuidv7();
}
