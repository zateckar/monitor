import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
  List, 
  Typography, 
  Box, 
  ButtonGroup, 
  Button, 
  Tooltip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Menu,
  MenuItem
} from '@mui/material';
import {
  Add,
  AccountTree,
  ViewList,
  CreateNewFolder
} from '@mui/icons-material';
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { SortableTree } from '@revell29/dnd-kit-sortable-tree';
import type { Endpoint, EndpointGroup, TreeNode } from '../types';
import EndpointListItem from './EndpointListItem';
import GroupingItem from './GroupingItem';

interface EndpointListProps {
  endpoints: Endpoint[];
  onSelect: (endpoint: Endpoint) => void;
  selectedId?: number | string;
  onTogglePause?: (id: number) => void;
  onAddEndpoint?: () => void;
}

type ViewMode = 'list' | 'tree';

const EndpointList: React.FC<EndpointListProps> = ({
  endpoints,
  onSelect,
  selectedId,
  onTogglePause,
  onAddEndpoint,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [customOrder, setCustomOrder] = useState<(string | number)[]>([]);
  const [groups, setGroups] = useState<EndpointGroup[]>([]);
  
  // Automatically enable tree view when groups exist
  const hasGroups = groups.length > 0;
  const effectiveViewMode = hasGroups ? 'tree' : viewMode;
  const [endpointGroupMap, setEndpointGroupMap] = useState<Map<string | number, string>>(new Map());
  const [isCreateGroupDialogOpen, setIsCreateGroupDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    endpointId: string | number;
  } | null>(null);
  const [activeId, setActiveId] = useState<string | number | null>(null);
  
  const isInitialLoadRef = useRef<boolean>(true);
  const hasInitializedStateRef = useRef<boolean>(false);

  // Get auth context to ensure we only load preferences when authenticated
  const { user, loading: authLoading } = useAuth();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
        delay: 100,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Save preferences to backend
  const savePreference = async (key: string, value: any) => {
    try {
      const response = await fetch(`/api/preferences/${key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ value }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error(`Failed to save ${key} preference to backend:`, error);
      // Fallback to localStorage
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (localError) {
        console.error(`Failed to save ${key} preference to localStorage:`, localError);
      }
    }
  };

  // Load preferences from backend only after authentication is complete
  useEffect(() => {
    // Don't load preferences if auth is still loading or user is not authenticated
    if (authLoading || !user) {
      return;
    }

    const loadPreferences = async () => {
      try {
        const response = await fetch('/api/preferences', {
          credentials: 'include',
        });
        
        if (response.ok) {
          const preferences = await response.json();
          
          if (preferences.endpoint_custom_order) {
            setCustomOrder(preferences.endpoint_custom_order);
          }
          

          if (preferences.endpoint_view_mode) {
            setViewMode(preferences.endpoint_view_mode);
          }

          if (preferences.endpoint_groups) {
            setGroups(preferences.endpoint_groups);
          }

          if (preferences.endpoint_group_map) {
            // Ensure keys are converted to proper types (numbers if they can be parsed, otherwise strings)
            const groupMapEntries = Object.entries(preferences.endpoint_group_map).map(([key, value]) => {
              const numericKey = !isNaN(Number(key)) ? Number(key) : key;
              return [numericKey, value as string] as [string | number, string];
            });
            setEndpointGroupMap(new Map(groupMapEntries));
          }
        } else {
          console.warn('Failed to load preferences from backend, status:', response.status);
          // Fallback to localStorage for backward compatibility
          loadFromLocalStorage();
        }
      } catch (error) {
        console.error('Failed to load preferences:', error);
        // Fallback to localStorage for backward compatibility
        loadFromLocalStorage();
      }
      
      isInitialLoadRef.current = false;
      hasInitializedStateRef.current = true;
    };

    const loadFromLocalStorage = () => {
      const savedOrder = localStorage.getItem('endpoint_custom_order');
      const savedViewMode = localStorage.getItem('endpoint_view_mode') as ViewMode;
      const savedGroups = localStorage.getItem('endpoint_groups');
      const savedGroupMap = localStorage.getItem('endpoint_group_map');
      
      if (savedOrder) {
        try {
          setCustomOrder(JSON.parse(savedOrder));
        } catch (error) {
          console.error('Failed to parse saved custom order:', error);
        }
      }

      if (savedViewMode) {
        setViewMode(savedViewMode);
      }

      if (savedGroups) {
        try {
          setGroups(JSON.parse(savedGroups));
        } catch (error) {
          console.error('Failed to parse saved groups:', error);
        }
      }

      if (savedGroupMap) {
        try {
          const groupMapData = JSON.parse(savedGroupMap);
          setEndpointGroupMap(new Map(Object.entries(groupMapData)));
        } catch (error) {
          console.error('Failed to parse saved group map:', error);
        }
      }
    };

    loadPreferences();
  }, [authLoading, user]); // Depend on auth state

  // Order endpoints based on custom order
  const sortedEndpoints = useMemo(() => {
    if (endpoints.length === 0) return [];

    // Use custom order
    if (customOrder.length === 0) return endpoints;

    const endpointsMap = new Map(endpoints.map(ep => [ep.id, ep]));
    const orderedEndpoints: Endpoint[] = [];
    const usedIds = new Set();

    customOrder.forEach(id => {
      const endpoint = endpointsMap.get(id);
      if (endpoint) {
        orderedEndpoints.push(endpoint);
        usedIds.add(id);
      }
    });

    endpoints.forEach(endpoint => {
      if (!usedIds.has(endpoint.id)) {
        orderedEndpoints.push(endpoint);
      }
    });

    return orderedEndpoints;
  }, [endpoints, customOrder]);

  // Get ungrouped endpoints
  const ungroupedEndpoints = useMemo(() => {
    return sortedEndpoints.filter(endpoint => !endpointGroupMap.has(endpoint.id));
  }, [sortedEndpoints, endpointGroupMap]);

  // Get grouped endpoints
  const groupedEndpoints = useMemo(() => {
    const result: { [groupId: string]: Endpoint[] } = {};
    
    groups.forEach(group => {
      result[group.id] = [];
    });

    sortedEndpoints.forEach(endpoint => {
      const groupId = endpointGroupMap.get(endpoint.id);
      if (groupId && result[groupId]) {
        result[groupId].push(endpoint);
      }
    });

    return result;
  }, [sortedEndpoints, endpointGroupMap, groups]);

  // Tree structure for SortableTree
  const treeItems = useMemo(() => {
    const items: TreeNode[] = [];

    // Add groups and their children
    groups.forEach(group => {
      const groupEndpoints = groupedEndpoints[group.id] || [];
      const children: TreeNode[] = groupEndpoints.map(endpoint => ({
        id: endpoint.id,
        name: endpoint.name,
        type: 'endpoint' as const,
        parentId: group.id,
        endpoint
      }));

      items.push({
        id: group.id,
        name: group.name,
        type: 'group' as const,
        collapsed: group.collapsed,
        children
      });
    });

    // Add ungrouped endpoints
    ungroupedEndpoints.forEach(endpoint => {
      items.push({
        id: endpoint.id,
        name: endpoint.name,
        type: 'endpoint' as const,
        endpoint
      });
    });

    return items;
  }, [groups, groupedEndpoints, ungroupedEndpoints]);

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    if (effectiveViewMode === 'list') {
      // Handle flat list drag and drop
      const oldIndex = sortedEndpoints.findIndex(ep => ep.id === active.id);
      const newIndex = sortedEndpoints.findIndex(ep => ep.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(sortedEndpoints, oldIndex, newIndex);
        const newCustomOrder = newOrder.map(ep => ep.id);
        setCustomOrder(newCustomOrder);
        
        if (hasInitializedStateRef.current) {
          savePreference('endpoint_custom_order', newCustomOrder);
        }
      }
    } else {
      // Handle tree view drag and drop
      const activeId = active.id;
      const overId = over.id;
      
      // Find if active item is an endpoint
      const activeEndpoint = sortedEndpoints.find(ep => ep.id === activeId);
      
      // Find if over item is a group
      const overGroup = groups.find(group => group.id === overId);
      
      if (activeEndpoint) {
        const currentGroupId = endpointGroupMap.get(activeId);
        
        if (overGroup) {
          // Moving endpoint to a group
          if (currentGroupId !== overGroup.id) {
            const updatedGroupMap = new Map(endpointGroupMap);
            updatedGroupMap.set(activeId, overGroup.id);
            setEndpointGroupMap(updatedGroupMap);
            
            if (hasInitializedStateRef.current) {
              savePreference('endpoint_group_map', Object.fromEntries(updatedGroupMap));
            }
          }
        } else {
          // Check if dropping on another endpoint
          const overEndpoint = sortedEndpoints.find(ep => ep.id === overId);
          if (overEndpoint) {
            const overGroupId = endpointGroupMap.get(overId);
            
            if (currentGroupId !== overGroupId) {
              // Move to same group as target endpoint
              const updatedGroupMap = new Map(endpointGroupMap);
              if (overGroupId) {
                updatedGroupMap.set(activeId, overGroupId);
              } else {
                updatedGroupMap.delete(activeId);
              }
              setEndpointGroupMap(updatedGroupMap);
              
              if (hasInitializedStateRef.current) {
                savePreference('endpoint_group_map', Object.fromEntries(updatedGroupMap));
              }
            } else {
              // Reorder within the same group or ungrouped
              const currentItems = overGroupId ? 
                sortedEndpoints.filter(ep => endpointGroupMap.get(ep.id) === overGroupId) :
                ungroupedEndpoints;
              
              const oldIndex = currentItems.findIndex(ep => ep.id === activeId);
              const newIndex = currentItems.findIndex(ep => ep.id === overId);
              
              if (oldIndex !== -1 && newIndex !== -1) {
                const reorderedItems = arrayMove(currentItems, oldIndex, newIndex);
                
                // Update the custom order to reflect the new arrangement
                const newCustomOrder = [...customOrder];
                
                // Remove the dragged item from its old position
                const draggedItemIndex = newCustomOrder.indexOf(activeId);
                if (draggedItemIndex !== -1) {
                  newCustomOrder.splice(draggedItemIndex, 1);
                }
                
                // Find the new position in the overall order
                const overItemIndex = newCustomOrder.indexOf(overId);
                if (overItemIndex !== -1) {
                  newCustomOrder.splice(overItemIndex, 0, activeId);
                } else {
                  newCustomOrder.push(activeId);
                }
                
                setCustomOrder(newCustomOrder);
                
                if (hasInitializedStateRef.current) {
                  savePreference('endpoint_custom_order', newCustomOrder);
                }
              }
            }
          }
        }
      } else {
        // Handle group reordering
        const activeGroup = groups.find(group => group.id === activeId);
        const overGroup = groups.find(group => group.id === overId);
        
        if (activeGroup && overGroup) {
          const oldIndex = groups.findIndex(group => group.id === activeId);
          const newIndex = groups.findIndex(group => group.id === overId);
          
          if (oldIndex !== -1 && newIndex !== -1) {
            const newGroupOrder = arrayMove(groups, oldIndex, newIndex);
            setGroups(newGroupOrder);
            
            if (hasInitializedStateRef.current) {
              savePreference('endpoint_groups', newGroupOrder);
            }
          }
        }
      }
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    
    if (!over || viewMode === 'list') return;

    const activeId = active.id;
    const overId = over.id;
    
    // Find if active item is an endpoint
    const activeEndpoint = sortedEndpoints.find(ep => ep.id === activeId);
    
    if (activeEndpoint) {
      // Allow dropping on groups and other endpoints
      const overGroup = groups.find(group => group.id === overId);
      const overEndpoint = sortedEndpoints.find(ep => ep.id === overId);
      
      if (overGroup || overEndpoint) {
        // This enables dropping on groups and endpoints
        return;
      }
    }
  };


  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    if (hasInitializedStateRef.current) {
      savePreference('endpoint_view_mode', mode);
    }
  };

  const handleCreateGroup = () => {
    if (newGroupName.trim()) {
      const newGroup: EndpointGroup = {
        id: `group_${Date.now()}`,
        name: newGroupName.trim(),
        type: 'group',
        collapsed: false,
        children: []
      };

      const updatedGroups = [...groups, newGroup];
      setGroups(updatedGroups);
      
      if (hasInitializedStateRef.current) {
        savePreference('endpoint_groups', updatedGroups);
      }

      setNewGroupName('');
      setIsCreateGroupDialogOpen(false);
    }
  };

  const handleToggleGroupCollapse = (groupId: string) => {
    const updatedGroups = groups.map(group => 
      group.id === groupId 
        ? { ...group, collapsed: !group.collapsed }
        : group
    );
    setGroups(updatedGroups);
    
    if (hasInitializedStateRef.current) {
      savePreference('endpoint_groups', updatedGroups);
    }
  };

  const handleRenameGroup = (groupId: string, newName: string) => {
    const updatedGroups = groups.map(group => 
      group.id === groupId 
        ? { ...group, name: newName }
        : group
    );
    setGroups(updatedGroups);
    
    if (hasInitializedStateRef.current) {
      savePreference('endpoint_groups', updatedGroups);
    }
  };

  const handleDeleteGroup = (groupId: string) => {
    // Remove group
    const updatedGroups = groups.filter(group => group.id !== groupId);
    setGroups(updatedGroups);
    
    // Remove endpoint-group mappings for this group
    const updatedGroupMap = new Map(endpointGroupMap);
    for (const [endpointId, mappedGroupId] of updatedGroupMap.entries()) {
      if (mappedGroupId === groupId) {
        updatedGroupMap.delete(endpointId);
      }
    }
    setEndpointGroupMap(updatedGroupMap);
    
    if (hasInitializedStateRef.current) {
      savePreference('endpoint_groups', updatedGroups);
      savePreference('endpoint_group_map', Object.fromEntries(updatedGroupMap));
    }
  };

  const handleMoveToGroup = (endpointId: string | number, groupId: string) => {
    const updatedGroupMap = new Map(endpointGroupMap);
    if (groupId === 'ungrouped') {
      updatedGroupMap.delete(endpointId);
    } else {
      updatedGroupMap.set(endpointId, groupId);
    }
    setEndpointGroupMap(updatedGroupMap);
    
    if (hasInitializedStateRef.current) {
      savePreference('endpoint_group_map', Object.fromEntries(updatedGroupMap));
    }
    
    setContextMenu(null);
  };

  const handleContextMenu = (event: React.MouseEvent, endpointId: string | number) => {
    event.preventDefault();
    setContextMenu({
      mouseX: event.clientX - 2,
      mouseY: event.clientY - 4,
      endpointId
    });
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
  };

  if (endpoints.length === 0) {
    return (
      <Box>
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
      {/* Controls */}
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
            
            <Tooltip title="Create Group">
              <IconButton 
                color="secondary" 
                onClick={() => setIsCreateGroupDialogOpen(true)}
                size="small"
                sx={{ 
                  border: 1, 
                  borderColor: 'secondary.main',
                  '&:hover': {
                    backgroundColor: 'secondary.main',
                    color: 'secondary.contrastText'
                  }
                }}
              >
                <CreateNewFolder />
              </IconButton>
            </Tooltip>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* View Mode Toggle - only show when no groups exist */}
            {!hasGroups && (
              <ButtonGroup size="small" variant="outlined">
                <Tooltip title="List view">
                  <Button
                    startIcon={<ViewList />}
                    variant={effectiveViewMode === 'list' ? 'contained' : 'outlined'}
                    onClick={() => handleViewModeChange('list')}
                  >
                    List
                  </Button>
                </Tooltip>
                <Tooltip title="Tree view">
                  <Button
                    startIcon={<AccountTree />}
                    variant={effectiveViewMode === 'tree' ? 'contained' : 'outlined'}
                    onClick={() => handleViewModeChange('tree')}
                  >
                    Tree
                  </Button>
                </Tooltip>
              </ButtonGroup>
            )}

          </Box>
        </Box>
      </Box>

      {/* Content */}
      {effectiveViewMode === 'list' ? (
        // Flat List View
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortedEndpoints.map(ep => ep.id)}
            strategy={verticalListSortingStrategy}
          >
            <List>
              {sortedEndpoints.map((endpoint) => (
                <div 
                  key={endpoint.id}
                  onContextMenu={(e) => handleContextMenu(e, endpoint.id)}
                >
                  <EndpointListItem
                    endpoint={endpoint}
                    onSelect={onSelect}
                    isSelected={endpoint.id === selectedId}
                    onTogglePause={onTogglePause}
                    isDraggable={true}
                  />
                </div>
              ))}
            </List>
          </SortableContext>
        </DndContext>
      ) : (
        // Tree View
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
        >
          <SortableContext
            items={[
              ...groups.map(g => g.id),
              ...sortedEndpoints.map(ep => ep.id)
            ]}
            strategy={verticalListSortingStrategy}
          >
            <List>
              {/* Groups */}
              {groups.map(group => {
                const groupEndpoints = groupedEndpoints[group.id] || [];
                const activeCount = groupEndpoints.filter(ep => !ep.paused).length;
                
                return (
                  <Box key={group.id}>
                    <GroupingItem
                      group={group}
                      onToggleCollapse={handleToggleGroupCollapse}
                      onRename={handleRenameGroup}
                      onDelete={handleDeleteGroup}
                      isDraggable={true}
                      childrenCount={groupEndpoints.length}
                      activeEndpointsCount={activeCount}
                      endpoints={groupEndpoints}
                    />
                    
                    {!group.collapsed && (
                      <Box sx={{ ml: 4, mr: 2 }}>
                        {groupEndpoints.map(endpoint => (
                          <div 
                            key={endpoint.id}
                            onContextMenu={(e) => handleContextMenu(e, endpoint.id)}
                          >
                            <EndpointListItem
                              endpoint={endpoint}
                              onSelect={onSelect}
                              isSelected={endpoint.id === selectedId}
                              onTogglePause={onTogglePause}
                              isDraggable={true}
                            />
                          </div>
                        ))}
                      </Box>
                    )}
                  </Box>
                );
              })}

              {/* Ungrouped Endpoints - integrated without separation */}
              {ungroupedEndpoints.map(endpoint => (
                <div 
                  key={endpoint.id}
                  onContextMenu={(e) => handleContextMenu(e, endpoint.id)}
                >
                  <EndpointListItem
                    endpoint={endpoint}
                    onSelect={onSelect}
                    isSelected={endpoint.id === selectedId}
                    onTogglePause={onTogglePause}
                    isDraggable={true}
                  />
                </div>
              ))}
            </List>
          </SortableContext>
        </DndContext>
      )}

      {/* Create Group Dialog */}
      <Dialog open={isCreateGroupDialogOpen} onClose={() => setIsCreateGroupDialogOpen(false)}>
        <DialogTitle>Create New Group</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Group Name"
            fullWidth
            variant="outlined"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleCreateGroup();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsCreateGroupDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateGroup} variant="contained">Create</Button>
        </DialogActions>
      </Dialog>

      {/* Context Menu */}
      <Menu
        open={contextMenu !== null}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
      >
        <MenuItem onClick={() => handleMoveToGroup(contextMenu!.endpointId, 'ungrouped')}>
          Remove from group
        </MenuItem>
        {groups.map(group => (
          <MenuItem 
            key={group.id}
            onClick={() => handleMoveToGroup(contextMenu!.endpointId, group.id)}
          >
            Move to "{group.name}"
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
};

export default EndpointList;
