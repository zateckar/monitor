import React, { useState, useEffect } from 'react';
import { Typography, Card, Box, CircularProgress, LinearProgress, Avatar, Stack,  Chip, Divider } from '@mui/material';
import type { Endpoint } from '../types';
import { formatDate } from '../utils/timezone';
import SpeedIcon from '@mui/icons-material/Speed';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import SecurityIcon from '@mui/icons-material/Security';
import MonitorIcon from '@mui/icons-material/Monitor';
import BarChartIcon from '@mui/icons-material/BarChart';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import LanguageIcon from '@mui/icons-material/Language';
import CertificateModal from './CertificateModal';
import type { DomainInfo } from '../types';

interface EndpointStatsProps {
  endpoint: Endpoint;
  timeRange: string;
}

interface Stats {
  avg_response: number;
  uptime: number;
  monitoring_coverage: number;
  // New statistical measures
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  std_dev: number;
  mad: number;
  min_response: number;
  max_response: number;
  response_count: number;
}

const EndpointStats: React.FC<EndpointStatsProps> = ({ endpoint, timeRange }) => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [domainInfo, setDomainInfo] = useState<DomainInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDomain, setLoadingDomain] = useState(true);
  const [certificateModalOpen, setCertificateModalOpen] = useState(false);

  useEffect(() => {
    if (endpoint && typeof endpoint.id === 'number') {
      setLoading(true);
      setLoadingDomain(true);

      // Fetch main stats
      fetch(`/api/endpoints/${endpoint.id}/stats?range=${timeRange}`)
        .then(res => res.json())
        .then(data => {
          setStats(data);
          setLoading(false);
        })
        .catch(() => setLoading(false));

      // Fetch domain info
      fetch(`/api/endpoints/${endpoint.id}/domain-info`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          setDomainInfo(data);
          setLoadingDomain(false);
        })
        .catch(() => setLoadingDomain(false));
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

  const getDomainExpiryColor = (days: number | null) => {
    if (days === null) return 'grey';
    if (days <= 14) return 'error';
    if (days <= 45) return 'warning';
    return 'success';
  };

  const getCoverageColor = (coverage: number) => {
    if (coverage >= 95) return 'success';
    if (coverage >= 80) return 'warning';
    return 'error';
  };

  const StatCard = ({ icon, title, value, subtitle, progress, color }: any) => (
    <Card variant="outlined" sx={{ p: 1.5, height: '100%' }}>
      <Stack spacing={0.8}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <Avatar sx={{ bgcolor: `${color}.main`, width: 28, height: 28 }}>
            {icon}
          </Avatar>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, fontSize: '0.7rem' }}>
            {title}
          </Typography>
        </Box>
        <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', fontSize: '1rem' }}>
          {value}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
            {subtitle}
          </Typography>
        )}
        {progress !== undefined && (
          <LinearProgress 
            variant="determinate" 
            value={progress} 
            color={getProgressColor(progress)}
            sx={{ height: 4, borderRadius: 2 }}
          />
        )}
      </Stack>
    </Card>
  );

  const PercentileCard = () => (
    <Card variant="outlined" sx={{ p: 1.5, height: '100%' }}>
      <Stack spacing={1}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <Avatar sx={{ bgcolor: 'info.main', width: 28, height: 28 }}>
            <BarChartIcon sx={{ fontSize: 16 }} />
          </Avatar>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, fontSize: '0.7rem' }}>
            Response Time Percentiles ({timeRangeLabel})
          </Typography>
        </Box>
        
        {stats && stats.response_count > 0 ? (
          <Box>
            <Stack spacing={0.8}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  <Chip 
                    label={`P50: ${stats.p50}ms`} 
                    size="small" 
                    color="success"
                    sx={{ fontSize: '0.65rem', height: 22 }}
                  />
                  <Chip 
                    label={`P90: ${stats.p90}ms`} 
                    size="small" 
                    color="info"
                    sx={{ fontSize: '0.65rem', height: 22 }}
                  />
                                  <Chip 
                  label={`P95: ${stats.p95}ms`} 
                  size="small" 
                  color="warning"
                  sx={{ fontSize: '0.65rem', height: 22 }}
                />
                <Chip 
                  label={`P99: ${stats.p99}ms`} 
                  size="small" 
                  color="error"
                  sx={{ fontSize: '0.65rem', height: 22 }}
                />
                </Box>
              </Box>
            </Stack>
            
            {/* Visual representation */}
            <Box sx={{ mt: 1 }}>
              <Stack spacing={0.5}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ fontSize: '0.6rem', width: '20px' }}>P50</Typography>
                  <LinearProgress 
                    variant="determinate" 
                    value={Math.min((stats.p50 / Math.max(stats.p99, 1)) * 100, 100)} 
                    color="success"
                    sx={{ flexGrow: 1, height: 3, borderRadius: 1.5 }}
                  />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ fontSize: '0.6rem', width: '20px' }}>P90</Typography>
                  <LinearProgress 
                    variant="determinate" 
                    value={Math.min((stats.p90 / Math.max(stats.p99, 1)) * 100, 100)} 
                    color="info"
                    sx={{ flexGrow: 1, height: 3, borderRadius: 1.5 }}
                  />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ fontSize: '0.6rem', width: '20px' }}>P95</Typography>
                  <LinearProgress 
                    variant="determinate" 
                    value={Math.min((stats.p95 / Math.max(stats.p99, 1)) * 100, 100)} 
                    color="warning"
                    sx={{ flexGrow: 1, height: 3, borderRadius: 1.5 }}
                  />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ fontSize: '0.6rem', width: '20px' }}>P99</Typography>
                  <LinearProgress 
                    variant="determinate" 
                    value={100} 
                    color="error"
                    sx={{ flexGrow: 1, height: 3, borderRadius: 1.5 }}
                  />
                </Box>
              </Stack>
            </Box>
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
            No data available
          </Typography>
        )}
      </Stack>
    </Card>
  );

  const UptimeCard = () => (
    <Card variant="outlined" sx={{ p: 1.5, height: '100%' }}>
      <Stack spacing={1}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <Avatar sx={{ bgcolor: 'success.main', width: 28, height: 28 }}>
            <TrendingUpIcon sx={{ fontSize: 16 }} />
          </Avatar>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, fontSize: '0.7rem' }}>
            Uptime Metrics
          </Typography>
        </Box>
        
        <Stack spacing={1}>
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>{timeRangeLabel}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>
                {stats ? `${stats.uptime.toFixed(2)}%` : 'N/A'}
              </Typography>
            </Box>
            <LinearProgress 
              variant="determinate" 
              value={stats ? stats.uptime : 0} 
              color={getProgressColor(stats ? stats.uptime : 0)}
              sx={{ height: 4, borderRadius: 2 }}
            />
          </Box>
          
          <Divider sx={{ my: 0.5 }} />
          
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>30 days</Typography>
              <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>
                {endpoint.uptime_30d !== null && endpoint.uptime_30d !== undefined ? `${endpoint.uptime_30d.toFixed(2)}%` : '0.00%'}
              </Typography>
            </Box>
            <LinearProgress 
              variant="determinate" 
              value={endpoint.uptime_30d || 0} 
              color={getProgressColor(endpoint.uptime_30d || 0)}
              sx={{ height: 4, borderRadius: 2 }}
            />
          </Box>
          
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>1 year</Typography>
              <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>
                {endpoint.uptime_1y !== null && endpoint.uptime_1y !== undefined ? `${endpoint.uptime_1y.toFixed(2)}%` : '0.00%'}
              </Typography>
            </Box>
            <LinearProgress 
              variant="determinate" 
              value={endpoint.uptime_1y || 0} 
              color={getProgressColor(endpoint.uptime_1y || 0)}
              sx={{ height: 4, borderRadius: 2 }}
            />
          </Box>
        </Stack>
      </Stack>
    </Card>
  );

  const VariabilityCard = () => (
    <Card variant="outlined" sx={{ p: 1.5, height: '100%' }}>
      <Stack spacing={1}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <Avatar sx={{ bgcolor: 'secondary.main', width: 28, height: 28 }}>
            <ShowChartIcon sx={{ fontSize: 16 }} />
          </Avatar>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, fontSize: '0.7rem' }}>
            Response Variability ({timeRangeLabel})
          </Typography>
        </Box>
        
        {stats && stats.response_count > 1 ? (
          <Stack spacing={1}>
            <Box sx={{ 
              display: 'flex', 
              justifyContent: 'space-around', 
              alignItems: 'center',
              p: 1,
              bgcolor: 'action.hover',
              borderRadius: 1
            }}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', display: 'block' }}>
                  Standard Deviation
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', fontSize: '1rem' }}>
                  {stats.std_dev} ms
                </Typography>
              </Box>
              <Divider orientation="vertical" flexItem />
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', display: 'block' }}>
                  MAD
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', fontSize: '1rem' }}>
                  {stats.mad} ms
                </Typography>
              </Box>
            </Box>
            
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Chip 
                icon={<ScatterPlotIcon sx={{ fontSize: 12 }} />}
                label="Robust measure" 
                size="small" 
                variant="outlined"
                sx={{ fontSize: '0.6rem', height: 20 }}
              />
            </Box>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
            Need 2+ samples for variability metrics
          </Typography>
        )}
      </Stack>
    </Card>
  );

  const ResponseTimeCard = () => (
    <Card variant="outlined" sx={{ p: 1.5, height: '100%' }}>
      <Stack spacing={1}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <Avatar sx={{ bgcolor: 'primary.main', width: 28, height: 28 }}>
            <SpeedIcon sx={{ fontSize: 16 }} />
          </Avatar>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, fontSize: '0.7rem' }}>
            Response Time Summary ({timeRangeLabel})
          </Typography>
        </Box>
        
        <Stack spacing={1}>
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'space-around', 
            p: 1,
            bgcolor: 'action.hover',
            borderRadius: 1
          }}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', display: 'block' }}>
                Current
              </Typography>
              <Typography variant="h6" sx={{ 
                fontWeight: 'bold', 
                fontSize: '1rem',
                color: endpoint.current_response ? (endpoint.current_response < 500 ? 'success.main' : endpoint.current_response < 1000 ? 'warning.main' : 'error.main') : 'text.secondary'
              }}>
                {endpoint.current_response ? `${endpoint.current_response.toFixed(0)} ms` : 'N/A'}
              </Typography>
            </Box>
            <Divider orientation="vertical" flexItem />
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', display: 'block' }}>
                Average
              </Typography>
              <Typography variant="h6" sx={{ 
                fontWeight: 'bold', 
                fontSize: '1rem',
                color: stats ? (stats.avg_response < 500 ? 'success.main' : stats.avg_response < 1000 ? 'warning.main' : 'error.main') : 'text.secondary'
              }}>
                {stats ? `${stats.avg_response.toFixed(0)} ms` : 'N/A'}
              </Typography>
            </Box>
          </Box>
          
          {stats && stats.response_count > 0 && (
            <Box sx={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              p: 0.8,
              border: 1,
              borderColor: 'divider',
              borderRadius: 1
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <CompareArrowsIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>Range:</Typography>
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '0.75rem' }}>
                {stats.min_response} - {stats.max_response} ms
              </Typography>
            </Box>
          )}
          
        </Stack>
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
              sm: 'repeat(auto-fit, minmax(280px, 1fr))',
              md: 'repeat(auto-fit, minmax(320px, 1fr))'
            },
            gap: 1.5
          }}
        >

          {/* Uptime Metrics - Grouped */}
          <UptimeCard />

          {/* Response Time Percentiles - Grouped */}
          <PercentileCard />

          {/* Monitoring Coverage */}
          <StatCard
            icon={<MonitorIcon sx={{ fontSize: 16 }} />}
            title={`Coverage (${timeRangeLabel})`}
            value={`${stats.monitoring_coverage.toFixed(1)}%`}
            subtitle={stats.monitoring_coverage < 99.5 ? 'Some gaps detected' : 'Complete coverage'}
            progress={stats.monitoring_coverage}
            color={getCoverageColor(stats.monitoring_coverage)}
          />



          {/* Response Variability - Grouped */}
          <VariabilityCard />

          {/* Response Time Summary - Grouped */}
          <ResponseTimeCard />

          {/* Certificate & Domain Expiry Card - Clickable */}
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
              {/* Certificate Section */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Avatar sx={{ 
                  bgcolor: `${!endpoint.check_cert_expiry
                    ? 'grey'
                    : endpoint.cert_expires_in !== null
                    ? (endpoint.cert_expires_in <= 7
                      ? 'error'
                      : endpoint.cert_expires_in <= 21
                      ? 'warning'
                      : 'success')
                    : 'info'}.main`, 
                  width: 32, 
                  height: 32 
                }}>
                  <SecurityIcon sx={{ fontSize: 18 }} />
                </Avatar>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, display: 'block' }}>
                    Certificate
                  </Typography>
                  <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', lineHeight: 1.2 }}>
                    {!endpoint.check_cert_expiry
                      ? 'Not enabled'
                      : endpoint.cert_expires_in !== null
                      ? `${endpoint.cert_expires_in} days`
                      : 'Checking...'}
                  </Typography>
                  {endpoint.cert_expiry_date && endpoint.cert_expires_in !== null && (
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(endpoint.cert_expiry_date)}
                    </Typography>
                  )}
                </Box>
              </Box>

              <Divider />

              {/* Domain Section */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Avatar sx={{ 
                  bgcolor: `${getDomainExpiryColor(domainInfo?.daysRemaining ?? null)}.main`,
                  width: 32, 
                  height: 32 
                }}>
                  <LanguageIcon sx={{ fontSize: 18 }} />
                </Avatar>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, display: 'block' }}>
                    Domain
                  </Typography>
                  {loadingDomain ? (
                    <CircularProgress size={20} />
                  ) : domainInfo && domainInfo.daysRemaining !== null ? (
                    <>
                      <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', lineHeight: 1.2 }}>
                        {`${domainInfo.daysRemaining} days`}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDate(domainInfo.expiryDate!)}
                      </Typography>
                    </>
                  ) : (
                    <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', lineHeight: 1.2 }}>
                      N/A
                    </Typography>
                  )}
                </Box>
              </Box>
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
