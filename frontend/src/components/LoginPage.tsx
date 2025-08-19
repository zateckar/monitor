import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Container,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
} from '@mui/material';
import { Login as LoginIcon } from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import type { OIDCProvider } from '../types';

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [oidcProviders, setOidcProviders] = useState<OIDCProvider[]>([]);
  const [oidcLoading, setOidcLoading] = useState(false);
  const { login, loading, checkAuth } = useAuth();

  // Fetch OIDC providers on mount
  useEffect(() => {
    const fetchOIDCProviders = async () => {
      try {
        const response = await fetch('/api/auth/oidc/providers');
        if (response.ok) {
          const providers = await response.json();
          setOidcProviders(providers);
        }
      } catch (error) {
        console.error('Failed to fetch OIDC providers:', error);
      }
    };

    fetchOIDCProviders();

    // Check for OIDC login success in URL params
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('oidc_login') === 'success') {
      // Clear the URL parameter and check authentication
      window.history.replaceState({}, document.title, window.location.pathname);
      checkAuth();
    }
  }, [checkAuth]);

  const handleOIDCLogin = async (providerId: number) => {
    setOidcLoading(true);
    setError('');
    
    try {
      const response = await fetch(`/api/auth/oidc/login/${providerId}`);
      const data = await response.json();
      
      if (response.ok && data.authorization_url) {
        // Redirect to OIDC provider
        window.location.href = data.authorization_url;
      } else {
        setError(data.error || 'Failed to initiate OIDC login');
      }
    } catch (_error) {
      setError('Failed to initiate OIDC login');
    } finally {
      setOidcLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username || !password) {
      setError('Please enter both username and password');
      return;
    }

    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Paper elevation={3} sx={{ padding: 4, width: '100%', maxWidth: 400 }}>
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Typography variant="h4" component="h1" gutterBottom>
              Monitor
            </Typography>
            <Typography variant="h6" color="text.secondary">
              Sign in to continue
            </Typography>
          </Box>

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              margin="normal"
              required
              disabled={loading}
              autoFocus
            />
            <TextField
              fullWidth
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              margin="normal"
              required
              disabled={loading}
            />

            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}

            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              disabled={loading}
              sx={{ mt: 3, mb: 2 }}
            >
              {loading ? <CircularProgress size={24} /> : 'Sign In'}
            </Button>
          </form>

          {/* OIDC Providers */}
          {oidcProviders.length > 0 && (
            <>
              <Divider sx={{ my: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  Or sign in with
                </Typography>
              </Divider>

              <List disablePadding>
                {oidcProviders.map((provider) => (
                  <ListItem key={provider.id} disablePadding>
                    <ListItemButton
                      onClick={() => handleOIDCLogin(provider.id)}
                      disabled={oidcLoading || loading}
                      sx={{
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1,
                        mb: 1,
                      }}
                    >
                      <ListItemIcon>
                        <LoginIcon />
                      </ListItemIcon>
                      <ListItemText
                        primary={`Sign in with ${provider.name}`}
                      />
                      {oidcLoading && <CircularProgress size={20} />}
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </>
          )}

        </Paper>
      </Box>
    </Container>
  );
};

export default LoginPage;
