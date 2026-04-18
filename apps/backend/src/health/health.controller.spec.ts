import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should return {status: "ok"}', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
  });

  it('should include timestamp as ISO string', () => {
    const result = controller.check();
    expect(result).toHaveProperty('timestamp');
    expect(() => new Date(result.timestamp)).not.toThrow();
  });
});
