import { useState, useCallback } from 'react';
import { useInput } from 'ink';
import { createDefaultRegistry, CommandParser } from '@agentx/engine';
import type { CommandInterface } from '@agentx/engine';

interface UseSlashCommandsReturn {
  filteredCommands: Array<{ name: string; description: string }>;
  selectedIndex: number;
  isCommandMode: boolean;
  handleInput: (value: string) => void;
  handleSelect: () => CommandInterface | undefined;
  reset: () => void;
}

export function useSlashCommands(): UseSlashCommandsReturn {
  const [filteredCommands, setFilteredCommands] = useState<Array<{ name: string; description: string }>>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isCommandMode, setIsCommandMode] = useState(false);

  const registry = createDefaultRegistry();
  const parser = new CommandParser();

  useInput((_input, key) => {
    if (!isCommandMode) return;

    if (key.upArrow) {
      setSelectedIndex((i) => (i > 0 ? i - 1 : filteredCommands.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => (i < filteredCommands.length - 1 ? i + 1 : 0));
    } else if (key.escape) {
      setIsCommandMode(false);
      setFilteredCommands([]);
      setSelectedIndex(0);
    }
  });

  const handleInput = useCallback((value: string) => {
    if (value.startsWith('/')) {
      setIsCommandMode(true);
      const prefix = parser.extractPrefix(value);
      const matches = registry.filter(prefix);
      setFilteredCommands(matches.map((cmd) => ({ name: cmd.name, description: cmd.description })));
      setSelectedIndex(0);
    } else {
      setIsCommandMode(false);
      setFilteredCommands([]);
    }
  }, []);

  const handleSelect = useCallback((): CommandInterface | undefined => {
    const selected = filteredCommands[selectedIndex];
    if (!selected) return undefined;
    setIsCommandMode(false);
    setFilteredCommands([]);
    return registry.get(selected.name);
  }, [filteredCommands, selectedIndex]);

  const reset = useCallback(() => {
    setIsCommandMode(false);
    setFilteredCommands([]);
    setSelectedIndex(0);
  }, []);

  return {
    filteredCommands,
    selectedIndex,
    isCommandMode,
    handleInput,
    handleSelect,
    reset,
  };
}
