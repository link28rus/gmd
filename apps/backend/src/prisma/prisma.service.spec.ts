import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should expose $connect and $disconnect methods', () => {
    expect(typeof service.$connect).toBe('function');
    expect(typeof service.$disconnect).toBe('function');
  });

  it('should implement OnModuleInit interface', () => {
    expect(typeof service.onModuleInit).toBe('function');
  });

  it('should implement OnModuleDestroy interface', () => {
    expect(typeof service.onModuleDestroy).toBe('function');
  });
});
