import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  projectCount: number;
  sessionCount: number;
  scanStatus: 'idle' | 'scanning' | 'complete' | 'degraded';
  lastAction: string | null;
}

export const StatusBar: React.FC<Props> = ({ projectCount, sessionCount, scanStatus, lastAction }) => (
  <Box>
    <Text dimColor>
      Projects: {projectCount} · Sessions: {sessionCount} · Scan: {scanStatus}
    </Text>
    {lastAction && (
      <>
        <Text>  ·  </Text>
        <Text color="green">{lastAction}</Text>
      </>
    )}
  </Box>
);