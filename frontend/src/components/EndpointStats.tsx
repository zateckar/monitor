import React, { useState, useEffect } from 'react';
import { Typography, Card, Box, CircularProgress, LinearProgress, Avatar, Stack, Button } from '@mui/material';
import type { Endpoint } from '../types';
import { formatDateTime, formatDate } from '../utils/timezone';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import SpeedIcon from '@mui/icons-material/Speed';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import SecurityIcon from '@mui/icons-material/Security';
import MonitorIcon from '@mui/icons-material/Monitor';
import CertificateModal from './CertificateModal';

interface EndpointStatsProps {
  endpoint: Endpoint;
  timeRange: string;
}

interface Stats {
  avg_response: number;
  uptime: number;
  monitoring_coverage: number;
}

const EndpointStats: React.FC<EndpointStatsProps> = ({ endpoint, timeRange }) => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [certificateModalOpen, setCertificateModalOpen] = useState(false);

  useEffect(() => {
    if (endpoint && typeof endpoint.id === 'number') {
      setLoading(true);
      fetch(`/api/endpoints/${endpoint.id}/stats?range=${timeRange}`)
        .then(res => res.json())
        .then(data => {
          setStats(data);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [endpoint, timeRange]);

  const timeRangeLabel = {
    '3h': '3 hours',
    '6h': '6 hours',
    '24h': '24 hours',
    '1w': '1 week',
  }[timeRange] || '24 hours';

  const getProgressColor = (value: number) => {
    if (value >= 99.9) return 'success';
    if (value >= 95) return 'warning';
    return 'error';
  };

  const getCoverageColor = (coverage: number) => {
    if (coverage >= 95) return 'success';
    if (coverage >= 80) return 'warning';
    return 'error';
  };

  const StatCard = ({ icon, title, value, subtitle, progress, color }: any) => (
    <Card variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Stack spacing={1}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Avatar sx={{ bgcolor: `${color}.main`, width: 32, height: 32 }}>
            {icon}
          </Avatar>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
            {title}
          </Typography>
        </Box>
        <Typography variant="h6" component="div" sx={{ fontWeight: 'bold' }}>
          {value}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}
        {progress !== undefined && (
          <LinearProgress 
            variant="determinate" 
            value={progress} 
            color={getProgressColor(progress)}
            sx={{ height: 6, borderRadius: 3 }}
          />
        )}
      </Stack>
    </Card>
  );

  return (
    <Box>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 150 }}>
          <CircularProgress />
        </Box>
      ) : stats ? (
        <Box 
          sx={{ 
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(auto-fit, minmax(250px, 1fr))',
              md: 'repeat(auto-fit, minmax(280px, 1fr))'
            },
            gap: 2
          }}
        >
          {/* Last Checked */}
          <StatCard
            icon={<AccessTimeIcon sx={{ fontSize: 18 }} />}
            title="Last Checked"
            value={endpoint.last_checked ? formatDateTime(endpoint.last_checked).split(' ')[1] : 'Never'}
            subtitle={endpoint.last_checked ? formatDateTime(endpoint.last_checked).split(' ')[0] : ''}
            color="primary"
          />

          {/* Current Response Time */}
          <StatCard
            icon={<SpeedIcon sx={{ fontSize: 18 }} />}
            title="Current Response"
            value={endpoint.current_response ? `${endpoint.current_response.toFixed(0)} ms` : 'N/A'}
            color={endpoint.current_response ? (endpoint.current_response < 500 ? 'success' : endpoint.current_response < 1000 ? 'warning' : 'error') : 'grey'}
          />

          {/* Average Response Time */}
          <StatCard
            icon={<SpeedIcon sx={{ fontSize: 18 }} />}
            title={`Avg. Response (${timeRangeLabel})`}
            value={`${stats.avg_response.toFixed(0)} ms`}
            color={stats.avg_response < 500 ? 'success' : stats.avg_response < 1000 ? 'warning' : 'error'}
          />

          {/* Monitoring Coverage */}
          <StatCard
            icon={<MonitorIcon sx={{ fontSize: 18 }} />}
            title={`Coverage (${timeRangeLabel})`}
            value={`${stats.monitoring_coverage.toFixed(1)}%`}
            subtitle={stats.monitoring_coverage < 100 ? 'Some gaps detected' : 'Complete coverage'}
            progress={stats.monitoring_coverage}
            color={getCoverageColor(stats.monitoring_coverage)}
          />

          {/* Uptime Current Period */}
          <StatCard
            icon={<TrendingUpIcon sx={{ fontSize: 18 }} />}
            title={`Uptime (${timeRangeLabel})`}
            value={`${stats.uptime.toFixed(2)}%`}
            progress={stats.uptime}
            color={getProgressColor(stats.uptime)}
          />

          {/* Uptime 30 Days */}
          <StatCard
            icon={<TrendingUpIcon sx={{ fontSize: 18 }} />}
            title="Uptime (30 days)"
            value={`${endpoint.uptime_30d !== null && endpoint.uptime_30d !== undefined ? endpoint.uptime_30d.toFixed(2) : '0.00'}%`}
            progress={endpoint.uptime_30d || 0}
            color={getProgressColor(endpoint.uptime_30d || 0)}
          />

          {/* Uptime 1 Year */}
          <StatCard
            icon={<TrendingUpIcon sx={{ fontSize: 18 }} />}
            title="Uptime (1 year)"
            value={`${endpoint.uptime_1y !== null && endpoint.uptime_1y !== undefined ? endpoint.uptime_1y.toFixed(2) : '0.00'}%`}
            progress={endpoint.uptime_1y || 0}
            color={getProgressColor(endpoint.uptime_1y || 0)}
          />

          {/* Certificate Expiry - Clickable */}
          <Card 
            variant="outlined" 
            sx={{ 
              p: 2, 
              height: '100%',
              cursor: endpoint.check_cert_expiry ? 'pointer' : 'default',
              '&:hover': endpoint.check_cert_expiry ? {
                backgroundColor: 'action.hover'
              } : {}
            }}
            onClick={() => endpoint.check_cert_expiry && setCertificateModalOpen(true)}
          >
            <Stack spacing={1}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Avatar sx={{ 
                  bgcolor: `${!endpoint.check_cert_expiry
                    ? 'grey'
                    : endpoint.cert_expires_in === null
                    ? 'info'
                    : endpoint.cert_expires_in <= 30
                    ? 'error'
                    : endpoint.cert_expires_in <= 90
                    ? 'warning'
                    : 'success'}.main`, 
                  width: 32, 
                  height: 32 
                }}>
                  <SecurityIcon sx={{ fontSize: 18 }} />
                </Avatar>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Certificate
                </Typography>
              </Box>
              <Typography variant="h6" component="div" sx={{ fontWeight: 'bold' }}>
                {!endpoint.check_cert_expiry
                  ? 'Not enabled'
                  : endpoint.cert_expires_in !== null
                  ? `${endpoint.cert_expires_in} days`
                  : endpoint.last_checked
                  ? 'Check failed'
                  : 'Checking...'}
              </Typography>
              {endpoint.cert_expiry_date && endpoint.cert_expires_in !== null && (
                <Typography variant="caption" color="text.secondary">
                  {formatDate(endpoint.cert_expiry_date)}
                </Typography>
              )}
              {endpoint.check_cert_expiry && (
                <Box sx={{ mt: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<SecurityIcon />}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCertificateModalOpen(true);
                    }}
                    sx={{ fontSize: '0.75rem' }}
                  >
                    View Details
                  </Button>
                </Box>
              )}
            </Stack>
          </Card>
        </Box>
      ) : (
        <Typography>Could not load stats.</Typography>
      )}
      
      {/* Certificate Modal */}
      <CertificateModal
        open={certificateModalOpen}
        onClose={() => setCertificateModalOpen(false)}
        endpointId={endpoint.id}
        endpointName={endpoint.name}
      />
    </Box>
  );
};

export default EndpointStats;
