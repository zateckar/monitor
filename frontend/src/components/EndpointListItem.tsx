import React from 'react';
import { Card, CardContent, Typography, Box, CardActionArea, Chip } from '@mui/material';
import type { Endpoint } from '../types';
import HeartbeatVisualization from './HeartbeatVisualization';

interface EndpointListItemProps {
  endpoint: Endpoint;
  onSelect: (endpoint: Endpoint) => void;
  isSelected: boolean;
  onTogglePause?: (id: number) => void;
}

const EndpointListItem: React.FC<EndpointListItemProps> = ({
  endpoint,
  onSelect,
  isSelected
}) => {
  const getUptimeColor = (uptime: number) => {
    if (uptime >= 99.9) return 'success';
    if (uptime >= 95) return 'warning';
    return 'error';
  };

  return (
    <Card sx={{ 
      mb: 2, 
      ...(isSelected && { backgroundColor: 'action.selected' }),
      ...(endpoint.paused && { 
        opacity: 0.6,
        backgroundColor: 'action.disabledBackground'
      })
    }}>
      <CardActionArea onClick={() => onSelect(endpoint)}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <Typography 
                variant="body1" 
                component="div"
                sx={{ 
                  ...(endpoint.paused && { 
                    color: 'text.disabled',
                    textDecoration: 'line-through'
                  })
                }}
              >
                {endpoint.name}
              </Typography>
              <Chip
                label={endpoint.type.toUpperCase()}
                size="small"
                variant="outlined"
                sx={{ 
                  ml: 1, 
                  fontSize: '0.6rem', 
                  height: '18px',
                  minWidth: 'auto',
                  '& .MuiChip-label': {
                    px: 0.5
                  },
                  color: 'text.secondary',
                  borderColor: 'divider',
                  ...(endpoint.paused && {
                    opacity: 0.5
                  })
                }}
              />
              {endpoint.paused && (
                <Chip
                  label="PAUSED"
                  size="small"
                  variant="outlined"
                  sx={{ ml: 1, fontSize: '0.7rem' }}
                />
              )}
            </Box>
            <Chip
              label={`${endpoint.uptime_24h.toFixed(2)}%`}
              color={endpoint.paused ? 'default' : getUptimeColor(endpoint.uptime_24h)}
              size="small"
              sx={{
                ...(endpoint.paused && {
                  opacity: 0.7
                })
              }}
            />
          </Box>
          {!endpoint.paused && typeof endpoint.id === 'number' && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
              <HeartbeatVisualization 
                endpointId={endpoint.id} 
                size="small" 
                maxCount={80}
              />
            </Box>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
};

export default EndpointListItem;
