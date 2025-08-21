import React, { useState, useEffect, useMemo } from 'react';
import { 
  List, 
  Typography, 
  Box, 
  ButtonGroup, 
  Button, 
  Tooltip,
  IconButton
} from '@mui/material';
import {
  SortByAlpha,
  SwapVert,
  Add
} from '@mui/icons-material';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import type { Endpoint } from '../types';
import EndpointListItem from './EndpointListItem';

interface EndpointListProps {
  endpoints: Endpoint[];
  onSelect: (endpoint: Endpoint) => void;
  selectedId?: number | string;
  onTogglePause?: (id: number) => void;
  onAddEndpoint?: () => void;
}

type SortMode = 'alphabetical' | 'custom';

const EndpointList: React.FC<EndpointListProps> = ({
  endpoints,
  onSelect,
  selectedId,
  onTogglePause,
  onAddEndpoint,
}) => {
  const [sortMode, setSortMode] = useState<SortMode>('alphabetical');
  const [customOrder, setCustomOrder] = useState<(string | number)[]>([]);

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

  // Load preferences from backend on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const response = await fetch('/api/preferences');
        if (response.ok) {
          const preferences = await response.json();
          
          if (preferences.endpoint_custom_order) {
            setCustomOrder(preferences.endpoint_custom_order);
          }
          
          if (preferences.endpoint_sort_mode) {
            setSortMode(preferences.endpoint_sort_mode);
          }
        }
      } catch (error) {
        console.error('Failed to load preferences:', error);
        // Fallback to localStorage for backward compatibility
        const savedOrder = localStorage.getItem('endpoint_custom_order');
        const savedSortMode = localStorage.getItem('endpoint_sort_mode') as SortMode;
        
        if (savedOrder) {
          try {
            setCustomOrder(JSON.parse(savedOrder));
          } catch (error) {
            console.error('Failed to parse saved custom order:', error);
          }
        }
        
        if (savedSortMode) {
          setSortMode(savedSortMode);
        }
      }
    };

    loadPreferences();
  }, []);

  // Save sort mode to backend
  useEffect(() => {
    const savePreference = async () => {
      try {
        await fetch('/api/preferences/endpoint_sort_mode', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ value: sortMode }),
        });
      } catch (error) {
        console.error('Failed to save sort mode preference:', error);
        // Fallback to localStorage
        localStorage.setItem('endpoint_sort_mode', sortMode);
      }
    };

    savePreference();
  }, [sortMode]);

  // Save custom order to backend
  useEffect(() => {
    if (customOrder.length > 0) {
      const savePreference = async () => {
        try {
          await fetch('/api/preferences/endpoint_custom_order', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ value: customOrder }),
          });
        } catch (error) {
          console.error('Failed to save custom order preference:', error);
          // Fallback to localStorage
          localStorage.setItem('endpoint_custom_order', JSON.stringify(customOrder));
        }
      };

      savePreference();
    }
  }, [customOrder]);

  // Initialize custom order when endpoints change and no custom order exists
  useEffect(() => {
    if (endpoints.length > 0 && customOrder.length === 0) {
      const alphabeticalOrder = [...endpoints]
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
        .map(endpoint => endpoint.id);
      setCustomOrder(alphabeticalOrder);
    }
  }, [endpoints, customOrder.length]);

  // Sort endpoints based on current sort mode
  const sortedEndpoints = useMemo(() => {
    if (endpoints.length === 0) return [];

    if (sortMode === 'alphabetical') {
      return [...endpoints].sort((a, b) => 
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      );
    } else {
      // Custom order
      if (customOrder.length === 0) return endpoints;

      // Create a map for quick lookup
      const endpointsMap = new Map(endpoints.map(ep => [ep.id, ep]));
      
      // Sort by custom order, putting any new endpoints at the end
      const orderedEndpoints: Endpoint[] = [];
      const usedIds = new Set();

      // Add endpoints in custom order
      customOrder.forEach(id => {
        const endpoint = endpointsMap.get(id);
        if (endpoint) {
          orderedEndpoints.push(endpoint);
          usedIds.add(id);
        }
      });

      // Add any new endpoints that aren't in the custom order
      endpoints.forEach(endpoint => {
        if (!usedIds.has(endpoint.id)) {
          orderedEndpoints.push(endpoint);
        }
      });

      return orderedEndpoints;
    }
  }, [endpoints, sortMode, customOrder]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = sortedEndpoints.findIndex(ep => ep.id === active.id);
      const newIndex = sortedEndpoints.findIndex(ep => ep.id === over?.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(sortedEndpoints, oldIndex, newIndex);
        const newCustomOrder = newOrder.map(ep => ep.id);
        setCustomOrder(newCustomOrder);
        
        // Switch to custom mode if not already
        if (sortMode !== 'custom') {
          setSortMode('custom');
        }
      }
    }
  };

  const handleSortModeChange = (mode: SortMode) => {
    setSortMode(mode);
    
    if (mode === 'alphabetical') {
      // Update custom order to match alphabetical order for future use
      const alphabeticalOrder = [...endpoints]
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
        .map(endpoint => endpoint.id);
      setCustomOrder(alphabeticalOrder);
    }
  };

  if (endpoints.length === 0) {
    return (
      <Box>
        {/* Add Monitor Button for Empty State */}
        {onAddEndpoint && (
          <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
              <Tooltip title="Add Monitor">
                <IconButton 
                  color="primary" 
                  onClick={onAddEndpoint}
                  size="small"
                  sx={{ 
                    border: 1, 
                    borderColor: 'primary.main',
                    '&:hover': {
                      backgroundColor: 'primary.main',
                      color: 'primary.contrastText'
                    }
                  }}
                >
                  <Add />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        )}
        <Typography variant="body1" align="center" color="text.secondary" sx={{ mt: 2 }}>
          No endpoints to monitor. Add one to get started!
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Add Monitor and Sorting Controls */}
      <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {onAddEndpoint && (
              <Tooltip title="Add Monitor">
                <IconButton 
                  color="primary" 
                  onClick={onAddEndpoint}
                  size="small"
                  sx={{ 
                    border: 1, 
                    borderColor: 'primary.main',
                    '&:hover': {
                      backgroundColor: 'primary.main',
                      color: 'primary.contrastText'
                    }
                  }}
                >
                  <Add />
                </IconButton>
              </Tooltip>
            )}
          </Box>
          <ButtonGroup size="small" variant="outlined">
            <Tooltip title="Alphabetical sorting">
              <Button
                startIcon={<SortByAlpha />}
                variant={sortMode === 'alphabetical' ? 'contained' : 'outlined'}
                onClick={() => handleSortModeChange('alphabetical')}
              >
                A-Z
              </Button>
            </Tooltip>
            <Tooltip title="Custom order (drag to reorder)">
              <Button
                startIcon={<SwapVert />}
                variant={sortMode === 'custom' ? 'contained' : 'outlined'}
                onClick={() => handleSortModeChange('custom')}
              >
                Custom
              </Button>
            </Tooltip>
          </ButtonGroup>
        </Box>
      </Box>

      {/* Endpoint List */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortedEndpoints.map(ep => ep.id)}
          strategy={verticalListSortingStrategy}
        >
          <List>
            {sortedEndpoints.map((endpoint) => (
              <EndpointListItem
                key={endpoint.id}
                endpoint={endpoint}
                onSelect={onSelect}
                isSelected={endpoint.id === selectedId}
                onTogglePause={onTogglePause}
                isDraggable={sortMode === 'custom'}
              />
            ))}
          </List>
        </SortableContext>
      </DndContext>
    </Box>
  );
};

export default EndpointList;
