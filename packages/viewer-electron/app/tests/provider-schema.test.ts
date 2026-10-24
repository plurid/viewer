import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { geminiGenerationSchema } from '../src/desktop/models/provider-schema';
import { chatStepSchema } from '../src/domain/models/chat';

describe('Gemini generation grammar', () => {
  it('keeps Chat types, required fields and unions while leaving limits to local validation', () => {
    const original = z.toJSONSchema(chatStepSchema);
    const before = structuredClone(original);
    const grammar = geminiGenerationSchema(original);
    const properties = grammar.properties as Record<string, Record<string, unknown>>;

    expect(grammar.required).toEqual(original.required);
    expect(grammar.additionalProperties).toBe(false);
    expect(properties.kind).toEqual(original.properties?.kind);
    expect(properties.path).toEqual(original.properties?.path);
    expect(properties.patches).toMatchObject({ type: 'array', items: { type: 'object' } });
    expect(properties.patches).not.toHaveProperty('maxItems');
    expect(properties.renames).not.toHaveProperty('maxItems');
    expect(original).toEqual(before);
    expect(original).toHaveProperty('properties.patches.maxItems', 20);
    expect(original).toHaveProperty('properties.renames.maxItems', 100);
  });

  it('visits schema children without treating property names or literal data as keywords', () => {
    const literal = { maxItems: 37, minItems: 9, $schema: 'literal data' };
    const schema = {
      type: 'object',
      properties: {
        maxItems: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
        minItems: { const: literal },
        $schema: { enum: [literal] },
        nested: {
          anyOf: [
            {
              type: 'array',
              maxItems: 4,
              items: { type: 'array', maxItems: 5, items: { type: 'boolean' } },
            },
            { type: 'null' },
          ],
        },
      },
      additionalProperties: false,
      $defs: { limit: { type: 'array', maxItems: 6, items: { type: 'number' } } },
    };
    const grammar = geminiGenerationSchema(schema);

    expect(grammar).toEqual({
      ...schema,
      properties: {
        ...schema.properties,
        maxItems: { type: 'array', items: { type: 'string' } },
        nested: {
          anyOf: [
            {
              type: 'array',
              items: { type: 'array', items: { type: 'boolean' } },
            },
            { type: 'null' },
          ],
        },
      },
      $defs: { limit: { type: 'array', items: { type: 'number' } } },
    });
  });
});
