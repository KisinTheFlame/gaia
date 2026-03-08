import type { ConfigChangeEvent } from "@kisinwen/gaia-shared";

type Subscriber = (event: ConfigChangeEvent) => void;

export class ConfigChangeBroker {
  private readonly subscribersByKey = new Map<string, Map<number, Subscriber>>();
  private nextSubscriberId = 1;

  subscribe(keys: Iterable<string>, subscriber: Subscriber): () => void {
    const subscriberId = this.nextSubscriberId;
    this.nextSubscriberId += 1;

    const uniqueKeys = new Set(keys);
    for (const key of uniqueKeys) {
      const subscribers = this.subscribersByKey.get(key) ?? new Map<number, Subscriber>();
      subscribers.set(subscriberId, subscriber);
      this.subscribersByKey.set(key, subscribers);
    }

    return () => {
      for (const key of uniqueKeys) {
        const subscribers = this.subscribersByKey.get(key);
        if (!subscribers) {
          continue;
        }

        subscribers.delete(subscriberId);
        if (subscribers.size === 0) {
          this.subscribersByKey.delete(key);
        }
      }
    };
  }

  publish(event: ConfigChangeEvent): void {
    const subscribers = this.subscribersByKey.get(event.key);
    if (!subscribers) {
      return;
    }

    for (const subscriber of subscribers.values()) {
      subscriber(event);
    }
  }
}
