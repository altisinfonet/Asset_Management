import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { UNVERSIONED_ROUTES } from '../app.js';
import { loadConfig } from '../config/env.js';
import { loadContract, ruleOf } from '../../test/support/contract.js';
import { TestPortsModule } from '../../test/support/test-ports.js';
import { ACCESS_RULE_KEY, type AccessRule } from './access.js';

/**
 * Every route of the running application must declare an access rule, and for the routes that are
 * part of the contract the rule must be exactly the one the contract states (`x-permission`,
 * `x-self-service`, `security: []`). Fails the build when a controller route has no declared
 * permission (M1-AUTH-01: "auto-generated role x endpoint matrix test fails if a route has no
 * declared permission"), and when an auth or access operation of the contract is not implemented.
 * Needs no database: the Nest container is built but never connects.
 */

const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'all', 'options', 'head'];

interface DiscoveredRoute {
  method: string;
  path: string; // e.g. /v1/users/:id
  controller: string;
  handler: string;
  rule: AccessRule | undefined;
}

async function discoverRoutes(): Promise<DiscoveredRoute[]> {
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config, [TestPortsModule])],
  }).compile();
  const modules = moduleRef.get(ModulesContainer, { strict: false });
  const routes: DiscoveredRoute[] = [];
  for (const mod of modules.values()) {
    for (const wrapper of mod.controllers.values()) {
      const cls = wrapper.metatype as (abstract new () => object) | null;
      if (!cls) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '/');
      const proto = cls.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '/');
        const joined = `/${[base, sub].join('/')}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
        const unversioned = UNVERSIONED_ROUTES.some((r) => joined === `/${r}`);
        routes.push({
          method: METHODS[Number(method)] ?? String(method),
          path: unversioned ? joined : `/v1${joined === '/' ? '' : joined}`,
          controller: cls.name,
          handler: name,
          rule:
            Reflect.getMetadata(ACCESS_RULE_KEY, handler) ??
            Reflect.getMetadata(ACCESS_RULE_KEY, cls),
        });
      }
    }
  }
  await moduleRef.close();
  return routes;
}

const toTemplate = (path: string) => path.replace(/:([A-Za-z_]+)/g, '{$1}');

describe('route access rules', async () => {
  const routes = await discoverRoutes();
  const { operations } = loadContract();
  const byKey = new Map(operations.map((o) => [`${o.method} ${o.path}`, o]));

  it('discovers the application routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(33);
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
    expect(extra.map((r) => r.path).sort()).toEqual([
      '/healthz',
      '/readyz',
      '/v1/health',
      '/v1/version',
    ]);
  });

  it('implements every Auth and Access operation of the contract', () => {
    const implemented = new Set(routes.map((r) => `${r.method} ${toTemplate(r.path)}`));
    const missing = operations
      .filter((o) => o.tag === 'Auth' || o.tag === 'Access')
      .filter((o) => !implemented.has(`${o.method} ${o.path}`))
      .map((o) => `${o.method.toUpperCase()} ${o.path} (${o.operationId})`);
    expect(missing).toEqual([]);
  });
});
