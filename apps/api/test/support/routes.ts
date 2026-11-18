import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { UNVERSIONED_ROUTES } from '../../src/app.js';
import { ACCESS_RULE_KEY, type AccessRule } from '../../src/auth/access.js';

const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'all', 'options', 'head'];

export interface DiscoveredRoute {
  method: string;
  /** Nest path with the global prefix, e.g. `/v1/users/:id`. */
  path: string;
  controller: string;
  handler: string;
  rule: AccessRule | undefined;
  /** The status Nest answers with on success (`@HttpCode`, else 201 for POST and 200 otherwise). */
  successStatus: number;
}

/** Every controller route of a built Nest container (HTTP routes only), with its declared access rule. */
export function discoverRoutes(modules: ModulesContainer): DiscoveredRoute[] {
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
        const verb = METHODS[Number(method)] ?? String(method);
        routes.push({
          method: verb,
          path: unversioned ? joined : `/v1${joined === '/' ? '' : joined}`,
          controller: cls.name,
          handler: name,
          rule:
            Reflect.getMetadata(ACCESS_RULE_KEY, handler) ??
            Reflect.getMetadata(ACCESS_RULE_KEY, cls),
          successStatus:
            (Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined) ??
            (verb === 'post' ? 201 : 200),
        });
      }
    }
  }
  return routes;
}

/** `/v1/users/:id` -> `/v1/users/{id}`. */
export const toTemplate = (path: string) => path.replace(/:([A-Za-z_]+)/g, '{$1}');
