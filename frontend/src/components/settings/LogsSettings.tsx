import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Alert,
  Paper,
  List,
  ListItem,
  ListItemText,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import StorageIcon from '@mui/icons-material/Storage';

interface LogEntry {
  id: number;
  level: string;
  message: string;
  timestamp: string;
  component?: string;
}

interface DatabaseStats {
  size: string;
  tables: Array<{
    name: string;
    rows: number;
    size: string;
  }>;
}

const LogsSettings: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logLevel, setLogLevel] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [logLevelLoading, setLogLevelLoading] = useState(true);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [vacuumConfirmOpen, setVacuumConfirmOpen] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [dbStats, setDbStats] = useState<DatabaseStats | null>(null);

  useEffect(() => {
    loadLogs();
    loadLogLevel();
    loadDatabaseStats();
  }, []);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/logs');
      if (response.ok) {
        const data = await response.json();
        setLogs(data);
      }
    } catch (error) {
      console.error('Failed to load logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadLogLevel = async () => {
    try {
      setLogLevelLoading(true);
      const response = await fetch('/api/logs/level');
      if (response.ok) {
        const data = await response.json();
        setLogLevel(data.level);
      }
    } catch (error) {
      console.error('Failed to load log level:', error);
    } finally {
      setLogLevelLoading(false);
    }
  };

  const loadDatabaseStats = async () => {
    try {
      const response = await fetch('/api/database/stats');
      if (response.ok) {
        const data = await response.json();
        setDbStats(data);
      }
    } catch (error) {
      console.error('Failed to load database stats:', error);
    }
  };

  const updateLogLevel = async (newLevel: string) => {
    try {
      const response = await fetch('/api/logs/level', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: newLevel }),
      });
      
      if (response.ok) {
        setLogLevel(newLevel);
        showAlert('success', 'Log level updated successfully');
      } else {
        showAlert('error', 'Failed to update log level');
      }
    } catch {
      showAlert('error', 'Failed to update log level');
    }
  };

  const clearLogs = async () => {
    try {
      const response = await fetch('/api/logs', { method: 'DELETE' });
      if (response.ok) {
        setLogs([]);
        showAlert('success', 'Logs cleared successfully');
      } else {
        showAlert('error', 'Failed to clear logs');
      }
    } catch {
      showAlert('error', 'Failed to clear logs');
    }
    setClearConfirmOpen(false);
  };

  const vacuumDatabase = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/database/vacuum', { method: 'POST' });
      if (response.ok) {
        showAlert('success', 'Database vacuum completed successfully');
        loadDatabaseStats(); // Reload stats to show updated size
      } else {
        showAlert('error', 'Failed to vacuum database');
      }
    } catch {
      showAlert('error', 'Failed to vacuum database');
    } finally {
      setLoading(false);
    }
    setVacuumConfirmOpen(false);
  };

  const showAlert = (type: 'success' | 'error', message: string) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 5000);
  };

  const formatTimestamp = (timestamp: string) => {
    const timezone = localStorage.getItem('app_timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone;
    return new Date(timestamp).toLocaleString('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getLogLevelColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error': return 'error';
      case 'warn': return 'warning';
      case 'info': return 'info';
      case 'debug': return 'default';
      default: return 'default';
    }
  };

  return (
    <Box>
      <Typography variant="h5" component="div" sx={{ mb: 3 }}>
        Logs & Database
      </Typography>

      {alert && (
        <Alert severity={alert.type} sx={{ mb: 3 }}>
          {alert.message}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 3 }}>
        <Box sx={{ flex: '1 1 300px', minWidth: 300 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Log Level Configuration
              </Typography>
              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Log Level</InputLabel>
                <Select
                  value={logLevel}
                  onChange={(e) => updateLogLevel(e.target.value)}
                  label="Log Level"
                  disabled={logLevelLoading}
                >
                  <MenuItem value="debug">Debug (All messages)</MenuItem>
                  <MenuItem value="info">Info (Info, Warn, Error)</MenuItem>
                  <MenuItem value="warn">Warning (Warn, Error only)</MenuItem>
                  <MenuItem value="error">Error (Errors only)</MenuItem>
                </Select>
              </FormControl>
              <Typography variant="body2" color="text.secondary">
                Current level: {logLevelLoading ? (
                  <CircularProgress size={16} />
                ) : (
                  <Chip label={logLevel.toUpperCase()} size="small" />
                )}
              </Typography>
            </CardContent>
          </Card>
        </Box>

        <Box sx={{ flex: '1 1 300px', minWidth: 300 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Database Management
              </Typography>
              {dbStats && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Database size: <strong>{dbStats.size}</strong>
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Tables: {dbStats.tables.length}
                  </Typography>
                </Box>
              )}
              <Button
                variant="outlined"
                startIcon={<StorageIcon />}
                onClick={() => setVacuumConfirmOpen(true)}
                disabled={loading}
              >
                Vacuum Database
              </Button>
            </CardContent>
          </Card>
        </Box>
      </Box>

      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              Application Logs
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={loadLogs}
                disabled={loading}
              >
                Refresh
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => setClearConfirmOpen(true)}
                disabled={logs.length === 0}
              >
                Clear Logs
              </Button>
            </Box>
          </Box>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Paper variant="outlined" sx={{ maxHeight: 400, overflow: 'auto' }}>
              <List dense>
                {logs.length === 0 ? (
                  <ListItem>
                    <ListItemText primary="No logs available" />
                  </ListItem>
                ) : (
                  logs.map((log) => (
                    <ListItem key={log.id} divider>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Chip
                              label={log.level.toUpperCase()}
                              size="small"
                              color={getLogLevelColor(log.level)}
                            />
                            <Typography variant="body2" component="span">
                              {log.message}
                            </Typography>
                          </Box>
                        }
                        secondary={
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                            <Typography variant="caption" color="text.secondary">
                              {formatTimestamp(log.timestamp)}
                            </Typography>
                            {log.component && (
                              <Typography variant="caption" color="text.secondary">
                                {log.component}
                              </Typography>
                            )}
                          </Box>
                        }
                      />
                    </ListItem>
                  ))
                )}
              </List>
            </Paper>
          )}
        </CardContent>
      </Card>

      {/* Clear Logs Confirmation Dialog */}
      <Dialog open={clearConfirmOpen} onClose={() => setClearConfirmOpen(false)}>
        <DialogTitle>Clear All Logs</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to clear all application logs? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearConfirmOpen(false)}>Cancel</Button>
          <Button onClick={clearLogs} color="error" variant="contained">
            Clear Logs
          </Button>
        </DialogActions>
      </Dialog>

      {/* Vacuum Database Confirmation Dialog */}
      <Dialog open={vacuumConfirmOpen} onClose={() => setVacuumConfirmOpen(false)}>
        <DialogTitle>Vacuum Database</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Database vacuum will optimize the database by reclaiming unused space and defragmenting the data.
            This may take a few moments depending on the database size.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Current database size: {dbStats?.size || 'Unknown'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVacuumConfirmOpen(false)}>Cancel</Button>
          <Button onClick={vacuumDatabase} variant="contained" disabled={loading}>
            {loading ? <CircularProgress size={20} /> : 'Vacuum Database'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LogsSettings;
