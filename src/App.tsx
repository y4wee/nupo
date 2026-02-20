import React, { useState } from 'react';
import { Box, Text, useInput, useApp, Spacer } from 'ink';
import TextInput from 'ink-text-input';

const BANNER = `
 ███╗   ██╗██╗   ██╗██████╗  ██████╗
 ████╗  ██║██║   ██║██╔══██╗██╔═══██╗
 ██╔██╗ ██║██║   ██║██████╔╝██║   ██║
 ██║╚██╗██║██║   ██║██╔═══╝ ██║   ██║
 ██║ ╚████║╚██████╔╝██║     ╚██████╔╝
 ╚═╝  ╚═══╝ ╚═════╝ ╚═╝      ╚═════╝
`.trim();

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export function App() {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [showBanner, setShowBanner] = useState(true);

  useInput((char, key) => {
    if (key.ctrl && char === 'c') {
      exit();
    }
  });

  const handleSubmit = (value: string) => {
    if (!value.trim()) return;

    setShowBanner(false);
    setMessages(prev => [
      ...prev,
      { role: 'user', content: value },
      { role: 'assistant', content: '(nupo n\'est pas encore connecté à un modèle)' },
    ]);
    setInput('');
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        marginBottom={1}
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <Text color="cyan" bold>
          nupo
        </Text>
        <Text color="gray" dimColor>
          v0.1.0
        </Text>
      </Box>

      {/* Banner ou messages */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {showBanner && messages.length === 0 ? (
          <Box flexDirection="column" alignItems="center" paddingY={1}>
            <Text color="cyan">{BANNER}</Text>
            <Box marginTop={1} flexDirection="column" alignItems="center">
              <Text color="white" bold>
                Bienvenue dans nupo
              </Text>
              <Text color="gray" dimColor>
                Votre assistant CLI nouvelle génération
              </Text>
            </Box>
            <Box
              marginTop={2}
              borderStyle="single"
              borderColor="gray"
              paddingX={2}
              paddingY={0}
            >
              <Text color="gray">
                Conseils :{' '}
                <Text color="white">Tapez votre message</Text> pour commencer ·{' '}
                <Text color="white">Ctrl+C</Text> pour quitter
              </Text>
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column" gap={1}>
            {messages.map((msg, i) => (
              <Box key={i} flexDirection="column">
                <Box flexDirection="row" gap={1} alignItems="flex-start">
                  <Text color={msg.role === 'user' ? 'green' : 'cyan'} bold>
                    {msg.role === 'user' ? '>' : 'nupo'}
                  </Text>
                  <Text color={msg.role === 'user' ? 'white' : 'gray'}>
                    {msg.content}
                  </Text>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Séparateur */}
      <Box borderStyle="single" borderColor="gray" marginX={0} />

      {/* Zone de saisie */}
      <Box
        paddingX={2}
        paddingY={0}
        flexDirection="row"
        alignItems="center"
        gap={1}
      >
        <Text color="green" bold>
          {'>'}
        </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder="Tapez votre message..."
        />
      </Box>

      {/* Status bar */}
      <Box
        paddingX={2}
        flexDirection="row"
        justifyContent="space-between"
      >
        <Text color="gray" dimColor>
          nupo · prêt
        </Text>
        <Text color="gray" dimColor>
          Ctrl+C quitter
        </Text>
      </Box>
    </Box>
  );
}
