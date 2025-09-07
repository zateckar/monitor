import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Button,
  Chip,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  Stack,
  Tooltip,
  CircularProgress,
  Divider,
} from '@mui/material';
import {
  KeyboardArrowUp as ArrowUpIcon,
  KeyboardArrowDown as ArrowDownIcon,
  CloudUpload as PromoteIcon,
  Refresh as RefreshIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  PlayArrow as TestIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { MonitoringInstance } from '../../types';
import { useDistributedMonitoringUpdates } from '../../hooks/useRealTimeUpdates';
import RealTimeStatusIndicator from '../RealTimeStatusIndicator';

interface FailoverConfigurationSettingsProps {
  currentRole: 'standalone' | 'primary' | 'dependent';
}

interface FailoverTestResult {
  instanceId: string;
  success: boolean;
  message: string;
  latency?: number;
}

interface SortableInstanceItemProps {
  instance: MonitoringInstance;
  onPromote: (instanceId: string) => void;
  onTest: (instanceId: string) => void;
  isPromoting: boolean;
  isTesting: boolean;
}

const SortableInstanceItem: React.FC<SortableInstanceItemProps> = ({
  instance,
  onPromote,
  onTest,
  isPromoting,
  isTesting
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: instance.instance_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <CheckCircleIcon fontSize="small" />;
      case 'failed': return <ErrorIcon fontSize="small" />;
      default: return undefined;
    }
  };

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      divider
      sx={{
        cursor: 'grab',
        '&:active': { cursor: 'grabbing' },
        backgroundColor: isDragging ? 'action.hover' : 'inherit',
      }}
    >
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="subtitle1">{instance.instance_name}</Typography>
            <Chip
              icon={getStatusIcon(instance.status)}
              label={instance.status.toUpperCase()}
              color={getStatusColor(instance.status) as any}
              size="small"
            />
            <Chip
              label={`Order: ${instance.failover_order}`}
              size="small"
              variant="outlined"
            />
            {instance.location && (
              <Chip
                label={instance.location}
                size="small"
                variant="outlined"
                color="primary"
              />
            )}
          </Box>
        }
        secondary={
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              ID: {instance.instance_id}
            </Typography>
            {instance.last_heartbeat && (
              <Typography variant="body2" color="text.secondary">
                Last heartbeat: {new Date(instance.last_heartbeat).toLocaleString()}
              </Typography>
            )}
            {instance.system_info && (
              <Typography variant="body2" color="text.secondary">
                {instance.system_info.platform} • {Math.floor(instance.system_info.uptime / 3600)}h uptime
              </Typography>
            )}
          </Box>
        }
      />
      <ListItemSecondaryAction>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Test connectivity">
            <IconButton
              edge="end"
              onClick={() => onTest(instance.instance_id)}
              disabled={isTesting || instance.status !== 'active'}
              size="small"
            >
              {isTesting ? <CircularProgress size={16} /> : <TestIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Promote to primary">
            <IconButton
              edge="end"
              onClick={() => onPromote(instance.instance_id)}
              disabled={isPromoting || instance.status !== 'active'}
              color="primary"
              size="small"
            >
              {isPromoting ? <CircularProgress size={16} /> : <PromoteIcon />}
            </IconButton>
          </Tooltip>
        </Stack>
      </ListItemSecondaryAction>
    </ListItem>
  );
};

