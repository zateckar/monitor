import React, { useState, useEffect } from 'react';
import type { InstanceConfig, MonitoringInstance, SystemInfo, ConnectionInfo } from '../../types';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  Snackbar,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Chip,
  Tooltip,
  CircularProgress,
  Divider,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import CloudIcon from '@mui/icons-material/Cloud';
import StorageIcon from '@mui/icons-material/Storage';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import SpeedIcon from '@mui/icons-material/Speed';
import MemoryIcon from '@mui/icons-material/Memory';
import ComputerIcon from '@mui/icons-material/Computer';
import SecurityIcon from '@mui/icons-material/Security';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import InfoIcon from '@mui/icons-material/Info';

type InstanceRole = 'standalone' | 'primary' | 'dependent';

const DistributedMonitoringSettings: React.FC = () => {
  const [config, setConfig] = useState<InstanceConfig>({
    instanceName: '',
    instanceLocation: '',
    primarySyncURL: '',
    failoverOrder: 1,
    syncInterval: 30000,
    heartbeatInterval: 10000,
    connectionTimeout: 5000,
    sharedSecret: '',
  });
  
  const [currentRole, setCurrentRole] = useState<InstanceRole>('standalone');
  const [instances, setInstances] = useState<MonitoringInstance[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionInfo | null>(null);
  const [authStatus, setAuthStatus] = useState<{
    isAuthenticated: boolean;
    tokenExpiry?: string;
    lastAuth?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [reAuthenticating, setReAuthenticating] = useState(false);
  const [showTokenDialog, setShowTokenDialog] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
  }>({ open: false, message: '', severity: 'success' });

  // Simplified: no realtime updates for distributed monitoring

  useEffect(() => {
    loadConfiguration();
    loadSystemInfo();
    loadAuthStatus();
    loadConnectionStatus();
    loadInstances();
  }, []);

  // Simplified: no realtime updates, instances remain empty

  const loadConfiguration = async () => {
    try {
      const response = await fetch('/api/system/distributed-config');
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setConfig(result.data.config);
          setCurrentRole(result.data.role);
        } else {
          throw new Error(result.error || 'Failed to load configuration');
        }
      } else {
        throw new Error('Failed to load configuration');
      }
    } catch (error) {
      console.error('Failed to load configuration:', error);
      setSnackbar({ open: true, message: 'Failed to load configuration', severity: 'error' });
    }
  };

  const loadInstances = async () => {
    try {
      const response = await fetch('/api/system/instances');
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setInstances(result.data);
        } else {
          throw new Error(result.error || 'Failed to load instances');
        }
      } else {
        throw new Error('Failed to load instances');
      }
    } catch (error) {
      console.error('Failed to load instances:', error);
      setSnackbar({ open: true, message: 'Failed to load instances', severity: 'error' });
    }
  };

  const loadSystemInfo = async () => {
    try {
      const response = await fetch('/api/system/info');
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setSystemInfo(result.data);
        } else {
          throw new Error(result.error || 'Failed to load system info');
        }
      } else {
        throw new Error('Failed to load system info');
      }
    } catch (error) {
      console.error('Failed to load system info:', error);
      setSnackbar({ open: true, message: 'Failed to load system info', severity: 'error' });
    }
  };

  const loadConnectionStatus = async () => {
    try {
      const response = await fetch('/api/system/connection-status');
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setConnectionStatus(result.data);
        } else {
          throw new Error(result.error || 'Failed to load connection status');
        }
      } else {
        throw new Error('Failed to load connection status');
      }
    } catch (error) {
      console.error('Failed to load connection status:', error);
      setSnackbar({ open: true, message: 'Failed to load connection status', severity: 'error' });
    }
  };

  const loadAuthStatus = async () => {
    try {
      const response = await fetch('/api/system/auth-status');
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setAuthStatus(result.data);
        } else {
          throw new Error(result.error || 'Failed to load auth status');
        }
      } else {
        throw new Error('Failed to load auth status');
      }
    } catch (error) {
      console.error('Failed to load auth status:', error);
      setSnackbar({ open: true, message: 'Failed to load auth status', severity: 'error' });
    }
  };

  const handleTestConnection = async () => {
    if (!config.primarySyncURL) {
      setSnackbar({
        open: true,
        message: 'Primary sync URL is required to test connection',
        severity: 'error'
      });
      return;
    }

    setTestingConnection(true);
    try {
      const response = await fetch('/api/system/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryURL: config.primarySyncURL })
      });

      const result = await response.json();
      
      if (result.success) {
        setSnackbar({
          open: true,
          message: `Connection test successful! Latency: ${result.latency}ms`,
          severity: 'success'
        });
      } else {
        setSnackbar({
          open: true,
          message: `Connection test failed: ${result.error}`,
          severity: 'error'
        });
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'error'
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleReAuthenticate = async () => {
    if (!config.primarySyncURL) {
      setSnackbar({
        open: true,
        message: 'Primary sync URL is required for authentication',
        severity: 'error'
      });
      return;
    }

    setReAuthenticating(true);
    try {
      const response = await fetch('/api/system/reauthenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryURL: config.primarySyncURL,
          instanceName: config.instanceName,
          location: config.instanceLocation
        })
      });

      const result = await response.json();
      
      if (result.success) {
        setSnackbar({
          open: true,
          message: 'Successfully re-authenticated with primary instance',
          severity: 'success'
        });
        await loadAuthStatus();
        await loadConnectionStatus();
      } else {
        setSnackbar({
          open: true,
          message: `Re-authentication failed: ${result.error}`,
          severity: 'error'
        });
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Re-authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'error'
      });
    } finally {
      setReAuthenticating(false);
    }
  };

  const handleViewTokenInfo = () => {
    setShowTokenDialog(true);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadInstances(), loadConnectionStatus()]);
      setSnackbar({
        open: true,
        message: 'Instance data refreshed successfully',
        severity: 'success'
      });
    } catch (error) {
      setSnackbar({
        open: true,
        message: 'Failed to refresh instance data',
        severity: 'error'
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveConfiguration = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/system/distributed-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, role: currentRole }),
      });

      if (response.ok) {
        setSnackbar({
          open: true,
          message: 'Configuration saved successfully. Restart required for role changes.',
          severity: 'success'
        });
        await loadConfiguration();
      } else {
        // Parse the error response from server
        let errorMessage = 'Failed to save configuration';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
          if (errorData.details && Array.isArray(errorData.details)) {
            errorMessage += ': ' + errorData.details.join(', ');
          }
        } catch (parseError) {
          // If parsing fails, use the generic message
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePromoteInstance = async (instanceId: string) => {
    try {
      const response = await fetch(`/api/system/instances/${instanceId}/promote`, {
        method: 'POST',
      });

      if (response.ok) {
        setSnackbar({
          open: true,
          message: 'Instance promotion initiated',
          severity: 'success'
        });
        await loadInstances();
      } else {
        throw new Error('Failed to promote instance');
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Failed to promote instance: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'error'
      });
    }
  };

  const handleRemoveInstance = async (instanceId: string) => {
    try {
      const response = await fetch(`/api/system/instances/${instanceId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setSnackbar({
          open: true,
          message: 'Instance removed successfully',
          severity: 'success'
        });
        await loadInstances();
      } else {
        throw new Error('Failed to remove instance');
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Failed to remove instance: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'error'
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'success';
      case 'inactive': return 'warning';
      case 'failed': return 'error';
      case 'promoting': return 'info';
      default: return 'default';
    }
  };

  const formatUptime = (uptime: number) => {
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatBytes = (bytes: number) => {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${Math.round(bytes / Math.pow(1024, i) * 100) / 100} ${sizes[i]}`;
  };

  const handleCloseSnackbar = () => {
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  return (
    <Box>
      <Typography variant="h5" component="div" sx={{ mb: 3 }}>
        Distributed Monitoring
      </Typography>

      {/* Current System Information */}
      {systemInfo && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
              <ComputerIcon />
              Current Instance
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <StorageIcon fontSize="small" />
                  <Typography variant="body2">
                    <strong>Platform:</strong> {systemInfo.platform} ({systemInfo.arch})
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <SpeedIcon fontSize="small" />
                  <Typography variant="body2">
                    <strong>Uptime:</strong> {formatUptime(systemInfo.uptime)}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <MemoryIcon fontSize="small" />
                  <Typography variant="body2">
                    <strong>Memory:</strong> {formatBytes(systemInfo.memory)}
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ flex: 1 }}>
                {connectionStatus && (
                  <>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <NetworkCheckIcon fontSize="small" />
                      <Typography variant="body2">
                        <strong>Primary Reachable:</strong>
                        <Chip
                          size="small"
                          label={connectionStatus.primaryReachable ? 'Yes' : 'No'}
                          color={connectionStatus.primaryReachable ? 'success' : 'error'}
                          sx={{ ml: 1 }}
                        />
                      </Typography>
                    </Box>
                    {connectionStatus.latency && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <SpeedIcon fontSize="small" />
                        <Typography variant="body2">
                          <strong>Latency:</strong> {connectionStatus.latency}ms
                        </Typography>
                      </Box>
                    )}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Typography variant="body2">
                        <strong>Sync Errors:</strong> {connectionStatus.syncErrors}
                      </Typography>
                    </Box>
                    {authStatus && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2">
                          <strong>Authentication:</strong>
                          <Chip
                            size="small"
                            label={authStatus.isAuthenticated ? 'Valid' : 'Invalid'}
                            color={authStatus.isAuthenticated ? 'success' : 'error'}
                            sx={{ ml: 1 }}
                          />
                        </Typography>
                      </Box>
                    )}
                  </>
                )}
              </Box>
            </Stack>
            
            {/* Authentication Management Section - Only show for dependent instances */}
            {currentRole === 'dependent' && (
              <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="subtitle1" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SecurityIcon fontSize="small" />
                  Authentication Management
                </Typography>
                <Stack direction="row" spacing={2} flexWrap="wrap">
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={handleTestConnection}
                    disabled={testingConnection}
                    startIcon={testingConnection ? <CircularProgress size={16} /> : <RefreshIcon />}
                  >
                    {testingConnection ? 'Testing...' : 'Test Connection'}
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={handleReAuthenticate}
                    disabled={reAuthenticating}
                    startIcon={reAuthenticating ? <CircularProgress size={16} /> : <VpnKeyIcon />}
                    color="warning"
                  >
                    {reAuthenticating ? 'Re-authenticating...' : 'Re-authenticate'}
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={handleViewTokenInfo}
                    startIcon={<InfoIcon />}
                  >
                    Token Info
                  </Button>
                </Stack>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {/* Configuration Form */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Instance Configuration
          </Typography>
          
          <Stack spacing={3}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <FormControl fullWidth>
                <InputLabel>Instance Role</InputLabel>
                <Select
                  value={currentRole}
                  onChange={(e) => setCurrentRole(e.target.value as InstanceRole)}
                  label="Instance Role"
                >
                  <MenuItem value="standalone">Standalone</MenuItem>
                  <MenuItem value="primary">Primary</MenuItem>
                  <MenuItem value="dependent">Dependent</MenuItem>
                </Select>
              </FormControl>
              
              <TextField
                label="Instance Name"
                fullWidth
                value={config.instanceName}
                onChange={(e) => setConfig({ ...config, instanceName: e.target.value })}
                required
              />
            </Stack>

            <TextField
              label="Instance Location"
              fullWidth
              value={config.instanceLocation || ''}
              onChange={(e) => setConfig({ ...config, instanceLocation: e.target.value })}
              helperText="Geographic location (e.g., US-East, EU-West, Asia-Pacific)"
            />

            {currentRole === 'primary' && (
              <>
                <Alert severity="info" sx={{ mt: 2 }}>
                  Primary instance will automatically enable sync API endpoints for dependent instances to connect.
                  Dependent instances will use the same application port with authenticated sync routes.
                </Alert>

                <Divider sx={{ my: 2 }}>
                  <Typography variant="subtitle2">Security Settings</Typography>
                </Divider>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
                  <TextField
                    label="Shared Secret"
                    fullWidth
                    type="password"
                    value={config.sharedSecret || ''}
                    onChange={(e) => setConfig({ ...config, sharedSecret: e.target.value })}
                    helperText="Secret required for dependent instances to register"
                    required
                  />
                  <Button
                    variant="outlined"
                    onClick={async () => {
                      try {
                        const response = await fetch('/api/system/generate-shared-secret', {
                          method: 'POST'
                        });
                        if (response.ok) {
                          const result = await response.json();
                          if (result.success) {
                            setConfig({ ...config, sharedSecret: result.data.secret });
                            setSnackbar({
                              open: true,
                              message: 'New shared secret generated successfully',
                              severity: 'success'
                            });
                          } else {
                            throw new Error(result.error || 'Failed to generate shared secret');
                          }
                        } else {
                          throw new Error('Failed to generate shared secret');
                        }
                      } catch (error) {
                        setSnackbar({
                          open: true,
                          message: `Failed to generate shared secret: ${error instanceof Error ? error.message : 'Unknown error'}`,
                          severity: 'error'
                        });
                      }
                    }}
                  >
                    Generate New
                  </Button>
                </Stack>
              </>
            )}

            {currentRole === 'dependent' && (
              <>
                <Divider sx={{ my: 2 }}>
                  <Typography variant="subtitle2">Dependent Instance Settings</Typography>
                </Divider>
                
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <TextField
                    label="Primary Sync URL"
                    fullWidth
                    value={config.primarySyncURL || ''}
                    onChange={(e) => setConfig({ ...config, primarySyncURL: e.target.value })}
                    placeholder="http://primary-instance:3002"
                    required
                  />

                  <TextField
                    label="Failover Order"
                    type="number"
                    value={config.failoverOrder || 1}
                    onChange={(e) => setConfig({ ...config, failoverOrder: parseInt(e.target.value) })}
                    helperText="Lower numbers have higher priority"
                    sx={{ minWidth: 200 }}
                  />
                </Stack>

                <TextField
                  label="Shared Secret"
                  fullWidth
                  type="password"
                  value={config.sharedSecret || ''}
                  onChange={(e) => setConfig({ ...config, sharedSecret: e.target.value })}
                  helperText="Shared secret from primary instance (required for registration)"
                  required
                />
              </>
            )}

            {currentRole !== 'standalone' && (
              <>
                <Divider sx={{ my: 2 }}>
                  <Typography variant="subtitle2">Connection Settings</Typography>
                </Divider>
                
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <TextField
                    label="Sync Interval (ms)"
                    type="number"
                    value={config.syncInterval || 30000}
                    onChange={(e) => setConfig({ ...config, syncInterval: parseInt(e.target.value) })}
                    sx={{ minWidth: 150 }}
                  />
                  
                  <TextField
                    label="Heartbeat Interval (ms)"
                    type="number"
                    value={config.heartbeatInterval || 10000}
                    onChange={(e) => setConfig({ ...config, heartbeatInterval: parseInt(e.target.value) })}
                    sx={{ minWidth: 150 }}
                  />
                  
                  <TextField
                    label="Connection Timeout (ms)"
                    type="number"
                    value={config.connectionTimeout || 5000}
                    onChange={(e) => setConfig({ ...config, connectionTimeout: parseInt(e.target.value) })}
                    sx={{ minWidth: 150 }}
                  />
                </Stack>
              </>
            )}
          </Stack>

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSaveConfiguration}
              disabled={loading}
            >
              {loading ? <CircularProgress size={20} /> : 'Save Configuration'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Instance Management */}
      {currentRole === 'primary' && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CloudIcon />
                Connected Instances
              </Typography>
              {/* Removed realtime status indicator for simplified implementation */}
            </Box>

            {instances.length === 0 ? (
              <Alert severity="info">
                No dependent instances connected. Configure dependent instances to connect to this primary instance.
              </Alert>
            ) : (
              <List>
                {instances.map((instance) => (
                  <ListItem key={instance.id} divider secondaryAction={
                    <>
                      <Tooltip title="Promote to primary">
                        <IconButton
                          edge="end"
                          onClick={() => handlePromoteInstance(instance.instance_id)}
                          disabled={instance.status !== 'active'}
                        >
                          <CloudIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Remove instance">
                        <IconButton
                          edge="end"
                          onClick={() => handleRemoveInstance(instance.instance_id)}
                          color="error"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    </>
                  }>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="subtitle1">{instance.instance_name}</Typography>
                          <Chip
                            size="small"
                            label={instance.status}
                            color={getStatusColor(instance.status) as any}
                          />
                          {instance.location && (
                            <Chip size="small" label={instance.location} variant="outlined" />
                          )}
                        </Box>
                      }
                      secondary={
                        <Box>
                          <Typography variant="body2" color="text.secondary">
                            ID: {instance.instance_id}
                          </Typography>
                          {instance.last_heartbeat && (
                            <Typography variant="body2" color="text.secondary">
                              Last heartbeat: {new Date(instance.last_heartbeat).toLocaleString()}
                            </Typography>
                          )}
                          {instance.system_info && (
                            <Typography variant="body2" color="text.secondary">
                              {instance.system_info.platform} • {formatUptime(instance.system_info.uptime)} uptime
                            </Typography>
                          )}
                          {instance.connection_info && (
                            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                              <Typography variant="body2" color="text.secondary">
                                Sync errors: {instance.connection_info.syncErrors}
                              </Typography>
                              {instance.connection_info.latency && (
                                <Typography variant="body2" color="text.secondary">
                                  Latency: {instance.connection_info.latency}ms
                                </Typography>
                              )}
                            </Box>
                          )}
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
      >
        <Alert 
          onClose={handleCloseSnackbar} 
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      {/* Token Info Dialog */}
      <Dialog
        open={showTokenDialog}
        onClose={() => setShowTokenDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Authentication Token Information</DialogTitle>
        <DialogContent>
          {authStatus ? (
            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle2" gutterBottom>Authentication Status</Typography>
                <Chip
                  label={authStatus.isAuthenticated ? 'Valid' : 'Invalid'}
                  color={authStatus.isAuthenticated ? 'success' : 'error'}
                  size="small"
                />
              </Box>
              {authStatus.tokenExpiry && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>Token Expires</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {new Date(authStatus.tokenExpiry).toLocaleString()}
                  </Typography>
                </Box>
              )}
              {authStatus.lastAuth && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>Last Authentication</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {new Date(authStatus.lastAuth).toLocaleString()}
                  </Typography>
                </Box>
              )}
              {!authStatus.isAuthenticated && (
                <Alert severity="warning">
                  Authentication token is invalid or expired. Use the "Re-authenticate" button to obtain a new token.
                </Alert>
              )}
            </Stack>
          ) : (
            <Typography>Loading authentication information...</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowTokenDialog(false)}>Close</Button>
          {authStatus && !authStatus.isAuthenticated && (
            <Button
              onClick={() => {
                setShowTokenDialog(false);
                handleReAuthenticate();
              }}
              variant="contained"
              color="warning"
            >
              Re-authenticate Now
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DistributedMonitoringSettings;