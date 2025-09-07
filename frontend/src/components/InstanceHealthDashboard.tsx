import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent, Typography, Alert, CircularProgress, Chip } from '@mui/material';
import { api } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';

interface DistributedConfig {
  role: 'primary' | 'dependent' | 'standalone';
  config: {
    instanceName: string;
    instanceLocation?: string;
    primarySyncURL?: string;
  };
  validation: {
    isValid: boolean;
    errors: string[];
  };
}

interface InstanceInfo {
  id: number;
  instance_id: string;
  instance_name: string;
  location?: string;
  status: string;
  last_heartbeat?: string;
}

const InstanceHealthDashboard: React.FC = () => {
  const { user } = useAuth();
  const [config, setConfig] = useState<DistributedConfig | null>(null);
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('InstanceHealthDashboard useEffect - user:', user);
    console.log('User authenticated:', !!user);
    console.log('User role:', user?.role);

    if (user && user.role === 'admin') {
      fetchDistributedConfig();
    } else if (user && user.role !== 'admin') {
      setError('Admin role required to access instance health data');
      setLoading(false);
    } else if (!user) {
      setError('Authentication required to access instance health data. Please log in with an admin account.');
      setLoading(false);
    }
  }, [user]);

  const fetchDistributedConfig = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('User authentication status:', { user, isAuthenticated: !!user, role: user?.role });

      // Check if user is authenticated and has admin role
      if (!user) {
        throw new Error('User not authenticated');
      }

      if (user.role !== 'admin') {
        throw new Error('Admin role required to access instance health data');
      }

      // Fetch distributed configuration
      console.log('Fetching distributed config from /api/system/distributed-config');
      const configResponse = await api.get('/api/system/distributed-config');
      console.log('Config response status:', configResponse.status);
      console.log('Config response ok:', configResponse.ok);

      if (!configResponse.ok) {
        const errorText = await configResponse.text();
        console.error('Failed to fetch config - Status:', configResponse.status, 'Response:', errorText);
        throw new Error(`Failed to fetch config: ${configResponse.status} - ${errorText}`);
      }

      const configResponseData = await configResponse.json();
      if (!configResponseData.success) {
        throw new Error(configResponseData.error || 'Failed to fetch configuration data.');
      }
      const configData: DistributedConfig = configResponseData.data;
      console.log('Distributed config:', configData);
      setConfig(configData);

      // If primary, fetch registered instances
      if (configData.role === 'primary') {
        try {
          console.log('Fetching registered instances from /api/sync/instances/frontend');
          const instancesResponse = await api.get('/api/sync/instances/frontend');
          console.log('Instances response status:', instancesResponse.status);
          console.log('Instances response ok:', instancesResponse.ok);

          if (instancesResponse.ok) {
            const responseText = await instancesResponse.text();
            console.log('Raw response text:', responseText);
            try {
              const instancesData = JSON.parse(responseText);
              console.log('Parsed instances data:', instancesData);
              console.log('Registered instances array:', instancesData.data || []);
              setInstances(instancesData.data || []);
            } catch (parseError) {
              console.error('JSON parse error:', parseError);
              setError(`Failed to parse response: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`);
            }
          } else {
            const errorText = await instancesResponse.text();
            console.error('Failed to fetch instances - Status:', instancesResponse.status, 'Response:', errorText);
            setError(`Failed to fetch instances: ${instancesResponse.status} - ${errorText}`);
          }
        } catch (err) {
          console.error('Error fetching instances:', err);
          setError(`Error fetching instances: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    } catch (err) {
      console.error('Error fetching distributed config:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
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
      <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
        <Card elevation={2}>
          <CardContent>
            <Typography variant="h5" component="div" sx={{ mb: 2 }}>
              Instance Health Dashboard
            </Typography>
            <Alert severity="error">
              Error loading configuration: {error}
            </Alert>
          </CardContent>
        </Card>
      </Box>
    );
  }

  const renderModeInfo = () => {
    if (!config) return null;

    const { role, config: instanceConfig } = config;
    const dependentCount = instances.length;

    switch (role) {
      case 'primary':
        return (
          <Alert severity="success">
            <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
              Running in PRIMARY mode
            </Typography>
            <Typography variant="body2">
              Instance: {instanceConfig.instanceName}
              {instanceConfig.instanceLocation && ` (${instanceConfig.instanceLocation})`}
            </Typography>
            <Typography variant="body2">
              Registered dependent instances: {dependentCount}
            </Typography>
            {dependentCount > 0 && (
              <Box sx={{ mt: 1 }}>
                {(() => {
                  console.log('[DEBUG InstanceHealthDashboard] instances before map:', instances);
                  console.log('[DEBUG InstanceHealthDashboard] instances Array.isArray:', Array.isArray(instances));
                  console.log('[DEBUG InstanceHealthDashboard] instances type:', typeof instances);
                  
                  if (!Array.isArray(instances)) {
                    console.error('[DEBUG InstanceHealthDashboard] instances is not an array:', instances);
                    return null;
                  }
                  
                  return instances.map((instance) => (
                    <Chip
                      key={instance.instance_id}
                      label={`${instance.instance_name} (${instance.status})`}
                      size="small"
                      color={instance.status === 'active' ? 'success' : 'warning'}
                      sx={{ mr: 1, mb: 1 }}
                    />
                  ));
                })()}
              </Box>
            )}
          </Alert>
        );

      case 'dependent':
        return (
          <Alert severity="info">
            <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
              Running in DEPENDENT mode
            </Typography>
            <Typography variant="body2">
              Instance: {instanceConfig.instanceName}
              {instanceConfig.instanceLocation && ` (${instanceConfig.instanceLocation})`}
            </Typography>
            <Typography variant="body2">
              Primary URL: {instanceConfig.primarySyncURL}
            </Typography>
          </Alert>
        );

      case 'standalone':
      default:
        return (
          <Alert severity="info">
            <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
              Running in STANDALONE mode
            </Typography>
            <Typography variant="body2">
              Instance: {instanceConfig.instanceName}
              {instanceConfig.instanceLocation && ` (${instanceConfig.instanceLocation})`}
            </Typography>
            <Typography variant="body2">
              No distributed monitoring instances configured.
            </Typography>
          </Alert>
        );
    }
  };

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Card elevation={2}>
        <CardContent>
          <Typography variant="h5" component="div" sx={{ mb: 2 }}>
            Instance Health Dashboard
          </Typography>
          {renderModeInfo()}
        </CardContent>
      </Card>
    </Box>
  );
};

export default InstanceHealthDashboard;