import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClient | null = null;

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
    this.client.on('error', (err) => this.logger.error('Redis error', err.message));
    this.logger.log(`Redis client initialized → ${url}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.logger.log('Redis disconnected');
    }
  }

  getClient(): RedisClient {
    if (!this.client) {
      throw new Error('Redis client not initialized — RedisService.onModuleInit not called');
    }
    return this.client;
  }

  async incr(key: string): Promise<number> {
    return this.getClient().incr(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.getClient().expire(key, seconds);
  }

  async get(key: string): Promise<string | null> {
    return this.getClient().get(key);
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (ttlSec !== undefined) {
      await this.getClient().set(key, value, 'EX', ttlSec);
    } else {
      await this.getClient().set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.getClient().del(key);
  }

  async ttl(key: string): Promise<number> {
    return this.getClient().ttl(key);
  }
}
