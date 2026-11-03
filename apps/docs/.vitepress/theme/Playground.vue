<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { withBase } from 'vitepress';
import CodeEditor from './playground/CodeEditor.vue';
import { LiveCompiler, type CompilationState } from './playground/live-compiler';
import type { CompileError } from './playground/protocol';
import { snippets } from './playground/examples';

type Example = keyof typeof snippets;
const selected = ref<Example>('callbacks');
const source = ref(snippets.callbacks.source);
const output = ref('');
const compilation = ref<CompilationState>({ phase: 'pending' });
const diagnostic = ref<CompileError | null>(null);
const notice = ref('');
const sourceEditor = ref<InstanceType<typeof CodeEditor>>();
const example = computed(() => snippets[selected.value]);
const jsx = computed(() => example.value.filename.endsWith('twillx'));
const current = computed(() => compilation.value.phase === 'ready');
const summary = computed(() => {
  const state = compilation.value;
  if (state.phase === 'pending') return 'Waiting for edits…';
  if (state.phase === 'compiling') return 'Compiling…';
  if (state.phase === 'error') return 'Check your source';
  const { duration, closures, guards, ifBindings, defers, switches } = state.result;
  const features = [
    [closures, 'closure'],
    [guards, 'guard'],
    [ifBindings, 'if binding'],
    [defers, 'defer'],
    [switches, 'switch expression'],
  ]
    .filter(([count]) => count)
    .map(([count, name]) => `${count} ${name}${count === 1 ? '' : 's'}`);
  return `Compiled in ${duration.toFixed(1)} ms${features.length ? ' · ' + features.join(' · ') : ''}`;
});
const draftKey = 'twill.playground.draft';
let compiler: LiveCompiler | undefined;
let mounted = false;
let disposed = false;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function request(immediate = false) {
  if (!mounted) return;
  diagnostic.value = null;
  compiler?.update({ ...example.value, source: source.value }, immediate);
  // Storage may be unavailable in private browsing. Editing still works.
  try {
    localStorage.setItem(
      draftKey,
      JSON.stringify({ example: selected.value, source: source.value }),
    );
  } catch {}
}
watch([source, selected], () => request(), { flush: 'sync' });
onMounted(async () => {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
    if (
      saved &&
      Object.hasOwn(snippets, saved.example) &&
      typeof saved.source === 'string' &&
      saved.source.length <= 20000
    ) {
      selected.value = saved.example;
      source.value = saved.source;
    }
  } catch {}
  await nextTick();
  if (disposed) return;
  compiler = new LiveCompiler(
    () => new Worker(new URL('./compiler.worker.ts', import.meta.url), { type: 'module' }),
    (state) => {
      compilation.value = state;
      if (state.phase === 'ready') {
        output.value = state.result.code;
        diagnostic.value = null;
      } else if (state.phase === 'error') diagnostic.value = state.error;
    },
  );
  mounted = true;
  request(true);
});
function choose() {
  source.value = example.value.source;
  request(true);
}
function notify(message: string) {
  notice.value = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.value = '';
  }, 2500);
}
async function copyOutput() {
  try {
    await navigator.clipboard.writeText(output.value);
    notify('Output copied');
  } catch {
    notify('Copy is unavailable. Select the output to copy it.');
  }
}
function downloadOutput() {
  const url = URL.createObjectURL(new Blob([output.value], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = jsx.value ? 'example.tsx' : 'example.ts';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function keyboard(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    request(true);
  }
}
onBeforeUnmount(() => {
  mounted = false;
  disposed = true;
  compiler?.dispose();
  clearTimeout(noticeTimer);
});
</script>

<template>
  <main class="twill-playground-page" @keydown="keyboard">
    <section class="twill-playground" aria-label="Twill playground">
      <div class="playground-toolbar">
        <h1>Playground</h1>
        <div class="playground-example-picker">
          <label for="twill-example">Example</label>
          <select id="twill-example" v-model="selected" @change="choose">
            <option value="callbacks">Ordinary callbacks</option>
            <option value="members">Implicit members</option>
            <option value="cleanup">Guard and defer</option>
            <option value="branching">Typed outcome matching</option>
            <option value="if-bindings">Branch bindings</option>
            <option value="enum-patterns">Match expressions</option>
            <option value="react">React component</option>
            <option value="vue">Vue lazy slot</option>
          </select>
        </div>
        <button
          class="playground-button"
          type="button"
          aria-label="Reset example"
          :disabled="source === example.source"
          @click="choose"
        >
          Reset
        </button>
      </div>
      <div class="playground-editors">
        <section class="playground-pane" aria-label="Source pane">
          <div class="playground-pane-header">
            <h2>Twill</h2>
            <span class="playground-filename">{{ example.filename }}</span>
          </div>
          <CodeEditor
            ref="sourceEditor"
            v-model="source"
            label="Twill source"
            :jsx="jsx"
            :error="diagnostic"
            @limit="notify('Source is limited to 20,000 characters')"
          />
        </section>
        <section
          class="playground-pane"
          aria-label="Output pane"
          :class="{ 'is-stale': !current && !!output }"
        >
          <div class="playground-pane-header">
            <h2>{{ jsx ? 'TSX' : 'TypeScript' }}</h2>
            <span v-if="!current && output" class="playground-output-state">Last valid output</span>
            <div class="playground-output-actions">
              <button
                class="playground-button"
                type="button"
                aria-label="Copy output"
                :disabled="!current"
                @click="copyOutput"
              >
                Copy
              </button>
              <button
                class="playground-button"
                type="button"
                :disabled="!current"
                @click="downloadOutput"
              >
                Download
              </button>
            </div>
          </div>
          <CodeEditor
            :model-value="output"
            label="Generated TypeScript / TSX"
            read-only
            :jsx="jsx"
          />
        </section>
      </div>
      <div v-if="diagnostic" class="playground-error" role="alert">
        <div>
          <strong>Unable to compile</strong>
          <p>{{ diagnostic.message }}</p>
        </div>
        <button
          v-if="diagnostic.offset !== undefined"
          class="playground-button"
          type="button"
          @click="sourceEditor?.focus(diagnostic.offset)"
        >
          Go to error<span v-if="diagnostic.line">
            · {{ diagnostic.line }}:{{ diagnostic.column }}</span
          >
        </button>
        <button v-else class="playground-button" type="button" @click="request(true)">
          Retry compilation
        </button>
      </div>
      <div class="playground-status-bar" :data-phase="compilation.phase">
        <p class="playground-status" role="status" aria-live="polite">
          <span class="playground-status-dot" aria-hidden="true" />{{ summary }}
        </p>
        <span v-if="notice" class="playground-notice" aria-live="polite">{{ notice }}</span>
        <div class="playground-footer-actions">
          <details class="playground-help">
            <summary>Help</summary>
            <div class="playground-help-popover">
              <p>{{ example.note }}</p>
              <p id="playground-editor-help">
                <kbd>Tab</kbd> indents · <kbd>Esc</kbd> then <kbd>Tab</kbd> leaves the editor ·
                <kbd>Ctrl / Cmd + Enter</kbd> compiles immediately.
              </p>
              <p>
                Your draft stays in this browser. The playground transforms syntax without running
                code or checking project imports.
              </p>
            </div>
          </details>
          <a :href="withBase('/syntax')">Syntax guide ↗</a>
        </div>
      </div>
    </section>
  </main>
</template>
