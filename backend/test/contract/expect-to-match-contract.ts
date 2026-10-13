import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'supertest';
import { parse } from 'yaml';

/**
 * Validates a response against contracts/openapi.yaml (research R7, FR-031).
 *
 * Fails when the operation does not declare the returned status, or when the body does not
 * match that status's schema. The contract is the source of truth: never loosen it here.
 */
export const CONTRACT_PATH = join(__dirname, '../../../contracts/openapi.yaml');

// The contract is untyped YAML; this helper walks it by JSON pointer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
export const contract: Json = parse(readFileSync(CONTRACT_PATH, 'utf8'));

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export interface ContractOperation {
  operationId: string;
  method: string;
  path: string;
  requiredRoles: 'public' | string[];
  pointer: string;
  /**
   * The feature that declared the operation ahead of its implementation (`x-planned`), or
   * `undefined` once it is implemented. See the contract's `info` description.
   */
  planned?: string;
}

const escape = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1');

export const operations: ContractOperation[] = Object.entries(contract.paths as Json).flatMap(
  ([path, item]) =>
    METHODS.filter((m) => item[m]).map((method) => ({
      operationId: item[method].operationId as string,
      method: method.toUpperCase(),
      path,
      requiredRoles: item[method]['x-required-roles'],
      pointer: `#/paths/${escape(path)}/${method}`,
      planned: item[method]['x-planned'],
    })),
);

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(contract, 'openapi');

function resolve(pointer: string): Json {
  return pointer
    .slice(2)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<Json>((node, key) => node?.[key], contract);
}

export function expectToMatchContract(res: Response, operationId: string): void {
  const op = operations.find((o) => o.operationId === operationId);
  if (!op) throw new Error(`Contract has no operation '${operationId}'`);

  const status = String(res.status);
  let responsePointer = `${op.pointer}/responses/${status}`;
  let response = resolve(responsePointer);
  if (!response) {
    throw new Error(
      `${operationId} returned ${status}, which the contract does not declare. ` +
        `Declared: ${Object.keys(resolve(`${op.pointer}/responses`)).join(', ')}. Body: ${JSON.stringify(res.body)}`,
    );
  }
  if (typeof response.$ref === 'string') {
    responsePointer = response.$ref;
    response = resolve(responsePointer);
  }

  if (!response.content) {
    if (res.text)
      throw new Error(`${operationId} ${status} must have an empty body, got: ${res.text}`);
    return;
  }

  const schemaPointer = `${responsePointer}/content/${escape('application/json')}/schema`;
  const validate = ajv.getSchema(`openapi${schemaPointer}`);
  if (!validate) throw new Error(`Cannot compile schema at ${schemaPointer}`);
  if (!validate(res.body)) {
    throw new Error(
      `${operationId} ${status} body does not match the contract:\n` +
        `${ajv.errorsText(validate.errors, { separator: '\n' })}\nBody: ${JSON.stringify(res.body, null, 2)}`,
    );
  }
}
