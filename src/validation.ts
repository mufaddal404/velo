import { UnprocessableEntityError } from "./errors.js";
import { type Middleware } from "./middleware.js";

export interface ValidationError {
  path: string;
  message: string;
  value: unknown;
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ValidationError[] };

abstract class BaseSchema<T> {
  protected _optional = false;
  protected _rules: ((val: T, path: string) => ValidationError | null)[] = [];

  optional(): BaseSchema<T | undefined> {
    const clone = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    clone._optional = true;
    return clone as BaseSchema<T | undefined>;
  }

  protected abstract _typeCheck(val: unknown, path: string): ValidationError | null;

  parse(val: unknown, path = ""): ValidationResult<T> {
    if (val === undefined || val === null) {
      if (this._optional) return { success: true, data: val as T };
      return { success: false, errors: [{ path, message: "required", value: val }] };
    }

    const typeError = this._typeCheck(val, path);
    if (typeError) return { success: false, errors: [typeError] };

    const typedVal = val as T;
    const errors: ValidationError[] = [];
    for (const rule of this._rules) {
      const err = rule(typedVal, path);
      if (err) errors.push(err);
    }

    if (errors.length > 0) return { success: false, errors };
    return { success: true, data: typedVal };
  }
}

class StringSchema extends BaseSchema<string> {
  protected _typeCheck(val: unknown, path: string) {
    if (typeof val !== "string") return { path, message: "must be a string", value: val };
    return null;
  }

  minLength(n: number) {
    this._rules.push((val, path) => (val.length < n ? { path, message: `must be at least ${n} characters`, value: val } : null));
    return this;
  }

  maxLength(n: number) {
    this._rules.push((val, path) => (val.length > n ? { path, message: `must be at most ${n} characters`, value: val } : null));
    return this;
  }

  length(n: number) {
    this._rules.push((val, path) => (val.length !== n ? { path, message: `must be exactly ${n} characters`, value: val } : null));
    return this;
  }

  email() {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    this._rules.push((val, path) => (!regex.test(val) ? { path, message: "must be a valid email address", value: val } : null));
    return this;
  }

  url() {
    this._rules.push((val, path) => {
      try {
        new URL(val);
        return null;
      } catch (e) {
        return { path, message: "must be a valid URL", value: val };
      }
    });
    return this;
  }

  pattern(regex: RegExp) {
    this._rules.push((val, path) => (!regex.test(val) ? { path, message: "must match pattern", value: val } : null));
    return this;
  }
}

class NumberSchema extends BaseSchema<number> {
  protected _typeCheck(val: unknown, path: string) {
    if (typeof val !== "number" || isNaN(val)) return { path, message: "must be a number", value: val };
    return null;
  }

  min(n: number) {
    this._rules.push((val, path) => (val < n ? { path, message: `must be at least ${n}`, value: val } : null));
    return this;
  }

  max(n: number) {
    this._rules.push((val, path) => (val > n ? { path, message: `must be at most ${n}`, value: val } : null));
    return this;
  }

  integer() {
    this._rules.push((val, path) => (!Number.isInteger(val) ? { path, message: "must be an integer", value: val } : null));
    return this;
  }

  positive() {
    this._rules.push((val, path) => (val <= 0 ? { path, message: "must be positive", value: val } : null));
    return this;
  }
}

class BooleanSchema extends BaseSchema<boolean> {
  protected _typeCheck(val: unknown, path: string) {
    if (typeof val !== "boolean") return { path, message: "must be a boolean", value: val };
    return null;
  }
}

class ArraySchema<T> extends BaseSchema<T[]> {
  constructor(private itemSchema: BaseSchema<T>) {
    super();
  }

  protected _typeCheck(val: unknown, path: string) {
    if (!Array.isArray(val)) return { path, message: "must be an array", value: val };
    return null;
  }

  minItems(n: number) {
    this._rules.push((val, path) => (val.length < n ? { path, message: `must have at least ${n} items`, value: val } : null));
    return this;
  }

