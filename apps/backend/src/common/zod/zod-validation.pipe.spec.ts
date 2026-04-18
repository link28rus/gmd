import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

const Schema = z.object({ email: z.string().email() });
const pipe = new ZodValidationPipe(Schema);

describe('ZodValidationPipe', () => {
  it('пропускает валидный объект', () => {
    expect(pipe.transform({ email: 'a@b.com' })).toEqual({ email: 'a@b.com' });
  });

  it('бросает BadRequestException с code=bad_request и details на ошибке', () => {
    try {
      pipe.transform({ email: 'not-email' });
      fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const resp = (e as BadRequestException).getResponse() as {
        code: string;
        details: Array<{ path: (string | number)[] }>;
      };
      expect(resp.code).toBe('bad_request');
      expect(Array.isArray(resp.details)).toBe(true);
      expect(resp.details[0].path).toEqual(['email']);
    }
  });
});
