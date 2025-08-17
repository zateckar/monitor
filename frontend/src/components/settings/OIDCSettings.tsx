import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControlLabel,
  Switch,
  IconButton,
  Alert,
  Chip,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Security as SecurityIcon,
} from '@mui/icons-material';
import type { OIDCProvider } from '../../types';

const OIDCSettings: React.FC = () => {
  const [providers, setProviders] = useState<OIDCProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<OIDCProvider | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    issuer_url: '',
    client_id: '',
    client_secret: '',
    scopes: 'openid profile email',
    redirect_base_url: window.location.origin,
    is_active: true,
  });

  const fetchProviders = async () => {
    try {
      const response = await fetch('/api/admin/oidc-providers', {
        credentials: 'include',
      });
      
      if (response.ok) {
        const data = await response.json();
        setProviders(data);
      } else {
        setError('Failed to fetch OIDC providers');
      }
    } catch (err) {
      console.error(err);
      setError('Failed to fetch OIDC providers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const handleOpenDialog = (provider?: OIDCProvider) => {
    if (provider) {
      setEditingProvider(provider);
      setFormData({
        name: provider.name,
        issuer_url: provider.issuer_url,
        client_id: provider.client_id,
        client_secret: provider.client_secret,
        scopes: provider.scopes,
        redirect_base_url: provider.redirect_base_url,
        is_active: provider.is_active,
      });
    } else {
      setEditingProvider(null);
      setFormData({
        name: '',
        issuer_url: '',
        client_id: '',
        client_secret: '',
        scopes: 'openid profile email',
        redirect_base_url: window.location.origin,
        is_active: true,
      });
    }
    setDialogOpen(true);
    setError('');
    setSuccess('');
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingProvider(null);
    setError('');
    setSuccess('');
  };

  const handleSave = async () => {
    try {
      const url = editingProvider
        ? `/api/admin/oidc-providers/${editingProvider.id}`
        : '/api/admin/oidc-providers';
      
      const method = editingProvider ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setSuccess(editingProvider ? 'Provider updated successfully' : 'Provider created successfully');
        await fetchProviders();
        handleCloseDialog();
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to save provider');
      }
    } catch (err) {
      console.error(err);
      setError('Failed to save provider');
    }
  };

  const handleDelete = async (provider: OIDCProvider) => {
    if (!confirm(`Are you sure you want to delete the OIDC provider "${provider.name}"?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/oidc-providers/${provider.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        setSuccess('Provider deleted successfully');
        await fetchProviders();
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to delete provider');
      }
    } catch (err) {
      console.error(err);
      setError('Failed to delete provider');
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  if (loading) {
    return <Typography>Loading OIDC providers...</Typography>;
  }

  return (
    <Box>
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SecurityIcon />
            <Typography variant="h6">OIDC Providers</Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleOpenDialog()}
          >
            Add OIDC Provider
          </Button>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
            {success}
          </Alert>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Configure OpenID Connect providers to allow users to authenticate using external identity providers.
        </Typography>

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Issuer URL</TableCell>
                <TableCell>Client ID</TableCell>
                <TableCell>Scopes</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {providers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography color="text.secondary">
                      No OIDC providers configured. Add one to get started.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                providers.map((provider) => (
                  <TableRow key={provider.id}>
                    <TableCell>{provider.name}</TableCell>
                    <TableCell>
                      <Tooltip title={provider.issuer_url}>
                        <Typography variant="body2" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {provider.issuer_url}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {provider.client_id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {provider.scopes}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={provider.is_active ? 'Active' : 'Inactive'}
                        color={provider.is_active ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <IconButton
                          size="small"
                          onClick={() => handleOpenDialog(provider)}
                        >
                          <EditIcon />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => handleDelete(provider)}
                          color="error"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingProvider ? 'Edit OIDC Provider' : 'Add OIDC Provider'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              fullWidth
              label="Provider Name"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              required
              helperText="A friendly name for this OIDC provider"
            />

            <TextField
              fullWidth
              label="Issuer URL"
              value={formData.issuer_url}
              onChange={(e) => handleInputChange('issuer_url', e.target.value)}
              required
              helperText="The OIDC provider's discovery endpoint URL (e.g., https://accounts.google.com)"
            />

            <TextField
              fullWidth
              label="Client ID"
              value={formData.client_id}
              onChange={(e) => handleInputChange('client_id', e.target.value)}
              required
              helperText="OAuth 2.0 client identifier"
            />

            <TextField
              fullWidth
              label="Client Secret"
              type="password"
              value={formData.client_secret}
              onChange={(e) => handleInputChange('client_secret', e.target.value)}
              required
              helperText="OAuth 2.0 client secret"
            />

            <TextField
              fullWidth
              label="Scopes"
              value={formData.scopes}
              onChange={(e) => handleInputChange('scopes', e.target.value)}
              required
              helperText="Space-separated list of OAuth 2.0 scopes (default: openid profile email)"
            />

            <TextField
              fullWidth
              label="Redirect Base URL"
              value={formData.redirect_base_url}
              onChange={(e) => handleInputChange('redirect_base_url', e.target.value)}
              required
              helperText="The base URL where this application is accessible (e.g., https://monitoring.example.com)"
            />

            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_active}
                  onChange={(e) => handleInputChange('is_active', e.target.checked)}
                />
              }
              label="Active"
            />

            {error && (
              <Alert severity="error">
                {error}
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleSave} variant="contained">
            {editingProvider ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default OIDCSettings;
