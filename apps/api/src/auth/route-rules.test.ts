import 'reflect-metadata';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { loadConfig } from '../config/env.js';
import { PROBLEM_CATALOG } from '../platform/index.js';
import {
  ACC_TAGS,
  M2_OPERATIONS,
  FILES_TAGS,
  LABELS_TAGS,
  REGISTRY_TAGS,
  WAVE1_TAGS,
  WAVE2_NOT_TAGS,
  loadContract,
  loadProblemCodes,
  ruleOf,
} from '../../test/support/contract.js';
import { type DiscoveredRoute, discoverRoutes, toTemplate } from '../../test/support/routes.js';
import { TestPortsModule } from '../../test/support/test-ports.js';

/**
 * Every route of the running application must declare an access rule, and for the routes that are
 * part of the contract the rule must be exactly the one the contract states (`x-permission`,
 * `x-self-service`, `security: []`). Fails the build when a controller route has no declared
 * permission (M1-AUTH-01: "auto-generated role x endpoint matrix test fails if a route has no
 * declared permission"), when an Auth, Access or registry operation of the contract is not
 * implemented, and when an implemented route disagrees with the contract on path, method or
 * success status (M1-PLAT-03 contract test; the e2e `contract.e2e.test.ts` checks the live responses).
 * Needs no database: the Nest container is built but never connects.
 */

async function routesOfApp(): Promise<DiscoveredRoute[]> {
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config, [TestPortsModule])],
  }).compile();
  const routes = discoverRoutes(moduleRef.get(ModulesContainer, { strict: false }));
  await moduleRef.close();
  return routes;
}

