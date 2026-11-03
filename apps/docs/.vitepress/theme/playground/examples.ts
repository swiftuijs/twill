export const snippets = {
  members: {
    filename: 'example.twill',
    jsxImportSource: 'react',
    note: 'Leading member access uses the callback’s first argument. Nested callbacks bind independently; the output is an ordinary arrow.',
    source: `const users = [
  { name: 'Ada', active: true },
  { name: 'Grace', active: false },
];

const activeUsers = users.filter { .active };
const names = activeUsers.map { .name.toUpperCase() };`,
  },
  callbacks: {
    filename: 'example.twill',
    jsxImportSource: 'react',
    note: 'Pass a callback after the call. Parentheses are optional when there are no other arguments.',
    source: `const values = [1, 2, 3, 4];

const doubled = values.map { value in
  value * 2;
};

const greaterThanFour = doubled.filter { value in
  value > 4;
};`,
  },
  cleanup: {
    filename: 'example.twill',
    jsxImportSource: 'react',
    note: 'Exit early with guard. Register cleanup with defer; it runs when the enclosing block exits.',
    source: `export function useResource(resource: { close(): void }, name?: string) {
  defer { resource.close(); }

  guard const value = name else {
    throw new Error('Missing name');
  }

  return value.toUpperCase();
}`,
  },
  branching: {
    filename: 'example.twill',
    jsxImportSource: 'react',
    note: 'Destructure an optional result after its guard succeeds. Match a native TS union; run twill check to verify exhaustiveness.',
    source: `type Result =
  | { kind: 'ok'; value: number }
  | { kind: 'error'; message: string };

export function describe(input: { result: Result } | null): string {
  guard const { result } = input else { return 'Missing result'; }
  return switch (result) {
    case { kind: 'ok', value }: value.toFixed(2);
    case { kind: 'error', message }: message;
  };
}`,
  },
  'if-bindings': {
    filename: 'example.twill',
    jsxImportSource: 'react',
    note: 'This pattern checks input itself before destructuring; it does not check input.value. Zero survives. To check the field instead, write if const value = input?.value.',
    source: `export function label(input: { value: number } | null) {
  if const { value } = input {
    return value.toFixed(2);
  } else {
    return 'Missing';
  }
}`,
  },
  'enum-patterns': {
    filename: 'example.twill',
    jsxImportSource: 'react',
    note: 'Match a checked case descriptor and bind named fields without calling the factory. Run twill check for type and exhaustiveness checks.',
    source: `enum LoadState<T> {
  case idle;
  case loaded(value: T);
  case failed(error: Error);
}

export function describe(state: LoadState<number>) {
  return match (state) {
    case LoadState.idle(): 'Idle';
    case LoadState.loaded({ value: result }): result.toFixed(2);
    case LoadState.failed({ error }): throw error;
  };
}`,
  },
  react: {
    filename: 'example.twillx',
    jsxImportSource: 'react',
    note: 'Component closures become ordinary JSX children. A lone JSX element stays directly inside its parent; hooks and component libraries keep their usual behavior.',
    source: `import { useState } from 'react';

function Panel(props: { children?: import('react').ReactNode }) {
  return <section>{props.children}</section>;
}

export default function App() {
  const [count, setCount] = useState(0);
  return Panel {
    <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
  };
}`,
  },
  vue: {
    filename: 'example.twillx',
    jsxImportSource: 'vue',
    vueDefaultSlot: 'function' as const,
    note: 'This component example opts into vueDefaultSlot: "function". The callback keeps reactive reads lazy; direct JSX children would evaluate them eagerly. Named slots retain an object.',
    source: `import { defineComponent, ref } from 'vue';

declare const Panel: import('vue').Component;

export default defineComponent({ setup() {
  const count = ref(0);
  return () => Panel {
    <button onClick={() => count.value++}>Count: {count.value}</button>;
  };
} });`,
  },
};
