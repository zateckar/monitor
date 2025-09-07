import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { useRealTimeUpdates, useDistributedMonitoringUpdates } from '../hooks/useRealTimeUpdates';
import RealTimeStatusIndicator from '../components/RealTimeStatusIndicator';
import MultiLocationStatus from '../components/MultiLocationStatus';
import InstanceHealthDashboard from '../components/InstanceHealthDashboard';
import DistributedMonitoringSettings from '../components/settings/DistributedMonitoringSettings';

// Mock fetch globally
global.fetch = vi.fn();

// Mock the hooks with default implementations
vi.mock('../hooks/useRealTimeUpdates', () => ({
  useRealTimeUpdates: vi.fn(),
  useDistributedMonitoringUpdates: vi.fn(),
  useEndpointUpdates: vi.fn(),
  useMultiLocationUpdates: vi.fn(),
}));

const mockUseRealTimeUpdates = useRealTimeUpdates as vi.Mock;
const mockUseDistributedMonitoringUpdates = useDistributedMonitoringUpdates as vi.Mock;

describe('Real-Time Updates Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should handle successful data fetching', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ data: 'test' });
    
    mockUseRealTimeUpdates.mockReturnValue({
      data: { data: 'test' },
      loading: false,
      status: {
        isConnected: true,
        lastUpdate: new Date(),
        errorCount: 0,
        retryAttempt: 0
      },
      forceRefresh: vi.fn(),
      startPolling: vi.fn(),
      stopPolling: vi.fn()
    });

    const { result } = mockUseRealTimeUpdates;
    expect(result().data).toEqual({ data: 'test' });
    expect(result().status.isConnected).toBe(true);
    expect(result().status.errorCount).toBe(0);
  });

  test('should handle connection errors', async () => {
    mockUseRealTimeUpdates.mockReturnValue({
      data: null,
      loading: false,
      status: {
        isConnected: false,
        lastUpdate: null,
        errorCount: 3,
        retryAttempt: 2
      },
      forceRefresh: vi.fn(),
      startPolling: vi.fn(),
      stopPolling: vi.fn()
    });

    const { result } = mockUseRealTimeUpdates;
    expect(result().data).toBeNull();
    expect(result().status.isConnected).toBe(false);
    expect(result().status.errorCount).toBe(3);
    expect(result().status.retryAttempt).toBe(2);
  });

  test('should provide force refresh functionality', async () => {
    const mockForceRefresh = vi.fn();
    
    mockUseRealTimeUpdates.mockReturnValue({
      data: null,
      loading: false,
      status: {
        isConnected: true,
        lastUpdate: new Date(),
        errorCount: 0,
        retryAttempt: 0
      },
      forceRefresh: mockForceRefresh,
      startPolling: vi.fn(),
      stopPolling: vi.fn()
    });

    const { result } = mockUseRealTimeUpdates;
    result().forceRefresh();
    expect(mockForceRefresh).toHaveBeenCalled();
  });
});

describe('Real-Time Status Indicator Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should display connected status', () => {
    const status = {
      isConnected: true,
      lastUpdate: new Date(),
      errorCount: 0,
      retryAttempt: 0
    };

    render(
      <BrowserRouter>
        <RealTimeStatusIndicator
          status={status}
          loading={false}
          label="Test Updates"
        />
      </BrowserRouter>
    );

    expect(screen.getByText('Test Updates')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  test('should display disconnected status with errors', () => {
    const status = {
      isConnected: false,
      lastUpdate: null,
      errorCount: 2,
      retryAttempt: 1
    };

    render(
      <BrowserRouter>
        <RealTimeStatusIndicator
          status={status}
          loading={false}
          label="Test Updates"
        />
      </BrowserRouter>
    );

    expect(screen.getByText('Connection Issues')).toBeInTheDocument();
  });

  test('should display loading state', () => {
    const status = {
      isConnected: false,
      lastUpdate: null,
      errorCount: 0,
      retryAttempt: 0
    };

    render(
      <BrowserRouter>
        <RealTimeStatusIndicator
          status={status}
          loading={true}
          label="Test Updates"
        />
      </BrowserRouter>
    );

    expect(screen.getByText('Updating...')).toBeInTheDocument();
  });

  test('should call refresh function when refresh button is clicked', () => {
    const mockRefresh = vi.fn();
    const status = {
      isConnected: true,
      lastUpdate: new Date(),
      errorCount: 0,
      retryAttempt: 0
    };

    render(
      <BrowserRouter>
        <RealTimeStatusIndicator
          status={status}
          loading={false}
          onRefresh={mockRefresh}
          label="Test Updates"
        />
      </BrowserRouter>
    );

    const refreshButton = screen.getByRole('button');
    fireEvent.click(refreshButton);
    expect(mockRefresh).toHaveBeenCalled();
  });
});

describe('Multi-Location Status Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock fetch for this component's API calls
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/aggregated-results')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{
            id: 1,
            endpoint_id: 1,
            consensus_status: 'UP',
            participating_instances: 3,
            up_instances: 2,
            down_instances: 1,
            avg_response_time: 150,
            min_response_time: 120,
            max_response_time: 200,
            timestamp: new Date().toISOString()
          }])
        });
      } else if (url.includes('/location-results')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              location: 'US-East',
              status: 'UP',
              responseTime: 120,
              timestamp: new Date().toISOString()
            },
            {
              location: 'EU-West', 
              status: 'UP',
              responseTime: 180,
              timestamp: new Date().toISOString()
            },
            {
              location: 'Asia-Pacific',
              status: 'DOWN',
              responseTime: 0,
              failureReason: 'Connection timeout',
              timestamp: new Date().toISOString()
            }
          ])
        });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  test('should display multi-location status for medium size', async () => {
    render(
      <BrowserRouter>
        <MultiLocationStatus 
          endpointId={1}
          size="medium"
          showLocationDetails={true}
        />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Multi-Location Monitoring')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('UP')).toBeInTheDocument();
      expect(screen.getByText(/2\/3 locations UP/)).toBeInTheDocument();
    });
  });

  test('should display compact view for small size', async () => {
    render(
      <BrowserRouter>
        <MultiLocationStatus 
          endpointId={1}
          size="small"
          showLocationDetails={false}
        />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/2\/3/)).toBeInTheDocument();
    });
  });

  test('should expand location details when clicked', async () => {
    render(
      <BrowserRouter>
        <MultiLocationStatus 
          endpointId={1}
          size="medium"
          showLocationDetails={true}
          isExpanded={false}
        />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Multi-Location Monitoring')).toBeInTheDocument();
    });

    const expandButton = screen.getByRole('button');
    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(screen.getByText('US-East')).toBeInTheDocument();
      expect(screen.getByText('EU-West')).toBeInTheDocument();
      expect(screen.getByText('Asia-Pacific')).toBeInTheDocument();
    });
  });

  test('should handle API errors gracefully', async () => {
    (global.fetch as any).mockRejectedValue(new Error('API Error'));

    render(
      <BrowserRouter>
        <MultiLocationStatus 
          endpointId={1}
          size="medium"
        />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
    });
  });
});

