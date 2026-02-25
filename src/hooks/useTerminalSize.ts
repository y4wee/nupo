import { useState, useEffect } from 'react';
import { useStdout } from 'ink';

export function useTerminalSize() {
  const { stdout } = useStdout();
  const [columns, setColumns] = useState(stdout?.columns ?? 80);
  const [rows,    setRows]    = useState(stdout?.rows    ?? 24);

  useEffect(() => {
    if (!stdout) return;
    const handler = () => {
      setColumns(stdout.columns);
      setRows(stdout.rows);
    };
    stdout.on('resize', handler);
    return () => { stdout.off('resize', handler); };
  }, [stdout]);

  return { columns, rows };
}
