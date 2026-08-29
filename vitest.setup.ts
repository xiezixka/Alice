// Node 25 exposes a partial localStorage global when Vitest starts with an
// invalid --localstorage-file. Vue Devtools (loaded by Pinia) expects the
// standard Storage methods during module initialization, so provide a small
// in-memory implementation for tests.
const values = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => {
      values.set(String(key), String(value))
    },
    removeItem: (key: string) => {
      values.delete(String(key))
    },
    clear: () => values.clear(),
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size
    },
  },
})
