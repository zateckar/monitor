import React, { useState, useEffect } from 'react';
import { Typography, Card, CardContent, Box, Chip, Button, Select, MenuItem, FormControl, InputLabel, ToggleButton, ToggleButtonGroup, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, CardHeader, Stack } from '@mui/material';
import type { Endpoint, NotificationService } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { getStoredTimePeriod, storeTimePeriod } from '../utils/localStorage';
import EndpointChart from './EndpointChart';
import EndpointStats from './EndpointStats';
import EditEndpointForm from './EditEndpointForm';
import OutageHistory from './OutageHistory';
import HeartbeatVisualization from './HeartbeatVisualization';
import Dashboard from './Dashboard';
import DeleteIcon from '@mui/icons-material/Delete';
import { Pause, PlayArrow } from '@mui/icons-material';
import ClearIcon from '@mui/icons-material/Clear';
import TimelineIcon from '@mui/icons-material/Timeline';
import NotificationsIcon from '@mui/icons-material/Notifications';
import HistoryIcon from '@mui/icons-material/History';
import DataUsageIcon from '@mui/icons-material/DataUsage';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';

interface EndpointDetailProps {
  endpoint: Endpoint | null;
  onUpdate: (endpoint: Endpoint) => void;
  onDelete: (id: number) => void;
  onTogglePause?: (id: number) => void;
  onCancelCreation?: () => void;
  onEditingChange?: (isEditing: boolean) => void;
  onRefresh?: () => void;
  isPaused?: boolean;
}

