import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
  List, 
  Typography, 
  Box, 
  Tooltip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Menu,
  MenuItem,
  Button
} from '@mui/material';
import {
  Add,
  CreateNewFolder
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
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import type { Endpoint, EndpointGroup, SortableItem } from '../types';
import EndpointListItem from './EndpointListItem';
import GroupingItem from './GroupingItem';

interface EndpointListProps {
  endpoints: Endpoint[];
  onSelect: (endpoint: Endpoint) => void;
  selectedId?: number | string;
  onTogglePause?: (id: number) => void;
  onAddEndpoint?: () => void;
}

const EndpointList: React.FC<EndpointListProps> = ({
  endpoints,
  onSelect,
  selectedId,
  onTogglePause,
  onAddEndpoint,
}) => {
  const [items, setItems] = useState<SortableItem[]>([]);
  const [isCreateGroupDialogOpen, setIsCreateGroupDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    endpointId: string | number;
  } | null>(null);
  const [activeId, setActiveId] = useState<string | number | null>(null);
  
  const hasInitializedStateRef = useRef<boolean>(false);
  const { user, loading: authLoading } = useAuth();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3,
        delay: 250,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const savePreference = async (key: string, value: any) => {
    try {
      await fetch(`/api/preferences/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ value }),
      });
    } catch (error) {
      console.error(`Failed to save ${key} preference:`, error);
    }
  };

  const persistState = (updatedItems: SortableItem[]) => {
    if (!hasInitializedStateRef.current) return;

    const customOrder: (string | number)[] = [];
    const groups: EndpointGroup[] = [];
    const endpointGroupMap: { [key: string]: string } = {};

    updatedItems.forEach(item => {
      if (item.type === 'group') {
        groups.push({ ...item, children: [] }); // Don't save children in group definition
        item.children.forEach(child => {
          customOrder.push(child.id);
          endpointGroupMap[child.id] = item.id;
        });
      } else {
        customOrder.push(item.id);
      }
    });

    savePreference('endpoint_custom_order', customOrder);
    savePreference('endpoint_groups', groups);
    savePreference('endpoint_group_map', endpointGroupMap);
  };

  useEffect(() => {
    if (authLoading || !user) return;

    const loadPreferences = async () => {
      try {
        const response = await fetch('/api/preferences', { credentials: 'include' });
        if (response.ok) {
          const prefs = await response.json();
          const customOrder = prefs.endpoint_custom_order || [];
          const groups = prefs.endpoint_groups || [];
          const groupMap = prefs.endpoint_group_map || {};
          
          const endpointsMap = new Map(endpoints.map((ep: Endpoint) => [ep.id, ep]));
          const orderedEndpoints = customOrder
            .map((id: string | number) => endpointsMap.get(id))
            .filter((ep?: Endpoint): ep is Endpoint => !!ep);

          const usedIds = new Set(orderedEndpoints.map((ep: Endpoint) => ep.id));
          endpoints.forEach((ep: Endpoint) => {
            if (!usedIds.has(ep.id)) orderedEndpoints.push(ep);
          });

          const newItems: SortableItem[] = [];
          const groupChildren: { [key: string]: Endpoint[] } = {};

          orderedEndpoints.forEach((ep: Endpoint) => {
            const groupId = groupMap[ep.id];
            if (groupId) {
              if (!groupChildren[groupId]) groupChildren[groupId] = [];
              groupChildren[groupId].push(ep);
            }
          });

          groups.forEach((group: EndpointGroup) => {
            newItems.push({
              ...group,
              children: groupChildren[group.id] || []
            });
          });

          const groupedEndpointIds = new Set(Object.values(groupMap));
          orderedEndpoints.forEach((ep: Endpoint) => {
            if (!groupMap[ep.id]) {
              newItems.push({ ...ep, type: 'endpoint' as const });
            }
          });
          
          setItems(newItems);
        }
      } catch (error) {
        console.error('Failed to load preferences:', error);
      }
      hasInitializedStateRef.current = true;
    };

    loadPreferences();
  }, [authLoading, user, endpoints]);

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
  
    if (!over || active.id === over.id) return;
  
    const activeId = active.id;
    const overId = over.id;
  
    setItems(currentItems => {
      let newItems = [...currentItems];
      let activeItem: SortableItem | Endpoint | undefined;
      let activeParent: EndpointGroup | undefined;
  
      // Find active item and its parent
      for (const item of newItems) {
        if (item.id === activeId) {
          activeItem = item;
          break;
        }
        if (item.type === 'group') {
          const childIndex = item.children.findIndex(c => c.id === activeId);
          if (childIndex !== -1) {
            activeItem = item.children[childIndex];
            activeParent = item;
            break;
          }
        }
      }
  
      if (!activeItem) return currentItems;
  
      // Remove active item from its original position
      if (activeParent) {
        const childIndex = activeParent.children.findIndex(c => c.id === activeId);
        activeParent.children.splice(childIndex, 1);
      } else {
        const topLevelIndex = newItems.findIndex(item => item.id === activeId);
        if (topLevelIndex !== -1) {
          newItems.splice(topLevelIndex, 1);
        }
      }
  
      // Find over item and its parent
      let overItem: SortableItem | Endpoint | undefined;
      let overParent: EndpointGroup | undefined;
      let overIndex = -1;
  
      for (const item of newItems) {
        if (item.id === overId) {
          overItem = item;
          overIndex = newItems.indexOf(item);
          break;
        }
        if (item.type === 'group') {
          const childIndex = item.children.findIndex(c => c.id === overId);
          if (childIndex !== -1) {
            overItem = item.children[childIndex];
            overParent = item;
            overIndex = childIndex;
            break;
          }
        }
      }
  
      // Insert active item into new position
      if (overItem?.type === 'group' && overItem.id !== activeId) {
        // Dropping onto a group
        (overItem.children as Endpoint[]).unshift(activeItem as Endpoint);
      } else if (overParent) {
        // Dropping into a group (next to another endpoint)
        overParent.children.splice(overIndex, 0, activeItem as Endpoint);
      } else {
        // Dropping at the top level
        if (overIndex !== -1) {
          newItems.splice(overIndex, 0, activeItem as SortableItem);
        } else {
          newItems.push(activeItem as SortableItem);
        }
      }
      
      persistState(newItems);
      return newItems;
    });
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
      const updatedItems = [...items, newGroup];
      setItems(updatedItems);
      persistState(updatedItems);
      setNewGroupName('');
      setIsCreateGroupDialogOpen(false);
    }
  };

  const handleToggleGroupCollapse = (groupId: string) => {
    const updatedItems = items.map(item => 
      item.id === groupId && item.type === 'group'
        ? { ...item, collapsed: !item.collapsed }
        : item
    ) as SortableItem[];
    setItems(updatedItems);
    persistState(updatedItems);
  };

  const handleRenameGroup = (groupId: string, newName: string) => {
    const updatedItems = items.map(item =>
      item.id === groupId && item.type === 'group'
        ? { ...item, name: newName }
        : item
    ) as SortableItem[];
    setItems(updatedItems);
    persistState(updatedItems);
  };

  const handleDeleteGroup = (groupId: string) => {
    const groupToDelete = items.find(item => item.id === groupId && item.type === 'group') as EndpointGroup;
    if (!groupToDelete) return;

    const updatedItems = items.filter(item => item.id !== groupId);
    // Move children of deleted group to top level
    groupToDelete.children.forEach((child: Endpoint) => {
      updatedItems.push({ ...child, type: 'endpoint' as const });
    });
    
    setItems(updatedItems);
    persistState(updatedItems);
  };

  const handleMoveToGroup = (endpointId: string | number, groupId: string | null) => {
    let endpointToMove: Endpoint | undefined;
    const updatedItems = [...items];

    // Find and remove the endpoint from its current location
    for (let i = 0; i < updatedItems.length; i++) {
      const item = updatedItems[i];
      if (item.id === endpointId && item.type === 'endpoint') {
        endpointToMove = item as Endpoint;
        updatedItems.splice(i, 1);
        break;
      }
      if (item.type === 'group') {
        const childIndex = item.children.findIndex(c => c.id === endpointId);
        if (childIndex !== -1) {
          endpointToMove = item.children[childIndex];
          item.children.splice(childIndex, 1);
          break;
        }
      }
    }

    if (!endpointToMove) return;

    // Add the endpoint to the new group or to the top level
    if (groupId) {
      const targetGroup = updatedItems.find(item => item.id === groupId && item.type === 'group') as EndpointGroup;
      if (targetGroup) {
        targetGroup.children.push(endpointToMove);
      }
    } else {
      updatedItems.push({ ...endpointToMove, type: 'endpoint' as const });
    }

    setItems(updatedItems);
    persistState(updatedItems);
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

  const handleCloseContextMenu = () => setContextMenu(null);

  const allSortableIds = useMemo(() => {
    const ids: (string | number)[] = [];
    items.forEach(item => {
      ids.push(item.id);
      if (item.type === 'group') {
        item.children.forEach(child => ids.push(child.id));
      }
    });
    return ids;
  }, [items]);

  if (endpoints.length === 0) {
    return (
      <Box>
        {onAddEndpoint && (
          <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Tooltip title="Add Monitor">
              <IconButton color="primary" onClick={onAddEndpoint} size="small">
                <Add />
              </IconButton>
            </Tooltip>
          </Box>
        )}
        <Typography variant="body1" align="center" color="text.secondary" sx={{ mt: 2 }}>
          No endpoints to monitor.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 1 }}>
        {onAddEndpoint && (
          <Tooltip title="Add Monitor">
            <IconButton color="primary" onClick={onAddEndpoint} size="small">
              <Add />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Create Group">
          <IconButton color="secondary" onClick={() => setIsCreateGroupDialogOpen(true)} size="small">
            <CreateNewFolder />
          </IconButton>
        </Tooltip>
      </Box>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={allSortableIds} strategy={verticalListSortingStrategy}>
          <List>
            {items.map(item => {
              if (item.type === 'group') {
                const group = item as EndpointGroup;
                const activeCount = group.children.filter(ep => !ep.paused).length;
                return (
                  <Box key={group.id}>
                    <GroupingItem
                      group={group}
                      onToggleCollapse={handleToggleGroupCollapse}
                      onRename={handleRenameGroup}
                      onDelete={handleDeleteGroup}
                      isDraggable={true}
                      childrenCount={group.children.length}
                      activeEndpointsCount={activeCount}
                      endpoints={group.children}
                    />
                    {!group.collapsed && (
                      <Box sx={{ ml: 4, mr: 2 }}>
                        {group.children.map(endpoint => (
                          <EndpointListItem
                            key={endpoint.id}
                            endpoint={endpoint}
                            onSelect={onSelect}
                            isSelected={endpoint.id === selectedId}
                            onTogglePause={onTogglePause}
                            isDraggable={true}
                            onContextMenu={(e) => handleContextMenu(e, endpoint.id)}
                          />
                        ))}
                      </Box>
                    )}
                  </Box>
                );
              } else {
                const endpoint = item as Endpoint;
                return (
                  <EndpointListItem
                    key={endpoint.id}
                    endpoint={endpoint}
                    onSelect={onSelect}
                    isSelected={endpoint.id === selectedId}
                    onTogglePause={onTogglePause}
                    isDraggable={true}
                    onContextMenu={(e) => handleContextMenu(e, endpoint.id)}
                  />
                );
              }
            })}
          </List>
        </SortableContext>
      </DndContext>

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
            onKeyPress={(e) => e.key === 'Enter' && handleCreateGroup()}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsCreateGroupDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateGroup} variant="contained">Create</Button>
        </DialogActions>
      </Dialog>

      <Menu
        open={contextMenu !== null}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        <MenuItem onClick={() => handleMoveToGroup(contextMenu!.endpointId, null)}>
          Remove from group
        </MenuItem>
        {items.filter(item => item.type === 'group').map(group => (
          <MenuItem key={group.id} onClick={() => handleMoveToGroup(contextMenu!.endpointId, group.id)}>
            Move to "{group.name}"
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
};

export default EndpointList;
