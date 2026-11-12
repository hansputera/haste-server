import fs from 'node:fs';
import path from 'node:path';

// Validate the invariants of `openapi.json` that actually drift: the version,
// unique operation ids and every `$ref` resolving. No schema-validation
// dependency is pulled in for that.

const specPath = path.join(process.cwd(), 'openapi.json');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

const problems = [];

if (typeof spec.openapi !== 'string' || !spec.openapi.startsWith('3.1')) {
  problems.push(`openapi must be 3.1.x, got ${String(spec.openapi)}`);
}

// `${name}`-style path templates need a matching parameter declaration.
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'head', 'patch', 'options', 'trace']);

const operationIds = new Set();
const refs = [];

const resolve = (ref) =>
  ref
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((node, part) => (node == null ? undefined : node[part]), spec);

// Path parameters may be declared inline or as a `$ref` to
// `components.parameters`.
const parameterName = (param) => (param?.$ref ? resolve(param.$ref)?.name : param?.name);

for (const [route, item] of Object.entries(spec.paths ?? {})) {
  const params = new Set((item.parameters ?? []).map(parameterName));
  for (const [, name] of route.matchAll(/\{([^}]+)\}/g)) {
    if (!params.has(name)) problems.push(`${route}: no parameter declared for {${name}}`);
  }

  for (const [method, operation] of Object.entries(item)) {
    if (!HTTP_METHODS.has(method)) continue;

    const operationId = operation.operationId;
    if (!operationId) {
      problems.push(`${method.toUpperCase()} ${route}: missing operationId`);
    } else if (operationIds.has(operationId)) {
      problems.push(`${method.toUpperCase()} ${route}: duplicate operationId ${operationId}`);
    } else {
      operationIds.add(operationId);
    }
  }

  const collect = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') refs.push(value);
      else collect(value);
    }
  };
  collect(item);
}

for (const ref of refs) {
  if (!ref.startsWith('#/')) {
    problems.push(`external ref not allowed: ${ref}`);
    continue;
  }
  if (resolve(ref) === undefined) problems.push(`unresolved ref: ${ref}`);
}

if (problems.length) {
  for (const problem of problems) process.stderr.write(`check-openapi: ${problem}\n`);
  process.exit(1);
}

process.stdout.write(`check-openapi: ok (${operationIds.size} operations, ${refs.length} refs)\n`);
