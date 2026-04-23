import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export interface AudioStateEvent {
  sessionId: string;
  state: string;
  data?: unknown;
}

@Injectable()
export class AudioEvents {
  // Один глобальный EventEmitter (in-memory). MVP: один backend-инстанс,
  // SSE-подписчики живут в том же процессе. Multi-instance — Redis Streams в post-MVP.
  private readonly emitter = new EventEmitter();

  emitState(sessionId: string, state: string, data?: unknown): void {
    this.emitter.emit(`session:${sessionId}`, { sessionId, state, data });
  }

  subscribe(sessionId: string, listener: (e: AudioStateEvent) => void): () => void {
    this.emitter.on(`session:${sessionId}`, listener);
    return () => this.emitter.off(`session:${sessionId}`, listener);
  }
}
