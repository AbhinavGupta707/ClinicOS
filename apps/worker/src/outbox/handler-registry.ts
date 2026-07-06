import type { OutboxEventHandler } from "./types.js";

export class OutboxHandlerRegistry {
  readonly #handlers = new Map<string, OutboxEventHandler>();

  constructor(handlers: readonly OutboxEventHandler[] = []) {
    for (const handler of handlers) this.register(handler);
  }

  register(handler: OutboxEventHandler): void {
    if (this.#handlers.has(handler.eventType)) {
      throw new Error(`duplicate outbox handler registered for ${handler.eventType}`);
    }
    this.#handlers.set(handler.eventType, handler);
  }

  get(eventType: string): OutboxEventHandler | undefined {
    return this.#handlers.get(eventType);
  }

  eventTypes(): readonly string[] {
    return [...this.#handlers.keys()].sort();
  }
}