describe('route access rules', async () => {
  const routes = await routesOfApp();
  const { operations } = loadContract();
  const byKey = new Map(operations.map((o) => [`${o.method} ${o.path}`, o]));

  it('discovers the application routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(80);
  });

  it('every route declares an access rule', () => {
    const missing = routes
      .filter((r) => !r.rule)
      .map((r) => `${r.method.toUpperCase()} ${r.path} (${r.controller}.${r.handler})`);
    expect(missing).toEqual([]);
  });

  it('every route that is part of the contract declares exactly the contract rule', () => {
    const wrong: string[] = [];
    for (const r of routes) {
      const op = byKey.get(`${r.method} ${toTemplate(r.path)}`);
      if (!op) continue;
      if (JSON.stringify(r.rule) !== JSON.stringify(ruleOf(op))) {
        wrong.push(
          `${op.operationId}: declared ${JSON.stringify(r.rule)}, contract says ${JSON.stringify(ruleOf(op))}`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it('every route outside the contract is a public probe', () => {
    const extra = routes.filter((r) => !byKey.has(`${r.method} ${toTemplate(r.path)}`));
    for (const r of extra) {
      expect(r.rule, `${r.method} ${r.path}`).toEqual({ kind: 'public' });
    }
    // /v1/health and /v1/version are in the contract (System tag); only the orchestrator probes
    // and the contract document itself are outside it.
    expect(extra.map((r) => r.path).sort()).toEqual(['/healthz', '/readyz', '/v1/openapi.json']);
  });

  it('implements every Auth and Access operation of the contract', () => {
    const implemented = new Set(routes.map((r) => `${r.method} ${toTemplate(r.path)}`));
    const missing = operations
      .filter((o) => o.tag === 'Auth' || o.tag === 'Access')
      .filter((o) => !implemented.has(`${o.method} ${o.path}`))
      .map((o) => `${o.method.toUpperCase()} ${o.path} (${o.operationId})`);
    expect(missing).toEqual([]);
  });

  it('implements every operation of the M2 wave-1 tags (locations, people, custody)', () => {
    const implemented = new Set(routes.map((r) => `${r.method} ${toTemplate(r.path)}`));
    const wave1 = operations.filter((o) => WAVE1_TAGS.has(o.tag));
    expect(wave1.length).toBeGreaterThanOrEqual(15);
    const missing = wave1
      .filter((o) => !implemented.has(`${o.method} ${o.path}`))
      .map((o) => `${o.method.toUpperCase()} ${o.path} (${o.operationId})`);
    expect(missing).toEqual([]);
  });

  it('implements every registry operation of the contract (M1-REG and the wave-1 additions)', () => {
    const implemented = new Set(routes.map((r) => `${r.method} ${toTemplate(r.path)}`));
    const registry = operations.filter(
      (o) => REGISTRY_TAGS.has(o.tag) && !M2_OPERATIONS.has(o.operationId),
    );
    expect(registry.length).toBeGreaterThanOrEqual(40);
    const missing = registry
      .filter((o) => !implemented.has(`${o.method} ${o.path}`))
      .map((o) => `${o.method.toUpperCase()} ${o.path} (${o.operationId})`);
    expect(missing).toEqual([]);
    // ... and nothing of M2 sneaks in early without its tables
    for (const id of M2_OPERATIONS) {
      const op = operations.find((o) => o.operationId === id)!;
      expect(implemented.has(`${op.method} ${op.path}`), id).toBe(false);
    }
  });

  // [M2-W2 ACC]: BEGIN
  it('implements every Accessories and Consumables operation of the contract (M2-ACC-01..03)', () => {
    const implemented = new Set(routes.map((r) => `${r.method} ${toTemplate(r.path)}`));
    const stock = operations.filter((o) => ACC_TAGS.has(o.tag));
    expect(stock.length).toBeGreaterThanOrEqual(16);
    const missing = stock
      .filter((o) => !implemented.has(`${o.method} ${o.path}`))
      .map((o) => `${o.method.toUpperCase()} ${o.path} (${o.operationId})`);
    expect(missing).toEqual([]);
  });
  // [M2-W2 ACC]: END

  it('implements every Attachments operation of the contract (M2-FILE-01..03, settings, local file links)', () => {
    const implemented = new Set(routes.map((r) => `${r.method} ${toTemplate(r.path)}`));
    const files = operations.filter((o) => FILES_TAGS.has(o.tag));
    expect(files.length).toBeGreaterThanOrEqual(9);
    const missing = files
      .filter((o) => !implemented.has(`${o.method} ${o.path}`))
      .map((o) => `${o.method.toUpperCase()} ${o.path} (${o.operationId})`);
    expect(missing).toEqual([]);
  });

  it('implements every Labels operation of the contract (M2-TAG-02: templates, calibration, label batches)', () => {
    const implemented = new Set(routes.map((r) => `${r.method} ${toTemplate(r.path)}`));
    const labels = operations.filter((o) => LABELS_TAGS.has(o.tag));
    expect(labels.map((o) => o.operationId).sort()).toEqual([
      'createLabelBatch',
      'getLabelBatch',
      'getLabelTemplate',
      'listLabelBatches',
      'listLabelTemplates',
      'updateLabelTemplate',
    ]);
    const missing = labels
      .filter((o) => !implemented.has(`${o.method} ${o.path}`))
      .map((o) => `${o.method.toUpperCase()} ${o.path} (${o.operationId})`);
    expect(missing).toEqual([]);
  });

  it('implements every operation of the M2 wave-2 tags (repairs, notifications, saved views, exports)', () => {
    const implemented = new Set(routes.map((r) => `${r.method} ${toTemplate(r.path)}`));
    const wave2 = operations.filter((o) => WAVE2_NOT_TAGS.has(o.tag));
    expect(wave2.length).toBeGreaterThanOrEqual(25);
    const missing = wave2
      .filter((o) => !implemented.has(`${o.method} ${o.path}`))
      .map((o) => `${o.method.toUpperCase()} ${o.path} (${o.operationId})`);
    expect(missing).toEqual([]);
  });

  it('every implemented contract route answers its documented success status (path, method, status code)', () => {
    const wrong: string[] = [];
    for (const r of routes) {
      const op = byKey.get(`${r.method} ${toTemplate(r.path)}`);
      if (!op) continue;
      const success = op.statuses.filter((s) => s >= 200 && s < 300);
      if (!success.includes(r.successStatus)) {
        wrong.push(
          `${op.operationId}: handler answers ${r.successStatus}, contract documents ${success.join('/')}`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it('every problem code the API can emit is in the contract catalogue, with a status the contract lists', () => {
    const catalogue = loadProblemCodes();
    const wrong = Object.entries(PROBLEM_CATALOG)
      .filter(([code, v]) => !catalogue[code]?.includes(v.status))
      .map(([code, v]) => `${code} (${v.status})`);
    expect(wrong).toEqual([]);
  });

  it('every route declares each HTTP method once', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${toTemplate(r.path)}`;
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    expect(dupes).toEqual([]);
  });
});
