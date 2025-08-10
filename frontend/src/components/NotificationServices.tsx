import React, { useState, useEffect } from 'react';
import type { NotificationService } from '../types';
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
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

const NotificationServices: React.FC = () => {
  const [services, setServices] = useState<NotificationService[]>([]);
  const [editingService, setEditingService] = useState<NotificationService | null>(null);

  useEffect(() => {
    fetch('/api/notification-services')
      .then(res => res.json())
      .then(setServices);
  }, []);

  const handleEdit = (service: NotificationService) => {
    setEditingService({ ...service });
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/notification-services/${id}`, { method: 'DELETE' });
    setServices(services.filter(s => s.id !== id));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingService) return;

    const url = editingService.id ? `/api/notification-services/${editingService.id}` : '/api/notification-services';
    const method = editingService.id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingService),
    });
    const savedService = await res.json();

    if (editingService.id) {
      setServices(services.map(s => s.id === savedService.id ? savedService : s));
    } else {
      setServices([...services, savedService]);
    }
    setEditingService(null);
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
    <Card>
      <CardContent>
        <Typography variant="h5" component="div" sx={{ mb: 2 }}>
          Notification Services
        </Typography>
        <Button
          variant="contained"
          onClick={() => setEditingService({ id: 0, name: '', type: 'telegram', config: {} })}
          sx={{ mb: 2 }}
        >
          Add Service
        </Button>

        {editingService && (
          <Card component="form" onSubmit={handleSave} sx={{ mb: 2 }}>
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

        <List>
          {services.map(service => (
            <ListItem key={service.id} divider>
              <ListItemText primary={service.name} secondary={service.type} />
              <ListItemSecondaryAction>
                <IconButton edge="end" aria-label="edit" onClick={() => handleEdit(service)}>
                  <EditIcon />
                </IconButton>
                <IconButton edge="end" aria-label="delete" onClick={() => handleDelete(service.id)}>
                  <DeleteIcon />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
      </CardContent>
    </Card>
  );
};

export default NotificationServices;
