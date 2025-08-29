import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useParams } from 'react-router-dom';
import { ThemeProvider, CssBaseline, createTheme, CircularProgress, Box } from '@mui/material';
import AuthProvider, { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import EndpointList from './components/EndpointList';
import EndpointDetail from './components/EndpointDetail';
import Settings from './components/Settings';
import StatusPage from './components/StatusPage';
import LoginPage from './components/LoginPage';
import type { Endpoint } from './types';
import { updateFavicon, checkMonitorStatus } from './utils/favicon';

interface ThemeSettings {
  mode: 'light' | 'dark';
  primaryColor: string;
  secondaryColor: string;
  errorColor: string;
  warningColor: string;
  infoColor: string;
  successColor: string;
}

const defaultThemeSettings: ThemeSettings = {
  mode: 'light',
  primaryColor: '#419468',
  secondaryColor: '#78faae',
  errorColor: '#d32f2f',
  warningColor: '#ed6c02',
  infoColor: '#0288d1',
  successColor: '#59bc87',
};

function StatusPageWrapper() {
  const { slug } = useParams<{ slug: string }>();
  
  if (!slug) {
    return <div>Invalid status page URL</div>;
  }

  return <StatusPage slug={slug} />;
}

function ProtectedApp() {
  const { user, loading } = useAuth();
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(defaultThemeSettings);

  // Load theme settings and listen for changes
  useEffect(() => {
    // Load saved theme settings from localStorage
    const savedSettings = localStorage.getItem('app_theme_settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setThemeSettings({ ...defaultThemeSettings, ...parsed });
      } catch (error) {
        console.error('Failed to parse theme settings:', error);
      }
    }

    // Listen for theme change events
    const handleThemeChange = (event: CustomEvent) => {
      setThemeSettings(event.detail);
    };

    window.addEventListener('themeChanged', handleThemeChange as EventListener);
    
    return () => {
      window.removeEventListener('themeChanged', handleThemeChange as EventListener);
    };
  }, []);

  // Create dynamic theme based on settings
  const theme = createTheme({
    palette: {
      mode: themeSettings.mode,
      primary: {
        main: themeSettings.primaryColor,
      },
      secondary: {
        main: themeSettings.secondaryColor,
      },
      error: {
        main: themeSettings.errorColor,
      },
      warning: {
        main: themeSettings.warningColor,
      },
      info: {
        main: themeSettings.infoColor,
      },
      success: {
        main: themeSettings.successColor,
      },
    },
  });

  if (loading) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box 
          sx={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '100vh' 
          }}
        >
          <CircularProgress />
        </Box>
      </ThemeProvider>
    );
  }

  if (!user) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LoginPage />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <MainApp />
    </ThemeProvider>
  );
}

