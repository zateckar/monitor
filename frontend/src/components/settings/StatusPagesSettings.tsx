import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControlLabel,
  Switch,
  Chip,
  Paper,
  IconButton,
  Grid,
  Alert,
  Checkbox,
  FormGroup,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkIcon from '@mui/icons-material/Link';
import AddIcon from '@mui/icons-material/Add';
import type { StatusPage, Endpoint } from '../../types';

const StatusPagesSettings: React.FC = () => {
  const [statusPages, setStatusPages] = useState<StatusPage[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<StatusPage | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
    is_public: true,
    monitor_ids: [] as number[],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatusPages();
    fetchEndpoints();
  }, []);

  const fetchStatusPages = async () => {
    try {
      const response = await fetch('/api/status-pages');
      const data = await response.json();
      setStatusPages(data);
    } catch (err) {
      setError('Failed to fetch status pages');
    }
  };

  const fetchEndpoints = async () => {
    try {
      const response = await fetch('/api/endpoints');
      const data = await response.json();
      setEndpoints(data);
    } catch (err) {
      setError('Failed to fetch endpoints');
    }
  };

  const generateSlugFromName = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  };

  const handleNameChange = (name: string) => {
    setFormData({
      ...formData,
      name,
      slug: generateSlugFromName(name),
    });
  };

  const handleCreate = () => {
    setEditingPage(null);
    setFormData({
      name: '',
      slug: '',
      description: '',
      is_public: true,
      monitor_ids: [],
    });
    setIsDialogOpen(true);
  };

  const handleEdit = (page: StatusPage) => {
    setEditingPage(page);
    setFormData({
      name: page.name,
      slug: page.slug,
      description: page.description || '',
      is_public: page.is_public,
      monitor_ids: page.monitor_ids,
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.slug.trim()) {
      setError('Name and slug are required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = editingPage 
        ? `/api/status-pages/${editingPage.id}`
        : '/api/status-pages';
      
      const method = editingPage ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save status page');
      }

      await fetchStatusPages();
      setIsDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save status page');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this status page?')) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/status-pages/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete status page');
      }

      await fetchStatusPages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete status page');
    } finally {
      setLoading(false);
    }
  };

  const handleMonitorToggle = (monitorId: number) => {
    const currentIds = formData.monitor_ids;
    const newIds = currentIds.includes(monitorId)
      ? currentIds.filter(id => id !== monitorId)
      : [...currentIds, monitorId];
    
    setFormData({
      ...formData,
      monitor_ids: newIds,
    });
  };

  const copyStatusPageUrl = (slug: string) => {
    const url = `${window.location.origin}/status/${slug}`;
    navigator.clipboard.writeText(url);
    // You could add a toast notification here
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6">Status Pages</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleCreate}
        >
          Create Status Page
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {statusPages.length === 0 ? (
        <Paper sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            No status pages created yet. Create your first status page to share monitor status publicly.
          </Typography>
        </Paper>
      ) : (
        <List>
          {statusPages.map((page) => (
            <ListItem key={page.id} sx={{ border: 1, borderColor: 'divider', mb: 1, borderRadius: 1 }}>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="subtitle1">{page.name}</Typography>
                    <Chip
                      label={page.is_public ? 'Public' : 'Private'}
                      size="small"
                      color={page.is_public ? 'success' : 'default'}
                    />
                  </Box>
                }
                secondary={
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {page.description || 'No description'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Slug: {page.slug} • {page.monitor_ids.length} monitors
                    </Typography>
                  </Box>
                }
              />
              <ListItemSecondaryAction>
                <IconButton
                  size="small"
                  onClick={() => copyStatusPageUrl(page.slug)}
                  title="Copy Status Page URL"
                >
                  <LinkIcon />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => handleEdit(page)}
                >
                  <EditIcon />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => handleDelete(page.id)}
                  color="error"
                >
                  <DeleteIcon />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
      )}

      <Dialog open={isDialogOpen} onClose={() => setIsDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingPage ? 'Edit Status Page' : 'Create Status Page'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  label="Name"
                  fullWidth
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  error={!formData.name.trim()}
                  helperText={!formData.name.trim() ? 'Name is required' : ''}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="URL Slug"
                  fullWidth
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  error={!formData.slug.trim()}
                  helperText={
                    !formData.slug.trim() 
                      ? 'Slug is required' 
                      : `Status page will be available at: ${window.location.origin}/status/${formData.slug}`
                  }
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Description"
                  fullWidth
                  multiline
                  rows={2}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.is_public}
                      onChange={(e) => setFormData({ ...formData, is_public: e.target.checked })}
                    />
                  }
                  label="Public (accessible without authentication)"
                />
              </Grid>
              <Grid item xs={12}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Select Monitors to Include:
                </Typography>
                <Paper sx={{ p: 2, maxHeight: 300, overflow: 'auto' }}>
                  <FormGroup>
                    {endpoints.map((endpoint) => (
                      <FormControlLabel
                        key={endpoint.id}
                        control={
                          <Checkbox
                            checked={formData.monitor_ids.includes(Number(endpoint.id))}
                            onChange={() => handleMonitorToggle(Number(endpoint.id))}
                          />
                        }
                        label={
                          <Box>
                            <Typography variant="body2">{endpoint.name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {endpoint.url} • {endpoint.type}
                            </Typography>
                          </Box>
                        }
                      />
                    ))}
                  </FormGroup>
                </Paper>
                {formData.monitor_ids.length === 0 && (
                  <Typography variant="caption" color="error">
                    Please select at least one monitor
                  </Typography>
                )}
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={loading || !formData.name.trim() || !formData.slug.trim() || formData.monitor_ids.length === 0}
          >
            {loading ? 'Saving...' : editingPage ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default StatusPagesSettings;
