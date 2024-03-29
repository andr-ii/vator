import { OptionalityByKey } from './enums';
import { ValidationError } from './error';
import { ArraySchema, LiteralSchema, ObjectSchema, PrimitivesSchema } from './schema';
import { ValidationSchema, ValidationResult, Values, ArraySchemaType, ValidatorOptions } from './types';

const pickValidator =
  ({ schema, parentKeys, key }: Omit<ValidatorOptions<ValidationSchema | Values>, 'value'>) =>
  (value: unknown) => {
    return schema instanceof PrimitivesSchema
      ? validateBasic({ value, schema, key, parentKeys })
      : schema instanceof ArraySchema
        ? validateArray({ value, schema, parentKeys })
        : schema instanceof ObjectSchema
          ? validateObject({ value, schema, parentKeys })
          : schema instanceof LiteralSchema
            ? validateBasic({ value, schema, key, parentKeys })
            : validateObject({ value, schema, parentKeys });
  };

function validateObject({
  value: obj,
  schema,
  parentKeys = [],
}: Omit<ValidatorOptions<ValidationSchema | Values>, 'key'>): unknown {
  if (schema instanceof ObjectSchema) {
    const optional = checkOptionality(schema, obj);
    if (optional) return optional.value;

    return validateObject({ schema: schema.schema, value: obj, parentKeys });
  }

  const received = typeof obj;

  if (received !== 'object' || obj === null) {
    throw new ValidationError({ expected: 'object', received, parentKeys });
  }

  const object = obj as Record<string, unknown>;
  const validationSchema = Object.entries(schema as ValidationSchema);

  for (let i = 0; i < validationSchema.length; i++) {
    const [key, valueSchema] = validationSchema[i];
    const value = object[key];
    const expected = valueSchema.type;

    const optional = checkOptionality(valueSchema, value);
    if (optional) continue;

    if (value == null && expected !== 'unknown') {
      throw new ValidationError({
        key,
        expected,
        received: 'missing',
        parentKeys,
      });
    }

    const validator = pickValidator({
      key,
      schema: valueSchema,
      parentKeys: [...parentKeys, key],
    });

    object[key] = validator(value);
  }

  return object;
}

function validateArray({ schema, value: arr, parentKeys }: Omit<ValidatorOptions<ArraySchemaType>, 'key'>) {
  const optional = checkOptionality(schema, arr);
  if (optional) return optional.value;

  if (!Array.isArray(arr)) {
    throw new ValidationError({
      key: 'single value',
      parentKeys,
      expected: 'array',
      received: typeof arr,
    });
  }

  const schemaType = schema.values;

  for (let i = 0; i < arr.length; i++) {
    const validator = pickValidator({
      schema: schemaType,
      parentKeys,
      key: 'array item',
    });
    arr[i] = validator(arr[i]);
  }

  return arr;
}

function validateBasic({ schema, value: item, key, parentKeys }: ValidatorOptions<Values>) {
  const optional = checkOptionality(schema, item);
  if (optional) return optional.value;

  key = key ?? 'single value';
  parentKeys = parentKeys?.filter((i) => i !== key);
  const received =
    item === null ? 'null' : Array.isArray(item) ? 'array' : item instanceof Date ? 'Date' : typeof item;

  if (schema.type === 'literal') {
    if (typeof item !== 'string') {
      throw new ValidationError({
        key,
        expected: 'string',
        received,
        parentKeys,
      });
    }

    if (!schema.literals.includes(item)) {
      throw new ValidationError({
        key,
        expected: schema.literals.join(' | '),
        received: item,
        parentKeys,
      });
    }

    return item;
  }

  if (schema.type === 'Date') {
    const seconds =
      typeof item === 'string' ? Date.parse(String(item)) : typeof item === 'number' ? item : NaN;

    if (Number.isNaN(seconds)) {
      throw new ValidationError({
        key,
        expected: 'Date',
        received,
        parentKeys,
        convertFailed: true,
      });
    }

    return new Date(seconds);
  }

  const expected =
    schema.optionality !== 'required'
      ? `${schema.type} | ${OptionalityByKey[schema.optionality]}`
      : schema.type;

  if (received !== schema.type && schema.type !== 'unknown') {
    throw new ValidationError({
      key,
      expected,
      received,
      parentKeys,
    });
  }

  return item;
}

function checkOptionality(schema: ValidatorOptions<Values>['schema'], value: unknown) {
  if (schema.optionality === 'required') return;

  const condition =
    (schema.optionality === 'optional' && value === undefined) ||
    (schema.optionality === 'nullable' && value === null) ||
    (schema.optionality === 'maybe' && value == null);

  return condition ? { value } : undefined;
}

/**
 * A function which creates valid `schema` for validation and `ResultType`.
 * `ResultType` is an empty object, should be used as `typeof ResultType` only!
 *
 * @param schema ValidationSchema object which the `data` will be check against with
 */
export function buildSchema<S extends ValidationSchema | Values>(schema: S) {
  return { schema, ResultType: {} as ValidationResult<S> };
}

export function validate<S extends ValidationSchema | Values>(
  data: unknown,
  schema: S,
  errorMessage?: string,
): asserts data is ValidationResult<S> {
  try {
    const validator = pickValidator({ schema });
    validator(data);
  } catch (error) {
    if (errorMessage) {
      throw new ValidationError({
        customMessage: errorMessage,
        expected: '',
        received: '',
      });
    }

    throw error;
  }
}
