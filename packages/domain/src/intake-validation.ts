/** Supported clinic-authored intake schema. Unknown constraints fail closed. */
export function validateIntakeTemplateSchema(
  schema: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  if (
    Object.keys(schema).some(
      (key) =>
        ![
          "type",
          "title",
          "description",
          "properties",
          "required",
          "additionalProperties",
          "fields"
        ].includes(key)
    )
  )
    throw new RangeError("This intake schema uses unsupported constraints.");
  if (schema.type !== undefined && schema.type !== "object")
    throw new RangeError("Intake must be a record of named fields.");
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false)
    throw new RangeError("Intake templates cannot allow unlisted fields.");
  let properties: Record<string, Record<string, unknown>>;
  if (Array.isArray(schema.fields)) {
    if (
      schema.properties !== undefined ||
      !schema.fields.every((key) => typeof key === "string") ||
      new Set(schema.fields).size !== schema.fields.length
    )
      throw new RangeError("Invalid intake field list.");
    properties = Object.fromEntries(schema.fields.map((key) => [key, { type: "string" }]));
  } else {
    if (!object(schema.properties)) throw new RangeError("Add at least one intake field.");
    properties = schema.properties as Record<string, Record<string, unknown>>;
  }
  const keys = Object.keys(properties);
  if (
    !keys.length ||
    keys.length > 50 ||
    keys.some(
      (key) =>
        !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) ||
        ["constructor", "prototype", "__proto__"].includes(key)
    )
  )
    throw new RangeError("Use 1–50 uniquely named intake fields.");
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) ||
      schema.required.some((key) => typeof key !== "string" || !Object.hasOwn(properties, key)))
  )
    throw new RangeError("Required intake fields must be listed in the template.");
  for (const field of Object.values(properties)) {
    if (
      !object(field) ||
      !["string", "boolean", "number", "integer"].includes(String(field.type)) ||
      Object.keys(field).some(
        (key) =>
          ![
            "type",
            "title",
            "description",
            "enum",
            "minLength",
            "maxLength",
            "minimum",
            "maximum"
          ].includes(key)
      )
    )
      throw new RangeError("An intake field uses an unsupported type or constraint.");
    if (
      field.enum !== undefined &&
      (field.type !== "string" ||
        !Array.isArray(field.enum) ||
        !field.enum.length ||
        field.enum.length > 50 ||
        field.enum.some(
          (value) => typeof value !== "string" || !value.trim() || value.length > 200
        ))
    )
      throw new RangeError("Choices must contain 1–50 nonempty text options.");
    for (const key of ["minLength", "maxLength", "minimum", "maximum"])
      if (
        field[key] !== undefined &&
        (typeof field[key] !== "number" ||
          !Number.isFinite(field[key]) ||
          (key.endsWith("Length") &&
            (!Number.isSafeInteger(field[key]) ||
              Number(field[key]) < 0 ||
              Number(field[key]) > 10000)))
      )
        throw new RangeError("Invalid intake field bounds.");
    if (
      Number(field.minLength ?? 0) > Number(field.maxLength ?? 10000) ||
      Number(field.minimum ?? -Infinity) > Number(field.maximum ?? Infinity)
    )
      throw new RangeError("Intake field bounds are reversed.");
  }
  return properties;
}
export function validateIntakeResponses(
  schema: Record<string, unknown>,
  responses: Record<string, unknown>
): void {
  const properties = validateIntakeTemplateSchema(schema);
  if (Object.keys(responses).some((key) => !Object.hasOwn(properties, key)))
    throw new RangeError("The response contains a field absent from this template.");
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  for (const [key, field] of Object.entries(properties)) {
    const value = responses[key];
    if (value === undefined) {
      if (required.has(key)) throw new RangeError(`${key} is required.`);
      continue;
    }
    if (field.type === "string") {
      if (
        typeof value !== "string" ||
        value.length > Number(field.maxLength ?? 10000) ||
        value.length < Number(field.minLength ?? 0) ||
        (required.has(key) && !value.trim()) ||
        (Array.isArray(field.enum) && !field.enum.includes(value))
      )
        throw new RangeError(`Enter a valid ${key}.`);
    } else if (field.type === "boolean") {
      if (typeof value !== "boolean") throw new RangeError(`Choose yes or no for ${key}.`);
    } else if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (field.type === "integer" && !Number.isSafeInteger(value)) ||
      value < Number(field.minimum ?? -Infinity) ||
      value > Number(field.maximum ?? Infinity)
    )
      throw new RangeError(`Enter a valid ${key}.`);
  }
}