const FailoverConfigurationSettings: React.FC<FailoverConfigurationSettingsProps> = ({
  currentRole
}) => {
  const { data: distributedData, status: distributedStatus, forceRefresh: refreshData } = useDistributedMonitoringUpdates(currentRole === 'primary');
  
  const [instances, setInstances] = useState<MonitoringInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [promotingInstance, setPromotingInstance] = useState<string | null>(null);
  const [testingInstance, setTestingInstance] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<FailoverTestResult[]>([]);
  const [promotionDialog, setPromotionDialog] = useState<{
    open: boolean;
    instance?: MonitoringInstance;
  }>({ open: false });
  const [testAllRunning, setTestAllRunning] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
  }>({ open: false, message: '', severity: 'success' });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Update instances from real-time data
  useEffect(() => {
    if (distributedData?.instances) {
      // Sort by failover order
      const sortedData = distributedData.instances.sort((a: MonitoringInstance, b: MonitoringInstance) =>
        a.failover_order - b.failover_order
      );
      setInstances(sortedData);
      setLoading(false);
    }
  }, [distributedData]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = instances.findIndex(instance => instance.instance_id === active.id);
    const newIndex = instances.findIndex(instance => instance.instance_id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const newInstances = arrayMove(instances, oldIndex, newIndex);
      
      // Update failover orders
      const updatedInstances = newInstances.map((instance, index) => ({
        ...instance,
        failover_order: index + 1
      }));

      setInstances(updatedInstances);

      try {
        // Send the reorder request to the backend
        const response = await fetch('/api/sync/failover-order', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instanceOrders: updatedInstances.map(instance => ({
              instanceId: instance.instance_id,
              order: instance.failover_order
            }))
          })
        });

        if (!response.ok) {
          throw new Error('Failed to update failover order');
        }

        setSnackbar({
          open: true,
          message: 'Failover order updated successfully',
          severity: 'success'
        });
      } catch (error) {
        console.error('Failed to update failover order:', error);
        setSnackbar({
          open: true,
          message: 'Failed to update failover order',
          severity: 'error'
        });
        // Revert changes
        refreshData();
      }
    }
  };

  const handlePromoteInstance = (instanceId: string) => {
    const instance = instances.find(i => i.instance_id === instanceId);
    if (instance) {
      setPromotionDialog({ open: true, instance });
    }
  };

  const confirmPromotion = async () => {
    if (!promotionDialog.instance) return;

    setPromotingInstance(promotionDialog.instance.instance_id);
    setPromotionDialog({ open: false });

    try {
      const response = await fetch(`/api/system/instances/${promotionDialog.instance.instance_id}/promote`, {
        method: 'POST'
      });

      if (response.ok) {
        setSnackbar({
          open: true,
          message: `Successfully initiated promotion of ${promotionDialog.instance.instance_name}`,
          severity: 'success'
        });
        refreshData();
      } else {
        throw new Error('Promotion request failed');
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Failed to promote instance: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'error'
      });
    } finally {
      setPromotingInstance(null);
    }
  };

  const handleTestInstance = async (instanceId: string) => {
    setTestingInstance(instanceId);

    try {
      const response = await fetch(`/api/system/instances/${instanceId}/test`, {
        method: 'POST'
      });

      const result = await response.json();
      
      const testResult: FailoverTestResult = {
        instanceId,
        success: result.success,
        message: result.message || (result.success ? 'Connection successful' : 'Connection failed'),
        latency: result.latency
      };

      setTestResults(prev => {
        const filtered = prev.filter(r => r.instanceId !== instanceId);
        return [...filtered, testResult];
      });

      setSnackbar({
        open: true,
        message: testResult.success ? 
          `Test successful: ${testResult.message}` : 
          `Test failed: ${testResult.message}`,
        severity: testResult.success ? 'success' : 'error'
      });
    } catch (error) {
      const testResult: FailoverTestResult = {
        instanceId,
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };

      setTestResults(prev => {
        const filtered = prev.filter(r => r.instanceId !== instanceId);
        return [...filtered, testResult];
      });

      setSnackbar({
        open: true,
        message: `Test failed: ${testResult.message}`,
        severity: 'error'
      });
    } finally {
      setTestingInstance(null);
    }
  };

  const handleTestAllInstances = async () => {
    setTestAllRunning(true);
    setTestResults([]);

    try {
      for (const instance of instances.filter(i => i.status === 'active')) {
        await handleTestInstance(instance.instance_id);
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } finally {
      setTestAllRunning(false);
    }
  };

  const getTestResult = (instanceId: string) => {
    return testResults.find(r => r.instanceId === instanceId);
  };

  if (currentRole !== 'primary') {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <SettingsIcon />
            Failover Configuration
          </Typography>
          <Alert severity="info">
            Failover configuration is only available on primary instances. 
            Switch to primary mode to manage failover settings.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    );
  }

  const activeInstances = instances.filter(i => i.status === 'active');
  const hasTestResults = testResults.length > 0;

  return (
    <>
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <SettingsIcon />
              Failover Configuration
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<TestIcon />}
                onClick={handleTestAllInstances}
                disabled={testAllRunning || activeInstances.length === 0}
              >
                {testAllRunning ? 'Testing...' : 'Test All'}
              </Button>
              <RealTimeStatusIndicator
                status={distributedStatus}
                loading={loading}
                onRefresh={refreshData}
                label="Instances"
                size="small"
                showDetails={false}
              />
            </Stack>
          </Box>

          {instances.length === 0 ? (
            <Alert severity="info">
              No dependent instances registered. Configure dependent instances to enable failover.
            </Alert>
          ) : (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                Drag and drop instances to reorder failover priority. Lower numbers have higher priority.
              </Alert>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={instances.map(i => i.instance_id)}
                  strategy={verticalListSortingStrategy}
                >
                  <List>
                    {instances.map((instance) => (
                      <SortableInstanceItem
                        key={instance.instance_id}
                        instance={instance}
                        onPromote={handlePromoteInstance}
                        onTest={handleTestInstance}
                        isPromoting={promotingInstance === instance.instance_id}
                        isTesting={testingInstance === instance.instance_id}
                      />
                    ))}
                  </List>
                </SortableContext>
              </DndContext>

              {hasTestResults && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle1" sx={{ mb: 1 }}>
                    Test Results
                  </Typography>
                  <List dense>
                    {testResults.map((result) => {
                      const instance = instances.find(i => i.instance_id === result.instanceId);
                      return (
                        <ListItem key={result.instanceId}>
                          <ListItemText
                            primary={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="body2">
                                  {instance?.instance_name || result.instanceId}
                                </Typography>
                                <Chip
                                  icon={result.success ? <CheckCircleIcon /> : <ErrorIcon />}
                                  label={result.success ? 'Success' : 'Failed'}
                                  color={result.success ? 'success' : 'error'}
                                  size="small"
                                />
                                {result.latency && (
                                  <Typography variant="caption" color="text.secondary">
                                    {result.latency}ms
                                  </Typography>
                                )}
                              </Box>
                            }
                            secondary={result.message}
                          />
                        </ListItem>
                      );
                    })}
                  </List>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Promotion Confirmation Dialog */}
      <Dialog open={promotionDialog.open} onClose={() => setPromotionDialog({ open: false })}>
        <DialogTitle>Confirm Instance Promotion</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to promote "{promotionDialog.instance?.instance_name}" to primary?
            This will demote the current primary instance to dependent status.
          </DialogContentText>
          <Alert severity="warning" sx={{ mt: 2 }}>
            This action will cause a brief interruption in monitoring while the promotion takes place.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPromotionDialog({ open: false })}>Cancel</Button>
          <Button onClick={confirmPromotion} variant="contained" color="warning">
            Promote
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default FailoverConfigurationSettings;