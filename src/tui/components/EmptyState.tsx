import React from 'react';
import { Box, Text } from 'ink';

export const EmptyState: React.FC = () => (
  <Box flexDirection="column" paddingX={1}>
    <Text dimColor>No projects found.</Text>
    <Text dimColor>Press `a` to add a directory, or `,` to configure the session root.</Text>
  </Box>
);
