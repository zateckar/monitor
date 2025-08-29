import { useState, useEffect } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from 'recharts';
import { formatChartTime } from '../utils/timezone';

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
  primaryColor: '#1976d2',
  secondaryColor: '#dc004e',
  errorColor: '#d32f2f',
  warningColor: '#ed6c02',
  infoColor: '#0288d1',
  successColor: '#2e7d32',
};

interface ResponseTime {
  id: number;
  endpoint_id: number;
  response_time: number;
  min_response_time?: number;
  max_response_time?: number;
  created_at: string;
  status: string;
  data_points?: number; // For aggregated data
}

interface Endpoint {
  id: number;
  heartbeat_interval?: number;
}

interface EndpointChartProps {
  endpointId: number;
  timeRange: string;
}

interface Outage {
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  duration_text: string;
  reason: string;
}

const EndpointChart = ({ endpointId, timeRange }: EndpointChartProps) => {
  const [data, setData] = useState<ResponseTime[]>([]);
  const [outages, setOutages] = useState<Outage[]>([]);
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(defaultThemeSettings);

  useEffect(() => {
    const fetchData = () => {
      // Fetch response times, endpoint info, and outages
      Promise.all([
        fetch(`/api/endpoints/${endpointId}/response-times?range=${timeRange}`).then(res => res.json()),
        fetch(`/api/endpoints`).then(res => res.json()).then((endpoints: Endpoint[]) => 
          endpoints.find((e: Endpoint) => e.id === endpointId)
        ),
        fetch(`/api/endpoints/${endpointId}/outages?limit=100`).then(res => res.json())
      ]).then(([responseData, , outageData]) => {
        setData(responseData);
        setOutages(outageData);
      });
    };

    fetchData();
    const interval = setInterval(fetchData, 20000);

    return () => clearInterval(interval);
  }, [endpointId, timeRange]);

  // Listen for timezone changes and trigger a re-render
  useEffect(() => {
    const handleTimezoneChange = () => {
      // Force re-render when timezone changes
      setData(current => [...current]);
    };

    window.addEventListener('timezoneChanged', handleTimezoneChange);
    
    return () => {
      window.removeEventListener('timezoneChanged', handleTimezoneChange);
    };
  }, []);

  // Load theme settings and listen for changes
  useEffect(() => {
    const loadThemeSettings = () => {
      const savedSettings = localStorage.getItem('app_theme_settings');
      if (savedSettings) {
        try {
          const parsed = JSON.parse(savedSettings);
          setThemeSettings({ ...defaultThemeSettings, ...parsed });
        } catch (error) {
          console.error('Failed to parse theme settings:', error);
        }
      }
    };

    // Load initial theme settings
    loadThemeSettings();

    // Listen for theme changes
    const handleThemeChange = (event: CustomEvent) => {
      setThemeSettings(event.detail);
    };

    window.addEventListener('themeChanged', handleThemeChange as EventListener);

    return () => {
      window.removeEventListener('themeChanged', handleThemeChange as EventListener);
    };
  }, []);

  const formatTime = (time: string) => {
    return formatChartTime(time, timeRange);
  };


  // Check if data has aggregated points
  const hasAggregatedData = data.length > 0 && data[0].max_response_time !== undefined;
  
  // Filter outages to only show those within the current chart time range
  const getRelevantOutages = (outages: Outage[], chartData: ResponseTime[]) => {
    if (chartData.length === 0) return [];
    
    const chartStart = new Date(chartData[0].created_at).getTime();
    const chartEnd = new Date(chartData[chartData.length - 1].created_at).getTime();
    
    return outages.filter(outage => {
      const outageStart = new Date(outage.started_at).getTime();
      const outageEnd = outage.ended_at ? new Date(outage.ended_at).getTime() : Date.now();
      
      // Include outage if it overlaps with the chart time range
      return outageStart <= chartEnd && outageEnd >= chartStart;
    });
  };

  const relevantOutages = getRelevantOutages(outages, data);

  // Transform outages to use numerical timestamps for ReferenceArea
  const transformedOutages = relevantOutages.map((outage, index) => ({
    ...outage,
    startTimestamp: new Date(outage.started_at).getTime(),
    endTimestamp: outage.ended_at ? new Date(outage.ended_at).getTime() : Date.now()
  }));

  // Use all chart data without filtering
  const chartData = data;
  
  // Transform data to use numerical timestamps for linear time axis
  const transformDataForLinearTime = (data: ResponseTime[]) => {
    return data.map(item => ({
      ...item,
      timestamp: new Date(item.created_at).getTime(),
      range: hasAggregatedData ? (item.max_response_time || 0) - (item.min_response_time || 0) : 0
    }));
  };

  const linearTimeData = transformDataForLinearTime(chartData);
  
  // Calculate time domain for linear scale
  const getTimeDomain = () => {
    if (linearTimeData.length === 0) return [0, 1];
    
    const minTime = Math.min(...linearTimeData.map(d => d.timestamp));
    const maxTime = Math.max(...linearTimeData.map(d => d.timestamp));
    
    // Add some padding (1% on each side)
    const padding = (maxTime - minTime) * 0.01;
    return [minTime - padding, maxTime + padding];
  };

  const timeDomain = getTimeDomain();

  // Calculate Y-axis domain for better space utilization
  const getYDomain = () => {
    if (linearTimeData.length === 0) return [0, 100];
    
    const values = linearTimeData.flatMap(d => {
      if (hasAggregatedData) {
        return [d.min_response_time || 0, d.max_response_time || 0];
      } else {
        return [d.response_time];
      }
    });
    
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    
    // Add padding (10% on each side) but ensure minimum range of 50ms for visibility
    const range = maxValue - minValue;
    const minRange = 50; // Minimum range in ms
    const effectiveRange = Math.max(range, minRange);
    
    const padding = effectiveRange * 0.1;
    const yMin = Math.max(0, minValue - padding);
    const yMax = maxValue + padding;
    
    return [yMin, yMax];
  };

  const yDomain = getYDomain();

  // Custom tick component for two-line date/time display
  const CustomXAxisTick = (props: { x: number; y: number; payload: { value: number } }) => {
    const { x, y, payload } = props;
    const timestamp = payload.value;
    const formattedTime = formatTime(new Date(timestamp).toISOString());
    
    if (typeof formattedTime === 'object') {
      // Two-line display for longer time ranges
      return (
        <g transform={`translate(${x},${y})`}>
          <text 
            x={0} 
            y={6} 
            dy={0} 
            textAnchor="middle" 
            fill={themeSettings.mode === 'dark' ? '#9ca3af' : '#6b7280'}
            fontSize="9"
          >
            {formattedTime.date}
          </text>
          <text 
            x={0} 
            y={18} 
            dy={0} 
            textAnchor="middle" 
            fill={themeSettings.mode === 'dark' ? '#9ca3af' : '#6b7280'}
            fontSize="10"
            fontWeight="500"
          >
            {formattedTime.time}
          </text>
        </g>
      );
    } else {
      // Single line display for shorter time ranges
      return (
        <g transform={`translate(${x},${y})`}>
          <text 
            x={0} 
            y={0} 
            dy={12} 
            textAnchor="middle" 
            fill={themeSettings.mode === 'dark' ? '#9ca3af' : '#6b7280'}
            fontSize="10"
          >
            {formattedTime}
          </text>
        </g>
      );
    }
  };

  // Custom tooltip that works with numerical timestamps
  const LinearTimeTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: ResponseTime & { timestamp: number; range: number; } }[] }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const tooltipBg = themeSettings.mode === 'dark' ? 'rgba(18, 18, 18, 0.95)' : 'rgba(255, 255, 255, 0.95)';
      const tooltipTextColor = themeSettings.mode === 'dark' ? '#ffffff' : '#1f2937';
      const primaryTextColor = themeSettings.primaryColor;
      const statusColor = data.status === 'UP' ? themeSettings.successColor : themeSettings.errorColor;
      
      return (
        <div 
          className="backdrop-blur-sm px-2 py-1 border border-gray-300 rounded shadow-lg text-xs"
          style={{ 
            backgroundColor: tooltipBg,
            color: tooltipTextColor,
            borderColor: themeSettings.mode === 'dark' ? '#4b5563' : '#d1d5db'
          }}
        >
          <p className="font-medium mb-0.5" style={{ color: tooltipTextColor }}>
            {(() => {
              const formatted = formatTime(data.created_at);
              return typeof formatted === 'string' ? formatted : `${formatted.date} ${formatted.time}`;
            })()}
          </p>
          {data.data_points && data.data_points > 1 ? (
            <div className="space-y-0.5">
              <p style={{ color: primaryTextColor }}>
                Avg: {Math.round(data.response_time)}ms
              </p>
              <p style={{ color: themeSettings.mode === 'dark' ? '#9ca3af' : '#6b7280' }}>
                Range: {Math.round(data.min_response_time || 0)}-{Math.round(data.max_response_time || 0)}ms
              </p>
              <p className="text-xs" style={{ color: statusColor }}>
                {data.status} • {data.data_points}pts
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              <p style={{ color: primaryTextColor }}>
                {Math.round(data.response_time)}ms
              </p>
              <p className="text-xs" style={{ color: statusColor }}>
                {data.status}
              </p>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={linearTimeData}>
          <CartesianGrid 
            strokeDasharray="1 1" 
            stroke={themeSettings.mode === 'dark' ? '#374151' : '#e5e7eb'} 
            strokeOpacity={0.3}
          />
          <XAxis 
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={timeDomain}
            tickCount={6}
            tick={CustomXAxisTick}
          />
          <YAxis 
            domain={yDomain}
            tickCount={8}
            tick={{ fill: themeSettings.mode === 'dark' ? '#9ca3af' : '#6b7280', fontSize: 10  }}
          />
          <Tooltip content={<LinearTimeTooltip />} />
          
          {/* Render red bars for DOWN periods (actual outages) */}
          {transformedOutages.map((outage, index) => (
            <ReferenceArea
              key={`outage-${index}`}
              x1={outage.startTimestamp}
              x2={outage.endTimestamp}
              fill={themeSettings.errorColor}
              fillOpacity={0.3}
              stroke="none"
            />
          ))}
          
          {/* Render areas only for aggregated data to create the band effect */}
          {hasAggregatedData && (
            <>
              {/* Base area */}
              <Area 
                type="monotone" 
                dataKey="min_response_time" 
                stroke="none"
                fill="transparent"
                stackId="1"
              />
              
              {/* Range area */}
              <Area 
                type="monotone" 
                dataKey="range" 
                stroke="none"
                fill={themeSettings.primaryColor} 
                fillOpacity={0.1}
                stackId="1"
              />
            </>
          )}
          
          {/* Average/main response time line - always rendered */}
          <Line 
            type="monotone" 
            dataKey="response_time" 
            stroke={themeSettings.primaryColor} 
            strokeWidth={3}
            dot={{ r: 3, fill: themeSettings.primaryColor }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      
    </div>
  );
};

export default EndpointChart;