  maxItems(n: number) {
    this._rules.push((val, path) => (val.length > n ? { path, message: `must have at most ${n} items`, value: val } : null));
    return this;
  }

  parse(val: unknown, path = ""): ValidationResult<T[]> {
    const base = super.parse(val, path);
    if (!base.success) return base;
    if (val === undefined || val === null) return base;

    const arr = val as unknown[];
    const errors: ValidationError[] = [];
    const data: T[] = [];
    for (let i = 0; i < arr.length; i++) {
      const res = this.itemSchema.parse(arr[i], `${path}[${i}]`);
      if (res.success) {
        data.push(res.data);
      } else {
        errors.push(...res.errors);
      }
    }

    if (errors.length > 0) return { success: false, errors };
    return { success: true, data };
  }
}

type Unwrap<T> = T extends BaseSchema<infer U> ? U : never;

type ObjectShape = Record<string, BaseSchema<any>>;

type ObjectOutput<T extends ObjectShape> = {
  [K in keyof T as undefined extends Unwrap<T[K]> ? never : K]: Unwrap<T[K]>;
} & {
  [K in keyof T as undefined extends Unwrap<T[K]> ? K : never]?: Unwrap<T[K]>;
};

class ObjectSchema<T extends ObjectShape> extends BaseSchema<ObjectOutput<T>> {
  constructor(private shape: T) {
    super();
  }

  protected _typeCheck(val: unknown, path: string) {
    if (typeof val !== "object" || val === null || Array.isArray(val)) return { path, message: "must be an object", value: val };
    return null;
  }

  parse(val: unknown, path = ""): ValidationResult<ObjectOutput<T>> {
    const base = super.parse(val, path);
    if (!base.success) return base as ValidationResult<ObjectOutput<T>>;
    if (val === undefined || val === null) return base as ValidationResult<ObjectOutput<T>>;

    const obj = val as Record<string, unknown>;
    const errors: ValidationError[] = [];
    const data = {} as Record<string, unknown>;

    for (const key in this.shape) {
      const res = this.shape[key].parse(obj[key], path ? `${path}.${key}` : key);
      if (res.success) {
        data[key] = res.data;
      } else {
        errors.push(...res.errors);
      }
    }

    if (errors.length > 0) return { success: false, errors };
    return { success: true, data: data as ObjectOutput<T> };
  }
}

class EnumSchema<T> extends BaseSchema<T> {
  constructor(private values: T[]) {
    super();
  }

  protected _typeCheck(val: unknown, path: string) {
    if (!this.values.includes(val as T)) return { path, message: `must be one of: ${this.values.join(", ")}`, value: val };
    return null;
  }
}

export const v = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BooleanSchema(),
  array: <T>(itemSchema: BaseSchema<T>) => new ArraySchema(itemSchema),
  object: <T extends ObjectShape>(shape: T) => new ObjectSchema(shape),
  enum: <T>(values: T[]) => new EnumSchema(values),
};

export function validate<L extends Record<string, unknown> = Record<string, unknown>>(schemas: { 
  body?: BaseSchema<any>; 
  query?: BaseSchema<any>; 
  params?: BaseSchema<any> 
}): Middleware<L> {
  return async (ctx, next) => {
    const errors: ValidationError[] = [];
    const validated: Record<string, unknown> = {};

    if (schemas.body) {
      const body = await ctx.req.json();
      const res = schemas.body.parse(body, "body");
      if (res.success) validated.body = res.data;
      else errors.push(...res.errors);
    }

    if (schemas.query) {
      const res = schemas.query.parse(ctx.req.query, "query");
      if (res.success) validated.query = res.data;
      else errors.push(...res.errors);
    }

    if (schemas.params) {
      const res = schemas.params.parse(ctx.req.params, "params");
      if (res.success) validated.params = res.data;
      else errors.push(...res.errors);
    }

    if (errors.length > 0) {
      throw new UnprocessableEntityError("Validation failed", errors.map(e => ({ path: e.path.replace(/^(body|query|params)\.?/, ""), message: e.message })));
    }

    ctx.req.locals.validated = validated;
    await next();
  };
}
