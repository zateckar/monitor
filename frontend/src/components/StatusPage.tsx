import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Chip,
  LinearProgress,
  Alert,
  Container,
  Card,
  CardContent,
  Stack,
} from '@mui/material';
import { green, orange, red, grey } from '@mui/material/colors';
import type { Endpoint, Heartbeat, StatusPage as StatusPageType } from '../types';
import { formatDateTime, formatCurrentDateTime } from '../utils/timezone';

interface StatusPageProps {
  slug: string;
}

const StatusPage: React.FC<StatusPageProps> = ({ slug }) => {
  const [statusPage, setStatusPage] = useState<StatusPageType | null>(null);
  const [monitors, setMonitors] = useState<Endpoint[]>([]);
  const [heartbeats, setHeartbeats] = useState<Record<number, Heartbeat[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatusPage();
  }, [slug]);

  const fetchStatusPage = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch status page details and monitors
      const statusResponse = await fetch(`/api/status/${slug}`);
      if (!statusResponse.ok) {
        if (statusResponse.status === 404) {
          throw new Error('Status page not found');
        }
        throw new Error('Failed to fetch status page');
      }
      const statusData = await statusResponse.json();
      setStatusPage(statusData);
      setMonitors(statusData.monitors || []);

      // Fetch heartbeats for each monitor
      const heartbeatsData: Record<number, Heartbeat[]> = {};
      await Promise.all(
        (statusData.monitors || []).map(async (monitor: Endpoint) => {
          try {
            const heartbeatsResponse = await fetch(
              `/api/endpoints/${monitor.id}/heartbeats?limit=60`
            );
            if (heartbeatsResponse.ok) {
              heartbeatsData[Number(monitor.id)] = await heartbeatsResponse.json();
            }
          } catch (err) {
            console.error(`Failed to fetch heartbeats for monitor ${monitor.id}:`, err);
            heartbeatsData[Number(monitor.id)] = [];
          }
        })
      );
      setHeartbeats(heartbeatsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status page');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'up':
        return green[500];
      case 'down':
        return red[500];
      case 'pending':
        return orange[500];
      default:
        return grey[500];
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status.toLowerCase()) {
      case 'up':
        return 'Operational';
      case 'down':
        return 'Down';
      case 'pending':
        return 'Pending';
      default:
        return 'Unknown';
    }
  };

  const formatUptime = (uptime: number) => {
    return `${uptime.toFixed(2)}%`;
  };

  const formatLastUpdate = (lastChecked: string) => {
    if (!lastChecked) return 'Never';
    const date = new Date(lastChecked);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMins > 0) return `${diffMins}m ago`;
    return 'Just now';
  };

  const renderHeartbeats = (monitorHeartbeats: Heartbeat[]) => {
    // Fill array to always show 60 slots
    const slots = Array(60).fill(null);
    
    // Fill with actual heartbeats (oldest first in slots array)
    monitorHeartbeats.slice(0, 60).forEach((heartbeat, index) => {
      slots[index] = heartbeat;
    });

    return (
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mt: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
          Past
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {slots.map((heartbeat, index) => (
            <Box
              key={index}
              sx={{
                width: 8,
                height: 20,
                backgroundColor: heartbeat
                  ? heartbeat.status === 'UP'
                    ? green[500]
                    : red[500]
                  : grey[200],
                borderRadius: 0.5,
                opacity: heartbeat ? 1 : 0.3,
              }}
              title={
                heartbeat
                  ? `${heartbeat.status} - ${formatDateTime(heartbeat.created_at)}`
                  : 'No data'
              }
            />
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          Recent
        </Typography>
      </Box>
    );
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <LinearProgress />
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Typography>Loading status page...</Typography>
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  if (!statusPage) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">Status page not found</Alert>
      </Container>
    );
  }

  // Calculate overall status
  const overallStatus = monitors.length > 0 
    ? monitors.every(m => m.status === 'UP') 
      ? 'operational'
      : monitors.some(m => m.status === 'DOWN')
      ? 'down'
      : 'degraded'
    : 'unknown';

  const getOverallStatusColor = () => {
    switch (overallStatus) {
      case 'operational':
        return green[500];
      case 'degraded':
        return orange[500];
      case 'down':
        return red[500];
      default:
        return grey[500];
    }
  };

  const getOverallStatusLabel = () => {
    switch (overallStatus) {
      case 'operational':
        return 'All Systems Operational';
      case 'degraded':
        return 'Partial System Outage';
      case 'down':
        return 'Major System Outage';
      default:
        return 'System Status Unknown';
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Header */}
      <Paper sx={{ p: 4, mb: 4, textAlign: 'center' }}>
        <Typography variant="h3" component="h1" gutterBottom>
          {statusPage.name}
        </Typography>
        {statusPage.description && (
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {statusPage.description}
          </Typography>
        )}
        <Chip
          label={getOverallStatusLabel()}
          sx={{
            backgroundColor: getOverallStatusColor(),
            color: 'white',
            fontSize: '1rem',
            px: 2,
            py: 1,
            height: 'auto',
          }}
        />
      </Paper>

      {/* Monitors */}
      <Stack spacing={3}>
        {monitors.map((monitor) => (
          <Card key={monitor.id}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <Box>
                  <Typography variant="h6" gutterBottom>
                    {monitor.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {monitor.url}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Chip
                    label={getStatusLabel(monitor.status)}
                    sx={{
                      backgroundColor: getStatusColor(monitor.status),
                      color: 'white',
                      mb: 1,
                    }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    Last checked: {formatLastUpdate(monitor.last_checked)}
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="body2">
                  24h Uptime: <strong>{formatUptime(monitor.uptime_24h || 0)}</strong>
                </Typography>
                <Typography variant="body2">
                  Avg Response: <strong>{Math.round(monitor.avg_response_24h || 0)}ms</strong>
                </Typography>
              </Box>

              {/* Heartbeats visualization */}
              {renderHeartbeats(heartbeats[Number(monitor.id)] || [])}
            </CardContent>
          </Card>
        ))}
      </Stack>

      {monitors.length === 0 && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            No monitors configured for this status page.
          </Typography>
        </Paper>
      )}

      {/* Footer */}
      <Box sx={{ mt: 4, pt: 2, borderTop: 1, borderColor: 'divider', textAlign: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          Last updated: {formatCurrentDateTime()}
        </Typography>
      </Box>
    </Container>
  );
};

export default StatusPage;
