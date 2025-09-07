import React, { useState, useEffect } from 'react';
import { 
  Typography, 
  Card, 
  CardContent, 
  Table, 
  TableBody, 
  TableCell, 
  TableContainer, 
  TableHead, 
  TableRow, 
  Paper, 
  Chip,
  Box,
  CircularProgress,
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import HttpIcon from '@mui/icons-material/Http';
import DnsIcon from '@mui/icons-material/Dns';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ErrorIcon from '@mui/icons-material/Error';
import SecurityIcon from '@mui/icons-material/Security';
import StorageIcon from '@mui/icons-material/Storage';
import type { Outage } from '../types';
import { formatDateTime } from '../utils/timezone';

interface OutageHistoryProps {
  endpointId: number;
}

const OutageHistory: React.FC<OutageHistoryProps> = ({ endpointId }) => {
  const [outages, setOutages] = useState<Outage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const fetchOutages = async () => {
      try {
        setLoading(true);
        console.log(`[DEBUG] Fetching outages for endpoint ${endpointId}`);
        const response = await fetch(`/api/endpoints/${endpointId}/outages`);
        console.log(`[DEBUG] Response status for endpoint ${endpointId}:`, response.status, response.statusText);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch outage history: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log(`[DEBUG] Raw response data for endpoint ${endpointId}:`, data);
        console.log(`[DEBUG] data.data type for endpoint ${endpointId}:`, typeof data.data, Array.isArray(data.data));
        
        if (data.success && Array.isArray(data.data)) {
          setOutages(data.data);
        } else if (data.success && !data.data) {
          console.log(`[DEBUG] No outage data for endpoint ${endpointId}, setting empty array`);
          setOutages([]);
        } else {
          console.error(`[DEBUG] Unexpected response format for endpoint ${endpointId}:`, data);
          setOutages([]);
        }
        setError(null);
      } catch (err) {
        console.error(`Failed to fetch outages for endpoint ${endpointId}:`, err);
        setError(err instanceof Error ? err.message : 'An error occurred');
        setOutages([]); // Ensure outages is always an array
      } finally {
        setLoading(false);
      }
    };

    fetchOutages();
  }, [endpointId]);

  const handleDeleteOutages = async () => {
    try {
      setDeleting(true);
      const response = await fetch(`/api/endpoints/${endpointId}/outages`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete outage history');
      }

      await response.json();
      setOutages([]);
      setDeleteDialogOpen(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete outage history');
    } finally {
      setDeleting(false);
    }
  };


  const getFailureIcon = (reason: string) => {
    const iconProps = { fontSize: 'small' as const };
    
    if (reason.toLowerCase().includes('dns')) {
      return <DnsIcon {...iconProps} />;
    }
    if (reason.toLowerCase().includes('timeout')) {
      return <AccessTimeIcon {...iconProps} />;
    }
    if (reason.toLowerCase().includes('http') || reason.toLowerCase().includes('status')) {
      return <HttpIcon {...iconProps} />;
    }
    if (reason.toLowerCase().includes('ssl') || reason.toLowerCase().includes('tls') || reason.toLowerCase().includes('certificate')) {
      return <SecurityIcon {...iconProps} />;
    }
    if (reason.toLowerCase().includes('connection')) {
      return <NetworkCheckIcon {...iconProps} />;
    }
    if (reason.toLowerCase().includes('kafka') || reason.toLowerCase().includes('broker') || reason.toLowerCase().includes('topic')) {
      return <StorageIcon {...iconProps} />;
    }
    return <ErrorIcon {...iconProps} />;
  };

  const getFailureColor = (reason: string) => {
    if (reason.toLowerCase().includes('dns')) {
      return '#ff9800'; // orange
    }
    if (reason.toLowerCase().includes('timeout')) {
      return '#ff5722'; // deep orange
    }
    if (reason.toLowerCase().includes('http') || reason.toLowerCase().includes('status')) {
      return '#2196f3'; // blue
    }
    if (reason.toLowerCase().includes('ssl') || reason.toLowerCase().includes('tls') || reason.toLowerCase().includes('certificate')) {
      return '#9c27b0'; // purple
    }
    if (reason.toLowerCase().includes('connection')) {
      return '#f44336'; // red
    }
    if (reason.toLowerCase().includes('kafka') || reason.toLowerCase().includes('broker') || reason.toLowerCase().includes('topic')) {
      return '#607d8b'; // blue grey
    }
    return '#757575'; // grey
  };

  const getStatusChip = (outage: Outage) => {
    if (outage.ended_at === null) {
      return <Chip label="Ongoing" color="error" size="small" />;
    }
    return <Chip label="Resolved" color="default" size="small" />;
  };

  if (loading) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Outage History</Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Outage History</Typography>
          <Alert severity="error">{error}</Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2 }}>Outage History</Typography>
        
        {outages.length === 0 ? (
          <Alert severity="info">No outages recorded for this endpoint.</Alert>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Status</TableCell>
                  <TableCell>Started</TableCell>
                  <TableCell>Ended</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell>Reason</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {outages.map((outage, index) => (
                  <TableRow key={index} hover>
                    <TableCell>
                      {getStatusChip(outage)}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {formatDateTime(outage.started_at)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {outage.ended_at ? (
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {formatDateTime(outage.ended_at)}
                        </Typography>
                      ) : (
                        <Typography variant="body2" color="text.secondary" fontStyle="italic">
                          Ongoing
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography 
                        variant="body2" 
                        sx={{ 
                          fontFamily: 'monospace',
                          color: outage.ended_at === null ? 'error.main' : 'text.primary'
                        }}
                      >
                        {outage.duration_text}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {getFailureIcon(outage.reason)}
                        <Typography 
                          variant="body2"
                          sx={{ 
                            fontFamily: 'monospace',
                            color: getFailureColor(outage.reason)
                          }}
                        >
                          {outage.reason}
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        
        {outages.length > 0 && (
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              Showing last {outages.length} outage{outages.length !== 1 ? 's' : ''}
            </Typography>
            <Button
              size="small"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setDeleteDialogOpen(true)}
              variant="outlined"
            >
              Clear History
            </Button>
          </Box>
        )}

        <Dialog
          open={deleteDialogOpen}
          onClose={() => setDeleteDialogOpen(false)}
          aria-labelledby="delete-dialog-title"
          aria-describedby="delete-dialog-description"
        >
          <DialogTitle id="delete-dialog-title">
            Delete Outage History
          </DialogTitle>
          <DialogContent>
            <DialogContentText id="delete-dialog-description">
              Are you sure you want to delete all outage history for this monitor? This action cannot be undone.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button 
              onClick={handleDeleteOutages} 
              color="error" 
              variant="contained"
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
};

export default OutageHistory;