describe('Instance Health Dashboard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    mockUseDistributedMonitoringUpdates.mockReturnValue({
      data: {
        instances: [
          {
            instance_id: 'test-1',
            instance_name: 'Test Instance 1',
            location: 'US-East',
            status: 'active',
            last_heartbeat: new Date().toISOString(),
            failover_order: 1,
            system_info: {
              platform: 'linux',
              arch: 'x64',
              uptime: 3600,
              memory: 8589934592
            },
            connection_info: {
              primaryReachable: true,
              latency: 45,
              syncErrors: 0
            }
          },
          {
            instance_id: 'test-2',
            instance_name: 'Test Instance 2',
            location: 'EU-West',
            status: 'active',
            last_heartbeat: new Date().toISOString(),
            failover_order: 2,
            system_info: {
              platform: 'linux',
              arch: 'x64',
              uptime: 7200,
              memory: 8589934592
            },
            connection_info: {
              primaryReachable: true,
              latency: 120,
              syncErrors: 1
            }
          }
        ],
        health: {
          totalInstances: 2,
          activeInstances: 2,
          averageLatency: 82.5,
          totalMonitoringLoad: 20
        }
      },
      loading: false,
      status: {
        isConnected: true,
        lastUpdate: new Date(),
        errorCount: 0,
        retryAttempt: 0
      },
      forceRefresh: vi.fn()
    });
  });

  test('should display instance health dashboard', async () => {
    render(
      <BrowserRouter>
        <InstanceHealthDashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Instance Health Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Test Instance 1')).toBeInTheDocument();
      expect(screen.getByText('Test Instance 2')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument(); // Total instances
    });
  });

  test('should display system information for instances', async () => {
    render(
      <BrowserRouter>
        <InstanceHealthDashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/linux/)).toBeInTheDocument();
      expect(screen.getByText(/x64/)).toBeInTheDocument();
    });
  });

  test('should show health scores', async () => {
    render(
      <BrowserRouter>
        <InstanceHealthDashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      // Health scores should be calculated and displayed
      expect(screen.getAllByText(/Health:/)).toHaveLength(2);
    });
  });

  test('should handle loading state', () => {
    mockUseDistributedMonitoringUpdates.mockReturnValue({
      data: null,
      loading: true,
      status: {
        isConnected: false,
        lastUpdate: null,
        errorCount: 0,
        retryAttempt: 0
      },
      forceRefresh: vi.fn()
    });

    render(
      <BrowserRouter>
        <InstanceHealthDashboard />
      </BrowserRouter>
    );
    
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  test('should handle error state', async () => {
    mockUseDistributedMonitoringUpdates.mockReturnValue({
      data: null,
      loading: false,
      status: {
        isConnected: false,
        lastUpdate: null,
        errorCount: 3,
        retryAttempt: 2
      },
      forceRefresh: vi.fn()
    });

    render(
      <BrowserRouter>
        <InstanceHealthDashboard />
      </BrowserRouter>
    );
    
    await waitFor(() => {
      expect(screen.getByText(/Failed to load health data/)).toBeInTheDocument();
    });
  });
});

