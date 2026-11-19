import { shareWireValue } from "./wireValues";
export interface ReadValue<T> {
  key: string;
  value: T;
  readAt: number;
}

/** Session memory only. Cached content never proves that a new read has completed. */
export class ReadCache<T> {
  private values = new Map<string, ReadValue<T>>();
  constructor(private capacity: number) {}
  get(key: string) {
    return this.values.get(key);
  }
  put(key: string, value: T, readAt = Date.now()) {
    const previous = this.values.get(key);
    const row = {
      key,
      value: previous ? shareWireValue(previous.value, value) : value,
      readAt,
    };
    this.values.delete(key);
    this.values.set(key, row);
    while (this.values.size > this.capacity)
      this.values.delete(this.values.keys().next().value!);
    return row;
  }
  update(change: (value: T) => T) {
    for (const [key, row] of this.values) {
      const value = change(row.value);
      if (value !== row.value) this.values.set(key, { ...row, value });
    }
  }
  clear() {
    this.values.clear();
  }
}
