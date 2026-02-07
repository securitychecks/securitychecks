import { describe, it, expect } from 'vitest';
import {
  ALL_INVARIANTS,
  P0_INVARIANTS,
  P1_INVARIANTS,
  getInvariantById,
  getInvariantsByCategory,
  AUTHZ_SERVICE_LAYER_ENFORCED,
  WEBHOOK_IDEMPOTENT,
} from '../src/invariants.js';

describe('invariants', () => {
  describe('ALL_INVARIANTS', () => {
    it('should have at least 16 invariants', () => {
      // Pattern library continues to grow - use minimum threshold
      expect(ALL_INVARIANTS.length).toBeGreaterThanOrEqual(16);
    });

    it('should have unique IDs', () => {
      const ids = ALL_INVARIANTS.map((i) => i.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should all have required fields', () => {
      for (const invariant of ALL_INVARIANTS) {
        expect(invariant.id).toBeTruthy();
        expect(invariant.name).toBeTruthy();
        expect(invariant.description).toBeTruthy();
        expect(invariant.severity).toMatch(/^P[012]$/);
        expect(invariant.category).toBeTruthy();
        expect(invariant.requiredProof).toBeTruthy();
      }
    });
  });

  describe('P0_INVARIANTS', () => {
    it('should have at least 10 P0 invariants', () => {
      // Pattern library continues to grow - use minimum threshold
      expect(P0_INVARIANTS.length).toBeGreaterThanOrEqual(10);
    });

    it('should all have severity P0', () => {
      for (const invariant of P0_INVARIANTS) {
        expect(invariant.severity).toBe('P0');
      }
    });

    it('should include critical security invariants', () => {
      const ids = P0_INVARIANTS.map((i) => i.id);
      expect(ids).toContain('AUTHZ.SERVICE_LAYER.ENFORCED');
      expect(ids).toContain('WEBHOOK.IDEMPOTENT');
      expect(ids).toContain('TRANSACTION.POST_COMMIT.SIDE_EFFECTS');
    });
  });

  describe('P1_INVARIANTS', () => {
    it('should have at least 6 P1 invariants', () => {
      // Pattern library continues to grow - use minimum threshold
      expect(P1_INVARIANTS.length).toBeGreaterThanOrEqual(6);
    });

    it('should all have severity P1', () => {
      for (const invariant of P1_INVARIANTS) {
        expect(invariant.severity).toBe('P1');
      }
    });
  });

  describe('getInvariantById', () => {
    it('should return invariant by ID', () => {
      const result = getInvariantById('AUTHZ.SERVICE_LAYER.ENFORCED');
      expect(result).toBe(AUTHZ_SERVICE_LAYER_ENFORCED);
    });

    it('should return undefined for unknown ID', () => {
      const result = getInvariantById('UNKNOWN.INVARIANT');
      expect(result).toBeUndefined();
    });
  });

  describe('getInvariantsByCategory', () => {
    it('should return authz invariants', () => {
      const result = getInvariantsByCategory('authz');
      expect(result.length).toBeGreaterThan(0);
      for (const invariant of result) {
        expect(invariant.category).toBe('authz');
      }
    });

    it('should return webhooks invariants', () => {
      const result = getInvariantsByCategory('webhooks');
      expect(result.length).toBeGreaterThan(1);
      expect(result).toContain(WEBHOOK_IDEMPOTENT);
    });

    it('should return dataflow invariants', () => {
      const result = getInvariantsByCategory('dataflow');
      expect(result.length).toBeGreaterThan(0);
      for (const invariant of result) {
        expect(invariant.category).toBe('dataflow');
      }
    });

    it('should return empty array for unknown category', () => {
      const result = getInvariantsByCategory('unknown' as any);
      expect(result).toHaveLength(0);
    });
  });
});
