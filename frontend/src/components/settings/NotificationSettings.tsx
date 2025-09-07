import React, { useState, useEffect } from 'react';
import type { NotificationService } from '../../types';
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
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  CircularProgress,
  Alert,
  Snackbar,
  Tooltip,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import BugReportIcon from '@mui/icons-material/BugReport';

const NotificationSettings: React.FC = () => {
  const [services, setServices] = useState<NotificationService[]>([]);
  const [editingService, setEditingService] = useState<NotificationService | null>(null);
  const [testingServices, setTestingServices] = useState<Set<number>>(new Set());
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  useEffect(() => {
    fetch('/api/notifications/notification-services')
      .then(res => res.json())
      .then(result => {
        if (result.success) {
          setServices(Array.isArray(result.data) ? result.data : []);
        } else {
          setSnackbar({
            open: true,
            message: `Failed to fetch services: ${result.error || 'Unknown error'}`,
            severity: 'error',
          });
        }
      })
      .catch(err => {
        setSnackbar({
          open: true,
          message: `Failed to fetch services: ${err instanceof Error ? err.message : 'Network error'}`,
          severity: 'error',
        });
      });
  }, []);

  const handleEdit = (service: NotificationService) => {
    setEditingService({ ...service });
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/notifications/notification-services/${id}`, { method: 'DELETE' });
    setServices(services.filter(s => s.id !== id));
  };

  const handleTest = async (id: number, name: string) => {
    setTestingServices(prev => new Set(prev).add(id));
    
    try {
      const response = await fetch(`/api/notifications/notification-services/${id}/test`, {
        method: 'POST',
      });
      
      const result = await response.json();
      
      if (result.success) {
        setSnackbar({
          open: true,
          message: `Test notification sent successfully to "${name}"`, 
          severity: 'success'
        });
      } else {
        setSnackbar({
          open: true,
          message: `Test failed for "${name}": ${result.error}`, 
          severity: 'error'
        });
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Test failed for "${name}": ${error instanceof Error ? error.message : 'Unknown error'}`, 
        severity: 'error'
      });
    } finally {
      setTestingServices(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  const handleCloseSnackbar = () => {
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingService) return;

    const url = editingService.id
      ? `/api/notifications/notification-services/${editingService.id}`
      : '/api/notifications/notification-services';
    const method = editingService.id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingService),
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Invalid JSON response' }));
        throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
      }

      const result = await res.json();

      if (result.success) {
        const savedService = result.data;
        if (editingService.id) {
          setServices(services.map(s => (s.id === savedService.id ? savedService : s)));
        } else {
          setServices([...services, savedService]);
        }
        setEditingService(null);
        setSnackbar({
          open: true,
          message: 'Service saved successfully!',
          severity: 'success',
        });
      } else {
        throw new Error(result.error || 'Failed to save the service.');
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Failed to save service: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        severity: 'error',
      });
    }
  };

  const renderConfigFields = () => {
    if (!editingService) return null;

    switch (editingService.type) {
      case 'telegram':
        return (
          <>
            <TextField
              label="Bot Token"
              fullWidth
              margin="normal"
              value={editingService.config.botToken || ''}
              onChange={e => setEditingService({ ...editingService, config: { ...editingService.config, botToken: e.target.value } })}
            />
            <TextField
              label="Chat ID"
              fullWidth
              margin="normal"
              value={editingService.config.chatId || ''}
              onChange={e => setEditingService({ ...editingService, config: { ...editingService.config, chatId: e.target.value } })}
            />
          </>
        );
      case 'sendgrid':
        return (
          <>
            <TextField
              label="API Key"
              fullWidth
              margin="normal"
              value={editingService.config.apiKey || ''}
              onChange={e => setEditingService({ ...editingService, config: { ...editingService.config, apiKey: e.target.value } })}
            />
            <TextField
              label="To Email"
              type="email"
              fullWidth
              margin="normal"
              value={editingService.config.toEmail || ''}
              onChange={e => setEditingService({ ...editingService, config: { ...editingService.config, toEmail: e.target.value } })}
            />
            <TextField
              label="From Email"
              type="email"
              fullWidth
              margin="normal"
              value={editingService.config.fromEmail || ''}
              onChange={e => setEditingService({ ...editingService, config: { ...editingService.config, fromEmail: e.target.value } })}
            />
          </>
        );
      case 'slack':
        return (
          <TextField
            label="Webhook URL"
            fullWidth
            margin="normal"
            value={editingService.config.webhookUrl || ''}
            onChange={e => setEditingService({ ...editingService, config: { ...editingService.config, webhookUrl: e.target.value } })}
          />
        );
      case 'apprise':
        return (
          <>
            <TextField
              label="Server URL"
              fullWidth
              margin="normal"
              value={editingService.config.serverUrl || ''}
              onChange={e => setEditingService({ ...editingService, config: { ...editingService.config, serverUrl: e.target.value } })}
              helperText="Apprise API server URL (e.g., http://localhost:8000)"
            />
            <TextField
              label="Notification URLs"
              fullWidth
              margin="normal"
              multiline
              rows={4}
              value={editingService.config.notificationUrls || ''}
              onChange={e => setEditingService({ ...editingService, config: { ...editingService.config, notificationUrls: e.target.value } })}
              helperText="One or more Apprise notification URLs, one per line (e.g., slack://token/channel, discord://webhook_id/token)"
            />
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Box>
      <Typography variant="h5" component="div" sx={{ mb: 3 }}>
        Notification Services
      </Typography>
      
      <Button
        variant="contained"
        onClick={() => setEditingService({ id: 0, name: '', type: 'telegram', config: {} })}
        sx={{ mb: 3 }}
      >
        Add Service
      </Button>

      {editingService && (
        <Card component="form" onSubmit={handleSave} sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {editingService.id ? 'Edit' : 'Add'} Service
            </Typography>
            <TextField
              label="Service Name"
              fullWidth
              margin="normal"
              value={editingService.name}
              onChange={e => setEditingService({ ...editingService, name: e.target.value })}
            />
            <FormControl fullWidth margin="normal">
              <InputLabel>Type</InputLabel>
              <Select
                value={editingService.type}
                onChange={e => setEditingService({ ...editingService, type: e.target.value as NotificationService['type'], config: {} })}
                label="Type"
              >
                <MenuItem value="telegram">Telegram</MenuItem>
                <MenuItem value="sendgrid">SendGrid</MenuItem>
                <MenuItem value="slack">Slack</MenuItem>
                <MenuItem value="apprise">Apprise</MenuItem>
              </Select>
            </FormControl>
            {renderConfigFields()}
            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button onClick={() => setEditingService(null)}>Cancel</Button>
              <Button type="submit" variant="contained">Save</Button>
            </Box>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Configured Services
          </Typography>
          <List>
            {services.map(service => (
              <ListItem key={service.id} divider>
                <ListItemText primary={service.name} secondary={service.type} />
                <ListItemSecondaryAction>
                  <Tooltip title="Test notification">
                    <IconButton 
                      edge="end" 
                      aria-label="test" 
                      onClick={() => handleTest(service.id, service.name)}
                      disabled={testingServices.has(service.id)}
                    >
                      {testingServices.has(service.id) ? (
                        <CircularProgress size={20} />
                      ) : (
                        <BugReportIcon />
                      )}
                    </IconButton>
                  </Tooltip>
                  <IconButton edge="end" aria-label="edit" onClick={() => handleEdit(service)}>
                    <EditIcon />
                  </IconButton>
                  <IconButton edge="end" aria-label="delete" onClick={() => handleDelete(service.id)}>
                    <DeleteIcon />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
            {services.length === 0 && (
              <ListItem>
                <ListItemText 
                  primary="No notification services configured" 
                  secondary="Add a service to start receiving notifications"
                />
              </ListItem>
            )}
          </List>
        </CardContent>
      </Card>

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
    </Box>
  );
};

export default NotificationSettings;