const EndpointDetail: React.FC<EndpointDetailProps> = ({ endpoint, onUpdate, onDelete, onTogglePause, onCancelCreation, onEditingChange, onRefresh, isPaused }) => {
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState(() => getStoredTimePeriod());
  const [isEditing, setIsEditing] = useState(false);
  const [allServices, setAllServices] = useState<NotificationService[]>([]);
  const [linkedServices, setLinkedServices] = useState<NotificationService[]>([]);
  const [selectedService, setSelectedService] = useState<number | ''>('');
  const [deleteHeartbeatsDialogOpen, setDeleteHeartbeatsDialogOpen] = useState(false);
  const [deletingHeartbeats, setDeletingHeartbeats] = useState(false);

  // Check if this is a new monitor and automatically start editing
  useEffect(() => {
    if (endpoint && typeof endpoint.id === 'string' && endpoint.id.startsWith('temp-')) {
      setIsEditing(true);
      onEditingChange?.(true);
    } else {
      setIsEditing(false);
      onEditingChange?.(false);
    }
  }, [endpoint, onEditingChange]);

  // Notify parent when editing state changes
  useEffect(() => {
    onEditingChange?.(isEditing);
  }, [isEditing, onEditingChange]);

  useEffect(() => {
    if (endpoint && typeof endpoint.id === 'number') {
      fetch('/api/notification-services')
        .then(res => res.json())
        .then(setAllServices);

      fetch(`/api/endpoints/${endpoint.id}/notification-services`)
        .then(res => res.json())
        .then(setLinkedServices);
    }
  }, [endpoint]);

  const handleTimeRangeChange = (
    _event: React.MouseEvent<HTMLElement>,
    newTimeRange: string | null,
  ) => {
    if (newTimeRange !== null) {
      setTimeRange(newTimeRange);
      storeTimePeriod(newTimeRange);
    }
  };

  const handleAddService = async () => {
    if (!endpoint || !selectedService) return;
    await fetch(`/api/endpoints/${endpoint.id}/notification-services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: selectedService }),
    });
    const serviceToAdd = allServices.find(s => s.id === selectedService);
    if (serviceToAdd) {
      setLinkedServices([...linkedServices, serviceToAdd]);
    }
    setSelectedService('');
  };

  const handleRemoveService = async (serviceId: number) => {
    if (!endpoint) return;
    await fetch(`/api/endpoints/${endpoint.id}/notification-services/${serviceId}`, {
      method: 'DELETE',
    });
    setLinkedServices(linkedServices.filter(s => s.id !== serviceId));
  };

  const handleDeleteHeartbeats = async () => {
    if (!endpoint || typeof endpoint.id !== 'number') return;
    
    try {
      setDeletingHeartbeats(true);
      const response = await fetch(`/api/endpoints/${endpoint.id}/heartbeats`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete heartbeat data');
      }

      setDeleteHeartbeatsDialogOpen(false);
      // Trigger a proper data refresh instead of page reload
      if (onRefresh) {
        onRefresh();
      }
    } catch (error) {
      console.error('Error deleting heartbeats:', error);
      alert('Failed to delete heartbeat data');
    } finally {
      setDeletingHeartbeats(false);
    }
  };

  if (!endpoint) {
    return <Dashboard isPaused={isPaused} onRefresh={onRefresh} />;
  }

  const getStatusColor = (status: string) => {
    if (status === 'UP') return 'success';
    if (status === 'DOWN') return 'error';
    return 'default';
  };

  if (isEditing) {
    return (
      <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
        <EditEndpointForm
          endpoint={endpoint}
          onUpdate={(updatedEndpoint) => {
            onUpdate(updatedEndpoint);
            setIsEditing(false);
          }}
          onCancel={() => {
            const isNewMonitor = typeof endpoint.id === 'string' && endpoint.id.startsWith('temp-');
            if (isNewMonitor && onCancelCreation) {
              onCancelCreation();
            } else {
              setIsEditing(false);
            }
          }}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Stack spacing={3}>
        {/* Header Card */}
        <Card elevation={2}>
          <CardHeader
            title={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <MonitorHeartIcon color="primary" />
                <Typography variant="h5" component="div">
                  {endpoint.name}
                </Typography>
              </Box>
            }
            subheader={
              <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', mt: 1 }}>
                {endpoint.url}
              </Typography>
            }
            action={
              <Chip 
                label={endpoint.status} 
                color={getStatusColor(endpoint.status)} 
                size="medium"
                sx={{ fontWeight: 'bold', fontSize: '1rem', py: 1 }}
              />
            }
          />
        </Card>

        {/* Recent Heartbeats Card */}
        {!endpoint.paused && typeof endpoint.id === 'number' && (
          <Card elevation={2}>
            <CardHeader
              title={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <MonitorHeartIcon color="primary" />
                  <Typography variant="h6">Recent Heartbeats</Typography>
                </Box>
              }
            />
            <CardContent sx={{ pt: 0 }}>
              <HeartbeatVisualization 
                endpointId={endpoint.id} 
                size="medium" 
                maxCount={150}
              />
            </CardContent>
          </Card>
        )}

        {/* Performance Chart Card */}
        {typeof endpoint.id === 'number' && (
          <Card elevation={2}>
            <CardHeader
              title={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TimelineIcon color="primary" />
                  <Typography variant="h6">Performance Chart</Typography>
                </Box>
              }
              action={
                <ToggleButtonGroup
                  value={timeRange}
                  exclusive
                  onChange={handleTimeRangeChange}
                  aria-label="Time range"
                  size="small"
                >
                  <ToggleButton value="3h" aria-label="3 hours">3h</ToggleButton>
                  <ToggleButton value="6h" aria-label="6 hours">6h</ToggleButton>
                  <ToggleButton value="24h" aria-label="24 hours">24h</ToggleButton>
                  <ToggleButton value="1w" aria-label="1 week">1w</ToggleButton>
                </ToggleButtonGroup>
              }
            />
            <CardContent sx={{ pt: 0 }}>
              <EndpointChart endpointId={endpoint.id} timeRange={timeRange} />
            </CardContent>
          </Card>
        )}

        {/* Statistics Cards */}
        {typeof endpoint.id === 'number' && (
          <Card elevation={2}>
            <CardHeader
              title={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <DataUsageIcon color="primary" />
                  <Typography variant="h6">Statistics</Typography>
                </Box>
              }
            />
            <CardContent sx={{ pt: 0 }}>
              <EndpointStats endpoint={endpoint} timeRange={timeRange} />
            </CardContent>
          </Card>
        )}

        {/* Notification Services Card */}
        {typeof endpoint.id === 'number' && (
          <Card elevation={2}>
            <CardHeader
              title={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <NotificationsIcon color="primary" />
                  <Typography variant="h6">Notification Services</Typography>
                </Box>
              }
            />
            <CardContent sx={{ pt: 0 }}>
              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <FormControl fullWidth>
                  <InputLabel>Add Service</InputLabel>
                  <Select
                    value={selectedService}
                    onChange={e => setSelectedService(e.target.value as number | '')}
                    label="Add Service"
                  >
                    {allServices
                      .filter(s => !linkedServices.some(ls => ls.id === s.id))
                      .map(service => (
                        <MenuItem key={service.id} value={service.id}>{service.name}</MenuItem>
                      ))}
                  </Select>
                </FormControl>
                <Button variant="contained" onClick={handleAddService} disabled={!selectedService}>
                  Add
                </Button>
              </Box>
              <Box>
                {linkedServices.length > 0 ? (
                  linkedServices.map(service => (
                    <Chip
                      key={service.id}
                      label={service.name}
                      onDelete={() => handleRemoveService(service.id)}
                      sx={{ mr: 1, mb: 1 }}
                    />
                  ))
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No notification services linked to this endpoint
                  </Typography>
                )}
              </Box>
            </CardContent>
          </Card>
        )}

        {/* Outage History Card */}
        {typeof endpoint.id === 'number' && (
          <Card elevation={2}>
            <CardHeader
              title={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <HistoryIcon color="primary" />
                  <Typography variant="h6">Outage History</Typography>
                </Box>
              }
            />
            <CardContent sx={{ pt: 0 }}>
              <OutageHistory endpointId={endpoint.id} />
            </CardContent>
          </Card>
        )}


        {/* Admin Actions Card */}
        {user?.role === 'admin' && (
          <Card elevation={2}>
            <CardHeader
              title={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AdminPanelSettingsIcon color="primary" />
                  <Typography variant="h6">Admin Actions</Typography>
                </Box>
              }
            />
            <CardContent sx={{ pt: 0 }}>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}>
                              {typeof endpoint.id === 'number' && (
                <Button
                  variant="outlined"
                  color="warning"
                  startIcon={<ClearIcon />}
                  onClick={() => setDeleteHeartbeatsDialogOpen(true)}
                >
                  Clear Heartbeats
                </Button>
              )}
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => {
                    if (typeof endpoint.id === 'number') {
                      onDelete(endpoint.id);
                    }
                  }}
                  disabled={typeof endpoint.id !== 'number'}
                >
                  Delete
                </Button>
                {onTogglePause && typeof endpoint.id === 'number' && (
                  <Button
                    variant="outlined"
                    color={endpoint.paused ? 'success' : 'warning'}
                    startIcon={endpoint.paused ? <PlayArrow /> : <Pause />}
                    onClick={() => onTogglePause(endpoint.id as number)}
                  >
                    {endpoint.paused ? 'Resume' : 'Pause'}
                  </Button>
                )}
                <Button variant="contained" onClick={() => setIsEditing(true)}>
                  Edit
                </Button>
              </Box>
            </CardContent>
          </Card>
        )}

        {/* Dialog remains the same */}
        <Dialog
          open={deleteHeartbeatsDialogOpen}
          onClose={() => setDeleteHeartbeatsDialogOpen(false)}
          aria-labelledby="delete-heartbeats-dialog-title"
          aria-describedby="delete-heartbeats-dialog-description"
        >
          <DialogTitle id="delete-heartbeats-dialog-title">
            Clear Heartbeat Data
          </DialogTitle>
          <DialogContent>
            <DialogContentText id="delete-heartbeats-dialog-description">
              Are you sure you want to clear all heartbeat data for this monitor? This will remove all historical response times, uptime statistics, and charts. This action cannot be undone.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteHeartbeatsDialogOpen(false)} disabled={deletingHeartbeats}>
              Cancel
            </Button>
            <Button 
              onClick={handleDeleteHeartbeats} 
              color="warning" 
              variant="contained"
              disabled={deletingHeartbeats}
            >
              {deletingHeartbeats ? 'Clearing...' : 'Clear Data'}
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </Box>
  );
};

export default EndpointDetail;