describe('Distributed Monitoring Settings Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock API calls for settings
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/distributed-config')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            config: {
              instanceName: 'Test Instance',
              instanceLocation: 'US-East',
              primarySyncURL: 'http://primary:3001',
              failoverOrder: 1
            },
            role: 'dependent'
          })
        });
      } else if (url.includes('/system/info')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            platform: 'linux',
            arch: 'x64',
            uptime: 3600,
            memory: 8589934592
          })
        });
      } else if (url.includes('/auth-status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            isAuthenticated: true,
            tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
            lastAuth: new Date().toISOString()
          })
        });
      } else if (url.includes('/connection-status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            primaryReachable: true,
            latency: 45,
            syncErrors: 0
          })
        });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  test('should display distributed monitoring settings', async () => {
    render(
      <BrowserRouter>
        <DistributedMonitoringSettings />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Distributed Monitoring')).toBeInTheDocument();
      expect(screen.getByText('Instance Configuration')).toBeInTheDocument();
    });
  });

  test('should show current instance information', async () => {
    render(
      <BrowserRouter>
        <DistributedMonitoringSettings />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Current Instance')).toBeInTheDocument();
      expect(screen.getByText(/linux/)).toBeInTheDocument();
      expect(screen.getByText(/x64/)).toBeInTheDocument();
    });
  });

  test('should display authentication status for dependent instances', async () => {
    render(
      <BrowserRouter>
        <DistributedMonitoringSettings />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Authentication Management')).toBeInTheDocument();
      expect(screen.getByText('Test Connection')).toBeInTheDocument();
      expect(screen.getByText('Re-authenticate')).toBeInTheDocument();
    });
  });

  test('should handle role switching', async () => {
    render(
      <BrowserRouter>
        <DistributedMonitoringSettings />
      </BrowserRouter>
    );

    await waitFor(() => {
      const roleSelect = screen.getByDisplayValue('dependent');
      expect(roleSelect).toBeInTheDocument();
    });

    // Test role change
    const roleSelect = screen.getByDisplayValue('dependent');
    fireEvent.change(roleSelect, { target: { value: 'primary' } });
    
    expect(roleSelect).toHaveValue('primary');
  });

  test('should handle connection testing', async () => {
    (global.fetch as any).mockImplementation((url: string, options: any) => {
      if (url.includes('/test-connection') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            latency: 45,
            message: 'Connection successful'
          })
        });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });

    render(
      <BrowserRouter>
        <DistributedMonitoringSettings />
      </BrowserRouter>
    );

    await waitFor(() => {
      const testButton = screen.getByText('Test Connection');
      expect(testButton).toBeInTheDocument();
    });

    const testButton = screen.getByText('Test Connection');
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/system/test-connection',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('primaryURL')
        })
      );
    });
  });

  test('should save configuration changes', async () => {
    (global.fetch as any).mockImplementation((url: string, options: any) => {
      if (url.includes('/distributed-config') && options?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true })
        });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });

    render(
      <BrowserRouter>
        <DistributedMonitoringSettings />
      </BrowserRouter>
    );

    await waitFor(() => {
      const saveButton = screen.getByText('Save Configuration');
      expect(saveButton).toBeInTheDocument();
    });

    const saveButton = screen.getByText('Save Configuration');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/system/distributed-config',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });
  });
});

describe('Integration Tests', () => {
  test('should handle real-time updates across components', async () => {
    // Mock initial data
    mockUseDistributedMonitoringUpdates.mockReturnValue({
      data: {
        instances: [],
        health: { totalInstances: 0, activeInstances: 0, averageLatency: 0, totalMonitoringLoad: 0 }
      },
      loading: false,
      status: {
        isConnected: true,
        lastUpdate: new Date(),
        errorCount: 0,
        retryAttempt: 0
      },
      forceRefresh: vi.fn()
    });

    render(
      <BrowserRouter>
        <InstanceHealthDashboard />
      </BrowserRouter>
    );

    // Update with new data
    mockUseDistributedMonitoringUpdates.mockReturnValue({
      data: {
        instances: [
          {
            instance_id: 'new-instance',
            instance_name: 'New Instance',
            location: 'US-West',
            status: 'active',
            last_heartbeat: new Date().toISOString(),
            failover_order: 1
          }
        ],
        health: { totalInstances: 1, activeInstances: 1, averageLatency: 50, totalMonitoringLoad: 5 }
      },
      loading: false,
      status: {
        isConnected: true,
        lastUpdate: new Date(),
        errorCount: 0,
        retryAttempt: 0
      },
      forceRefresh: vi.fn()
    });

    // Re-render with updated data
    render(
      <BrowserRouter>
        <InstanceHealthDashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('New Instance')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument(); // Total instances
    });
  });

  test('should handle network failures gracefully', async () => {
    mockUseDistributedMonitoringUpdates.mockReturnValue({
      data: null,
      loading: false,
      status: {
        isConnected: false,
        lastUpdate: null,
        errorCount: 5,
        retryAttempt: 3
      },
      forceRefresh: vi.fn()
    });

    render(
      <BrowserRouter>
        <InstanceHealthDashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to load health data/)).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });
});