import { BadRequestException } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { ZodError } from 'zod';
import type { ZodSchema } from 'zod';

export class ZodValidationPipe<T extends ZodSchema> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): unknown {
    try {
      return this.schema.parse(value);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException({
          code: 'bad_request',
          message: 'Validation failed',
          details: e.errors.map((err) => ({ path: err.path, message: err.message })),
        });
      }
      throw e;
    }
  }
}