function MainApp() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isCreatingNewMonitor, setIsCreatingNewMonitor] = useState(false);
  const [isEditingMonitor, setIsEditingMonitor] = useState(false);
  const { user } = useAuth();

  const fetchData = useCallback(() => {
    // Don't auto-refresh when creating or editing a monitor to avoid interruption
    if (isCreatingNewMonitor || isEditingMonitor) {
      return;
    }

    fetch('/api/endpoints')
      .then((res) => res.json())
      .then((data) => {
        setEndpoints(data);
        // Update selected endpoint if it exists in the new data
        setSelectedEndpoint(prev => {
          if (prev) {
            // For newly created endpoints (that might have just received a real ID), 
            // try to find by name and URL if ID lookup fails
            let updatedSelected = data.find((e: Endpoint) => e.id === prev.id);
            
            if (!updatedSelected && typeof prev.id === 'string' && prev.id.startsWith('temp-')) {
              // If the previous endpoint was a temp one, find by name and URL
              updatedSelected = data.find((e: Endpoint) => 
                e.name === prev.name && e.url === prev.url
              );
            }
            
            return updatedSelected || null;
          }
          return prev;
        });
      })
      .catch((error) => {
        console.error('Error fetching endpoints:', error);
      });
  }, [isCreatingNewMonitor, isEditingMonitor]);

  useEffect(() => {
    // Initial fetch
    fetchData();

    // Set up interval to fetch data every 30 seconds
    const interval = setInterval(fetchData, 30000);

    // Cleanup interval on component unmount
    return () => clearInterval(interval);
  }, [fetchData]);

  // Update favicon based on monitor status
  useEffect(() => {
    const hasFailed = checkMonitorStatus(endpoints);
    updateFavicon(hasFailed);
  }, [endpoints]);

  const addEndpoint = () => {
    const tempId = `temp-${Date.now()}`;
    const newEndpoint: Endpoint = {
      id: tempId as string, // Temporary ID
      name: 'New Monitor',
      type: 'http',
      url: '',
      status: 'pending',
      heartbeat_interval: 60,
      retries: 3,
      http_method: 'GET',
      http_headers: '',
      http_body: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_checked: '',
      current_response: 0,
      avg_response_24h: 0,
      uptime_24h: 0,
      uptime_30d: 0,
      uptime_1y: 0,
      cert_expires_in: null,
      cert_expiry_date: null,
      ok_http_statuses: [],
      check_cert_expiry: false,
      cert_expiry_threshold: 30,
      keyword_search: null,
      upside_down_mode: false,
      paused: false,
      client_cert_enabled: false,
      client_cert_public_key: null,
      client_cert_private_key: null,
      client_cert_ca: null,
    };
    setEndpoints([...endpoints, newEndpoint]);
    setSelectedEndpoint(newEndpoint);
    setIsCreatingNewMonitor(true); // Pause auto-refresh during creation
  };

  const cancelNewMonitor = () => {
    // Remove the temporary endpoint from the list
    setEndpoints(endpoints.filter(e => !(typeof e.id === 'string' && e.id.startsWith('temp-'))));
    setSelectedEndpoint(null);
    setIsCreatingNewMonitor(false); // Resume auto-refresh
  };

  const deleteEndpoint = async (id: number) => {
    await fetch(`/api/endpoints/${id}`, {
      method: 'DELETE',
    });
    setEndpoints(endpoints.filter((endpoint) => endpoint.id !== id));
    if (selectedEndpoint?.id === id) {
      setSelectedEndpoint(null);
    }
  };

  const updateEndpoint = async (endpoint: Endpoint) => {
    const isNew = typeof endpoint.id === 'string' && endpoint.id.startsWith('temp-');
    
    if (isNew) {
      // The endpoint is already optimistically added. Now, send it to the server.
      setIsCreatingNewMonitor(true); // Pause polling during the API call
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _, ...endpointData } = endpoint;
        const res = await fetch(`/api/endpoints`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(endpointData),
        });
        if (!res.ok) {
          throw new Error(`Server responded with ${res.status}: ${await res.text()}`);
        }
        const newEndpointWithId = await res.json();

        // Replace the temporary endpoint with the real one from the server response
        setEndpoints(prevEndpoints =>
          prevEndpoints.map(e => (e.id === endpoint.id ? newEndpointWithId : e))
        );
        setSelectedEndpoint(newEndpointWithId);
      } catch (error) {
        console.error('Error creating endpoint:', error);
        // On error, roll back the optimistic update by removing the temporary endpoint
        setEndpoints(endpoints.filter(e => e.id !== endpoint.id));
        setSelectedEndpoint(null);
      } finally {
        setIsCreatingNewMonitor(false);
      }
    } else {
      setIsEditingMonitor(true); // Pause polling
      try {
        const res = await fetch(`/api/endpoints/${endpoint.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(endpoint),
        });
        if (!res.ok) {
          throw new Error(`Server responded with ${res.status}: ${await res.text()}`);
        }
        const updatedEndpoint = await res.json();
        setEndpoints(
          endpoints.map((e) => (e.id === updatedEndpoint.id ? updatedEndpoint : e))
        );
        setSelectedEndpoint(updatedEndpoint);
      } catch (error) {
        console.error('Error updating endpoint:', error);
        // Optionally, refetch data to ensure UI is in sync after a failed update
        // fetchData();
      } finally {
        setIsEditingMonitor(false);
      }
    }
  };

  const togglePauseEndpoint = async (id: number) => {
    try {
      const res = await fetch(`/api/endpoints/${id}/toggle-pause`, {
        method: 'POST',
      });
      const result = await res.json();
      
      // Update the endpoint in the list
      setEndpoints(endpoints.map(endpoint => {
        if (endpoint.id === id) {
          return { ...endpoint, paused: result.paused };
        }
        return endpoint;
      }));
      
      // Update selected endpoint if it's the same one
      if (selectedEndpoint?.id === id) {
        setSelectedEndpoint({ ...selectedEndpoint, paused: result.paused });
      }
    } catch (error) {
      console.error('Error toggling pause status:', error);
    }
  };

  return (
    <>
      <Layout
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        master={
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            height: '100%',
            overflow: 'hidden'
          }}>
            <Box sx={{ 
              flexGrow: 1, 
              overflow: 'auto',
              minHeight: 0
            }}>
              <EndpointList
                endpoints={endpoints}
                onSelect={setSelectedEndpoint}
                selectedId={selectedEndpoint?.id}
                onTogglePause={togglePauseEndpoint}
                onAddEndpoint={user?.role === 'admin' ? addEndpoint : undefined}
              />
            </Box>
          </Box>
        }
        detail={
          <Box sx={{ 
            height: '100%', 
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column'
          }}>
              <EndpointDetail
                key={selectedEndpoint ? selectedEndpoint.id : 'none'}
                endpoint={selectedEndpoint}
                endpoints={endpoints}
                onUpdate={updateEndpoint}
                onDelete={deleteEndpoint}
                onTogglePause={togglePauseEndpoint}
                onCancelCreation={cancelNewMonitor}
                onEditingChange={setIsEditingMonitor}
                onRefresh={fetchData}
                isPaused={isCreatingNewMonitor || isEditingMonitor}
              />
          </Box>
        }
      />
      <Settings 
        open={showSettings} 
        onClose={() => setShowSettings(false)} 
      />
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/status/:slug" element={<StatusPageWrapper />} />
        <Route path="/*" element={<ProtectedApp />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
