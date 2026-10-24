const schemaMaps = new Set(['properties', 'patternProperties', '$defs', 'definitions']);
const schemaLists = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems']);
const schemaChildren = new Set([
  'items',
  'additionalProperties',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
]);

/**
 * Array bounds multiply Gemini's constrained-decoding states and can make an
 * otherwise valid Chat schema fail with INVALID_ARGUMENT. Omit these bounds
 * from its generation grammar only. Every consumer still validates the full
 * original schema locally, before interpreting a tool call or proposal.
 */
export function geminiGenerationSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const visit = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, child]) => {
        if (key === '$schema' || key === 'minItems' || key === 'maxItems') return [];
        if (schemaMaps.has(key) && child && typeof child === 'object' && !Array.isArray(child))
          return [
            [
              key,
              Object.fromEntries(Object.entries(child).map(([name, item]) => [name, visit(item)])),
            ],
          ];
        if (schemaLists.has(key) && Array.isArray(child)) return [[key, child.map(visit)]];
        return [[key, schemaChildren.has(key) ? visit(child) : child]];
      }),
    );
  };
  return visit(schema) as Record<string, unknown>;
}
