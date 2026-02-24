import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

export interface PathInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
}

interface CompletionState {
  items: string[];
  index: number; // -1 = at common prefix, >=0 = cycling
}

const MAX_VISIBLE = 6;

function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/')) return homedir() + p.slice(1);
  return p;
}

function commonPrefix(strs: string[]): string {
  if (!strs.length) return '';
  let pre = strs[0]!;
  for (const s of strs.slice(1)) {
    while (!s.startsWith(pre)) pre = pre.slice(0, -1);
  }
  return pre;
}

async function computeCompletions(input: string): Promise<string[]> {
  const expanded = expandHome(input);

  let searchDir: string;
  let partial: string;
  let prefix: string; // part of original input kept verbatim before the partial token

  if (expanded.endsWith('/')) {
    searchDir = expanded || '.';
    partial = '';
    prefix = input;
  } else {
    const lastSlash = expanded.lastIndexOf('/');
    if (lastSlash === -1) {
      searchDir = process.cwd();
      partial = expanded;
      prefix = '';
    } else {
      searchDir = expanded.slice(0, lastSlash + 1);
      partial = expanded.slice(lastSlash + 1);
      const origSlash = input.lastIndexOf('/');
      prefix = origSlash === -1 ? '' : input.slice(0, origSlash + 1);
    }
  }

  try {
    const entries = await readdir(searchDir || '.');
    const matches = entries.filter(e => e.startsWith(partial));
    const results: string[] = [];
    for (const match of matches) {
      let suffix = '';
      try {
        const s = await stat(join(searchDir || '.', match));
        if (s.isDirectory()) suffix = '/';
      } catch {}
      results.push(prefix + match + suffix);
    }
    return results.sort();
  } catch {
    return [];
  }
}

export function PathInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  focus = true,
}: PathInputProps) {
  const [completions, setCompletions] = useState<CompletionState | null>(null);

  // Refs for fresh values inside async callback
  const genRef = useRef(0);
  const valueRef = useRef(value);
  const completionsRef = useRef(completions);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  completionsRef.current = completions;
  onChangeRef.current = onChange;

  const cancelCompletions = () => {
    genRef.current++;
    setCompletions(null);
  };

  useInput(
    (_char, key) => {
      if (!key.tab) {
        cancelCompletions();
        return;
      }

      const gen = ++genRef.current;
      const cur = completionsRef.current;

      // Already have completions: cycle to next
      if (cur && cur.items.length > 0) {
        const next = (cur.index + 1) % cur.items.length;
        setCompletions({ ...cur, index: next });
        onChangeRef.current(cur.items[next]!);
        return;
      }

      // Compute new completions
      void computeCompletions(valueRef.current).then(items => {
        if (gen !== genRef.current) return; // cancelled by user input

        if (items.length === 0) return;

        if (items.length === 1) {
          if (items[0] !== valueRef.current) onChangeRef.current(items[0]!);
          setCompletions({ items, index: 0 });
          return;
        }

        // Multiple: complete to common prefix first, then cycle on next TABs
        const cp = commonPrefix(items);
        if (cp && cp !== valueRef.current) {
          onChangeRef.current(cp);
          setCompletions({ items, index: -1 });
        } else {
          // Already at common prefix: start cycling
          onChangeRef.current(items[0]!);
          setCompletions({ items, index: 0 });
        }
      });
    },
    { isActive: focus },
  );

  const showList = completions !== null && completions.items.length > 1;

  return (
    <Box flexDirection="column">
      <TextInput
        value={value}
        onChange={v => {
          cancelCompletions();
          onChange(v);
        }}
        onSubmit={onSubmit}
        placeholder={placeholder}
        focus={focus}
      />
      {showList && (
        <Box flexDirection="column" paddingLeft={2} marginTop={0}>
          {completions!.items.slice(0, MAX_VISIBLE).map((item, i) => {
            const active = i === completions!.index;
            return (
              <Text key={item} color={active ? 'cyan' : 'gray'} bold={active} dimColor={!active}>
                {active ? `▶ ${item}` : `  ${item}`}
              </Text>
            );
          })}
          {completions!.items.length > MAX_VISIBLE && (
            <Text color="gray" dimColor>
              {`  … ${completions!.items.length - MAX_VISIBLE} autre(s)`}
            </Text>
          )}
          <Text color="gray" dimColor>
            {'  ↹ suivant · ↵ valider'}
          </Text>
        </Box>
      )}
    </Box>
  );
}
