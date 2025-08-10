import React from 'react';
import { List, Typography } from '@mui/material';
import type { Endpoint } from '../types';
import EndpointListItem from './EndpointListItem';

interface EndpointListProps {
  endpoints: Endpoint[];
  onSelect: (endpoint: Endpoint) => void;
  selectedId?: number | string;
  onTogglePause?: (id: number) => void;
}

const EndpointList: React.FC<EndpointListProps> = ({
  endpoints,
  onSelect,
  selectedId,
  onTogglePause,
}) => {
  if (endpoints.length === 0) {
    return (
      <Typography variant="body1" align="center" color="text.secondary" sx={{ mt: 2 }}>
        No endpoints to monitor. Add one to get started!
      </Typography>
    );
  }

  return (
    <List>
      {endpoints.map((endpoint) => (
        <EndpointListItem
          key={endpoint.id}
          endpoint={endpoint}
          onSelect={onSelect}
          isSelected={endpoint.id === selectedId}
          onTogglePause={onTogglePause}
        />
      ))}
    </List>
  );
};

export default EndpointList;
