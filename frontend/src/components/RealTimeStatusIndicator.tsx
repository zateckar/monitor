import React from 'react';
import {
  Box,
  Chip,
  IconButton,
  Tooltip,
  CircularProgress,
  Typography,
  Fade,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Wifi as ConnectedIcon,
  WifiOff as DisconnectedIcon,
  Warning as WarningIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import type { RealTimeStatus } from '../hooks/useRealTimeUpdates';

interface RealTimeStatusIndicatorProps {
  status: RealTimeStatus;
  loading?: boolean;
  onRefresh?: () => void;
  size?: 'small' | 'medium';
  showDetails?: boolean;
  label?: string;
}

const RealTimeStatusIndicator: React.FC<RealTimeStatusIndicatorProps> = ({
  status,
  loading = false,
  onRefresh,
  size = 'medium',
  showDetails = true,
  label = 'Real-time Updates'
}) => {
  const getStatusIcon = () => {
    if (loading) {
      return <CircularProgress size={size === 'small' ? 12 : 16} />;
    }
    
    if (status.isConnected) {
      return <ConnectedIcon fontSize={size} color="success" />;
    }
    
    if (status.errorCount > 0) {
      return <WarningIcon fontSize={size} color="warning" />;
    }
    
    return <DisconnectedIcon fontSize={size} color="error" />;
  };

  const getStatusColor = (): 'success' | 'warning' | 'error' | 'default' => {
    if (loading) return 'default';
    if (status.isConnected) return 'success';
    if (status.errorCount > 0) return 'warning';
    return 'error';
  };

  const getStatusText = () => {
    if (loading) return 'Updating...';
    if (status.isConnected) return 'Connected';
    if (status.retryAttempt > 0) return `Retrying (${status.retryAttempt})`;
    if (status.errorCount > 0) return 'Connection Issues';
    return 'Disconnected';
  };

  const formatLastUpdate = (date: Date | null): string => {
    if (!date) return 'Never';
    
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleTimeString();
  };

  const getTooltipContent = () => {
    const lines = [
      `Status: ${getStatusText()}`,
      `Last Update: ${formatLastUpdate(status.lastUpdate)}`,
    ];
    
    if (status.errorCount > 0) {
      lines.push(`Errors: ${status.errorCount}`);
    }
    
    if (status.retryAttempt > 0) {
      lines.push(`Retry Attempt: ${status.retryAttempt}`);
    }
    
    return lines.join('\n');
  };

  if (!showDetails) {
    return (
      <Tooltip title={getTooltipContent()}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {getStatusIcon()}
          {onRefresh && (
            <IconButton
              size="small"
              onClick={onRefresh}
              disabled={loading}
              sx={{ ml: 0.5 }}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      </Tooltip>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Chip
        icon={getStatusIcon()}
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" component="span">
              {label}
            </Typography>
            {status.lastUpdate && (
              <Fade in={status.isConnected}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                  <ScheduleIcon sx={{ fontSize: '0.7rem' }} />
                  <Typography variant="caption" component="span" color="text.secondary">
                    {formatLastUpdate(status.lastUpdate)}
                  </Typography>
                </Box>
              </Fade>
            )}
          </Box>
        }
        color={getStatusColor()}
        variant={status.isConnected ? 'filled' : 'outlined'}
        size={size}
        sx={{
          '& .MuiChip-label': {
            display: 'flex',
            alignItems: 'center',
          },
        }}
      />
      
      {onRefresh && (
        <Tooltip title="Refresh now">
          <IconButton
            size="small"
            onClick={onRefresh}
            disabled={loading}
            color={status.isConnected ? 'primary' : 'default'}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
};

export default RealTimeStatusIndicator;