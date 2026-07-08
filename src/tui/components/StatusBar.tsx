import React from 'react';
import { Box, Text } from 'ink';
import type { UiState } from '../App.js';

interface Props {
  projectCount: number;
  sessionCount: number;
  scanStatus: 'idle' | 'scanning' | 'complete' | 'degraded';
  lastAction: UiState['lastAction'];
}

export const StatusBar: React.FC<Props> = ({
  projectCount,
  sessionCount,
  scanStatus,
  lastAction,
}) => {
  const message = lastAction ? String(lastAction.payload ?? '') : '';
  const isError = lastAction?.kind === 'error';
  return (
    <Box>
      <Text dimColor>
        Projects: {projectCount} · Sessions: {sessionCount} · Scan: {scanStatus}
      </Text>
      {message && (
        <>
          <Text>  ·  </Text>
          <Text color={isError ? 'red' : 'green'}>{message}</Text>
        </>
      )}
    </Box>
  );
};
