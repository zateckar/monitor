import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Box, Tooltip } from '@mui/material';
import type { Heartbeat } from '../types';
import { formatDateTime } from '../utils/timezone';

interface HeartbeatVisualizationProps {
  endpointId: number | string;
  count?: number; // Number of heartbeats to show (if not provided, will be calculated dynamically)
  size?: 'small' | 'medium'; // Size variant
  maxCount?: number; // Maximum number of heartbeats to show (default 50)
}

const HeartbeatVisualization: React.FC<HeartbeatVisualizationProps> = ({
  endpointId,
  count,
  size = 'small',
  maxCount = 50
}) => {
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculatedCount, setCalculatedCount] = useState(count || 12);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate how many heartbeats can fit in the container width
  useLayoutEffect(() => {
    if (!count) {
      const calculateCount = () => {
        if (!containerRef.current) return;
        
        const containerWidth = containerRef.current.offsetWidth;
        if (containerWidth <= 0) return; // Container not yet sized
        
        const dimensions = size === 'small' 
          ? { width: 4, padding: 1.5 }
          : { width: 5, padding: 2 };
        
        // Calculate how many beats can fit with flexbox gap
        // Formula for flexbox with gap: totalWidth = (beatWidth * count) + (gap * (count - 1))
        // Rearranging: count = (totalWidth + gap) / (beatWidth + gap)
        const beatWidth = dimensions.width;
        const gap = dimensions.padding * 2; // gap between items
        
        let fitsInWidth = Math.floor((containerWidth + gap) / (beatWidth + gap));
        
        // Be more aggressive - if we can fit a lot, show more
        if (fitsInWidth > 50) {
          fitsInWidth = Math.floor(fitsInWidth * 0.9); // Use 90% to avoid overflow
        }
        
        // Use at least 8 for better filling and at most maxCount
        const newCount = Math.max(8, Math.min(fitsInWidth, maxCount));
        
        if (newCount !== calculatedCount) {
          setCalculatedCount(newCount);
        }
      };

      // Initial calculation with a slight delay to ensure container is rendered
      const timeoutId = setTimeout(calculateCount, 100);
      
      // Recalculate on window resize
      const resizeObserver = new ResizeObserver(() => {
        setTimeout(calculateCount, 10); // Small delay to ensure layout is complete
      });
      
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }
      
      return () => {
        clearTimeout(timeoutId);
        resizeObserver.disconnect();
      };
    }
  }, [count, size, maxCount, calculatedCount]);

  useEffect(() => {
    const fetchHeartbeats = async () => {
      if (typeof endpointId !== 'number') return;
      
      try {
        setLoading(true);
        const actualCount = count || calculatedCount;
        const response = await fetch(`/api/endpoints/${endpointId}/heartbeats?limit=${actualCount}`);
        if (response.ok) {
          const responseData = await response.json();
          if (responseData && Array.isArray(responseData.data)) {
            setHeartbeats(responseData.data);
          } else if (Array.isArray(responseData)) {
            setHeartbeats(responseData);
          } else {
            console.error('Received incompatible data for heartbeats:', responseData);
            setHeartbeats([]);
          }
        } else {
          setHeartbeats([]);
        }
      } catch (error) {
        console.error('Error fetching heartbeats:', error);
        setHeartbeats([]);
      } finally {
        setLoading(false);
      }
    };

    fetchHeartbeats();
    
    // Refresh heartbeats every 30 seconds
    const interval = setInterval(fetchHeartbeats, 30000);
    return () => clearInterval(interval);
  }, [endpointId, count, calculatedCount]);

  const getBeatColor = (status: string) => {
    return status === 'UP' ? '#4caf50' : '#f44336'; // Green for UP, Red for DOWN
  };

  const formatTooltip = (heartbeat: Heartbeat) => {
    const timestamp = formatDateTime(heartbeat.created_at);
    const status = heartbeat.status === 'UP' ? 'OK' : 'DOWN';
    const responseTime = heartbeat.response_time;
    
    return `${timestamp} - ${responseTime}ms - ${status}`;
  };

  // Dimensions based on size
  const dimensions = size === 'small' 
    ? { width: 4, height: 14, padding: 2 }
    : { width: 6, height: 18, padding: 2 };

  const actualCount = count || calculatedCount;

  // Fill empty slots if we don't have enough heartbeats
  const displayHeartbeats = [...heartbeats];
  while (displayHeartbeats.length < actualCount) {
    displayHeartbeats.unshift({
      status: 'UNKNOWN',
      created_at: '',
      response_time: 0
    });
  }

  // Take only the last 'actualCount' heartbeats
  const recentHeartbeats = displayHeartbeats.slice(-actualCount);

  if (loading) {
    return (
      <Box ref={containerRef} sx={{ display: 'flex', gap: `${dimensions.padding}px`, width: '100%' }}>
        {Array.from({ length: actualCount }).map((_, index) => (
          <Box
            key={index}
            sx={{
              width: dimensions.width,
              height: dimensions.height,
              backgroundColor: '#e0e0e0',
              borderRadius: '1px',
              opacity: 0.3
            }}
          />
        ))}
      </Box>
    );
  }

  return (
    <Box ref={containerRef} sx={{ display: 'flex', gap: `${dimensions.padding}px`, alignItems: 'center', width: '100%' }}>
      {recentHeartbeats.map((heartbeat, index) => {
        const isUnknown = heartbeat.status === 'UNKNOWN' || !heartbeat.created_at;
        
        if (isUnknown) {
          return (
            <Box
              key={index}
              sx={{
                width: dimensions.width,
                height: dimensions.height,
                backgroundColor: '#e0e0e0',
                borderRadius: '1px',
                opacity: 0.3
              }}
            />
          );
        }

        return (
          <Tooltip
            key={index}
            title={formatTooltip(heartbeat)}
            arrow
            placement="top"
          >
            <Box
              sx={{
                width: dimensions.width,
                height: dimensions.height,
                backgroundColor: getBeatColor(heartbeat.status),
                borderRadius: '1px',
                cursor: 'help',
                transition: 'transform 0.2s ease',
                '&:hover': {
                  transform: 'scale(1.3)',
                  zIndex: 1,
                  position: 'relative'
                }
              }}
            />
          </Tooltip>
        );
      })}
    </Box>
  );
};

export default HeartbeatVisualization;
