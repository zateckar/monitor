import React, { useState, useEffect } from 'react';
import {
  Typography,
  Card,
  CardContent,
  Box,
  Grid,
  Chip,
  List,
  ListItem,
  ListItemText,
  CardHeader,
  Stack,
  LinearProgress,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  MonitorHeart,
  Speed,
  Timeline,
  History,
  Warning,
  CheckCircle,
  Error as ErrorIcon
} from '@mui/icons-material';
import type { Endpoint, Outage } from '../types';

interface DashboardStats {
  totalMonitors: number;
  upMonitors: number;
  downMonitors: number;
  pausedMonitors: number;
  avgResponseTime: number;
  overallUptime: number;
  monitorsWithIssues: Endpoint[];
}

interface DashboardProps {
  endpoints?: Endpoint[];
  isPaused?: boolean;
  onRefresh?: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ endpoints: providedEndpoints, isPaused = false }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [outages, setOutages] = useState<Array<Outage & { endpointName: string; endpointUrl: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      // Don't auto-refresh when editing to avoid interruption
      if (isPaused) {
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Use provided endpoints or fetch them if not provided
        let endpoints: Endpoint[];
        if (providedEndpoints) {
          endpoints = providedEndpoints;
        } else {
          const endpointsResponse = await fetch('/api/endpoints');
          if (!endpointsResponse.ok) {
            throw new Error('Failed to fetch endpoints');
          }
          endpoints = await endpointsResponse.json();
        }

        // Calculate aggregated stats
        const totalMonitors = endpoints.length;
        const upMonitors = endpoints.filter(e => e.status === 'UP' && !e.paused).length;
        const downMonitors = endpoints.filter(e => e.status === 'DOWN' && !e.paused).length;
        const pausedMonitors = endpoints.filter(e => e.paused).length;
        
        // Calculate average response time (only for UP monitors)
        const upEndpoints = endpoints.filter(e => e.status === 'UP' && !e.paused);
        const avgResponseTime = upEndpoints.length > 0 
          ? upEndpoints.reduce((sum, e) => sum + (e.current_response || 0), 0) / upEndpoints.length
          : 0;

        // Calculate overall uptime (weighted average of 24h uptime)
        const activeEndpoints = endpoints.filter(e => !e.paused);
        const overallUptime = activeEndpoints.length > 0
          ? activeEndpoints.reduce((sum, e) => sum + (e.uptime_24h || 0), 0) / activeEndpoints.length
          : 0;

        // Find monitors with issues (DOWN, low uptime, or high response time)
        const monitorsWithIssues = endpoints.filter(e => 
          !e.paused && (
            e.status === 'DOWN' || 
            (e.uptime_24h || 0) < 95 || 
            (e.current_response || 0) > 2000
          )
        );

        const dashboardStats: DashboardStats = {
          totalMonitors,
          upMonitors,
          downMonitors,
          pausedMonitors,
          avgResponseTime,
          overallUptime,
          monitorsWithIssues
        };

        setStats(dashboardStats);

        // Fetch outages from all endpoints
        const outagePromises = endpoints.map(async (endpoint) => {
          if (typeof endpoint.id === 'number') {
            try {
              const response = await fetch(`/api/endpoints/${endpoint.id}/outages?limit=10`);
              if (response.ok) {
                const endpointOutages: Outage[] = await response.json();
                return endpointOutages.map(outage => ({
                  ...outage,
                  endpointName: endpoint.name,
                  endpointUrl: endpoint.url
                }));
              }
            } catch (err) {
              console.error(`Failed to fetch outages for endpoint ${endpoint.id}:`, err);
            }
          }
          return [];
        });

        const allOutages = await Promise.all(outagePromises);
        const flattenedOutages = allOutages.flat();
        
        // Sort by most recent first and limit to 20
        const sortedOutages = flattenedOutages
          .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
          .slice(0, 20);

        setOutages(sortedOutages);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();

    // Only set up auto-refresh if endpoints are not provided (standalone mode)
    // If endpoints are provided, the parent component handles refreshing
    if (!providedEndpoints) {
      const interval = setInterval(fetchDashboardData, 30000);
      return () => clearInterval(interval);
    }
  }, [isPaused, providedEndpoints]);

  const formatResponseTime = (time: number): string => {
    if (time < 1000) {
      return `${Math.round(time)}ms`;
    } else {
      return `${(time / 1000).toFixed(1)}s`;
    }
  };

  const formatUptime = (uptime: number): string => {
    return `${uptime.toFixed(2)}%`;
  };

  const getStatusColor = (status: string) => {
    if (status === 'UP') return 'success';
    if (status === 'DOWN') return 'error';
    return 'default';
  };

  const getUptimeColor = (uptime: number) => {
    if (uptime >= 99) return 'success';
    if (uptime >= 95) return 'warning';
    return 'error';
  };

  if (loading) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ height: '100%', p: 2 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      </Box>
    );
  }

  if (!stats) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="h6" color="text.secondary">
          No data available
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Stack spacing={3}>
        {/* Header */}
        <Card elevation={2}>
          <CardHeader
            title={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DashboardIcon color="primary" />
                <Typography variant="h5" component="div">
                  Dashboard
                </Typography>
              </Box>
            }
            subheader="Overview of all monitors and recent activity"
          />
        </Card>

        {/* Statistics Grid */}
        <Box sx={{ mx: -1 }}>
          <Grid container spacing={2}>
          {/* Total Monitors */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card elevation={2}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <MonitorHeart color="primary" sx={{ fontSize: 40 }} />
                  <Box>
                    <Typography variant="h4" component="div">
                      {stats.totalMonitors}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Total Monitors
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Up Monitors */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card elevation={2}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <CheckCircle color="success" sx={{ fontSize: 40 }} />
                  <Box>
                    <Typography variant="h4" component="div" color="success.main">
                      {stats.upMonitors}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Online
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Down Monitors */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card elevation={2}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <ErrorIcon color="error" sx={{ fontSize: 40 }} />
                  <Box>
                    <Typography variant="h4" component="div" color="error.main">
                      {stats.downMonitors}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Offline
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Paused Monitors */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card elevation={2}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Warning color="warning" sx={{ fontSize: 40 }} />
                  <Box>
                    <Typography variant="h4" component="div" color="warning.main">
                      {stats.pausedMonitors}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Paused
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
        </Box>

        {/* Performance Metrics */}
        <Box sx={{ mx: -1 }}>
          <Grid container spacing={2}>
          {/* Average Response Time */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card elevation={2}>
              <CardHeader
                title={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Speed color="primary" />
                    <Typography variant="h6">Average Response Time</Typography>
                  </Box>
                }
              />
              <CardContent sx={{ pt: 0 }}>
                <Typography variant="h4" component="div" color={stats.avgResponseTime > 1000 ? 'warning.main' : 'primary.main'}>
                  {formatResponseTime(stats.avgResponseTime)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Across all online monitors
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          {/* Overall Uptime */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card elevation={2}>
              <CardHeader
                title={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Timeline color="primary" />
                    <Typography variant="h6">Overall Uptime (24h)</Typography>
                  </Box>
                }
              />
              <CardContent sx={{ pt: 0 }}>
                <Typography variant="h4" component="div" color={`${getUptimeColor(stats.overallUptime)}.main`}>
                  {formatUptime(stats.overallUptime)}
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={stats.overallUptime} 
                  color={getUptimeColor(stats.overallUptime)}
                  sx={{ mt: 1, height: 8, borderRadius: 4 }}
                />
              </CardContent>
            </Card>
          </Grid>
        </Grid>
        </Box>

        {/* Monitors with Issues */}
        {stats.monitorsWithIssues.length > 0 && (
          <Card elevation={2}>
            <CardHeader
              title={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Warning color="warning" />
                  <Typography variant="h6">Monitors Requiring Attention</Typography>
                </Box>
              }
            />
            <CardContent sx={{ pt: 0 }}>
              <List dense>
                {stats.monitorsWithIssues.map((endpoint) => (
                  <ListItem key={endpoint.id} divider>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="subtitle1">{endpoint.name}</Typography>
                          <Chip 
                            label={endpoint.status} 
                            color={getStatusColor(endpoint.status)} 
                            size="small"
                          />
                        </Box>
                      }
                      secondary={
                        <Box>
                          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                            {endpoint.url}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                              Uptime (24h): {formatUptime(endpoint.uptime_24h || 0)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Response: {formatResponseTime(endpoint.current_response || 0)}
                            </Typography>
                          </Box>
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        )}

        {/* Recent Outages */}
        <Card elevation={2}>
          <CardHeader
            title={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <History color="primary" />
                <Typography variant="h6">Recent Outages</Typography>
              </Box>
            }
          />
          <CardContent sx={{ pt: 0 }}>
            {outages.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                No recent outages recorded
              </Typography>
            ) : (
              <List dense>
                {outages.map((outage, index) => (
                  <ListItem key={index} divider={index < outages.length - 1}>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Typography variant="subtitle1">{outage.endpointName}</Typography>
                          {outage.ended_at ? (
                            <Chip label="Resolved" color="success" size="small" />
                          ) : (
                            <Chip label="Ongoing" color="error" size="small" />
                          )}
                        </Box>
                      }
                      secondary={
                        <Box>
                          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', mb: 0.5 }}>
                            {outage.endpointUrl}
                          </Typography>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="caption" color="text.secondary">
                              Started: {new Date(outage.started_at).toLocaleString()}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Duration: {outage.duration_text}
                            </Typography>
                          </Box>
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
};

export default Dashboard;
