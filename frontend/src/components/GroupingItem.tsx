import React from 'react';
import { 
  Card, 
  CardContent, 
  Typography, 
  Box, 
  IconButton, 
  Chip,
  CardActionArea 
} from '@mui/material';
import { 
  ExpandMore, 
  ChevronRight, 
  DragIndicator,
  Add,
  Delete
} from '@mui/icons-material';
import {
  useSortable
} from '@dnd-kit/sortable';
import {
  CSS
} from '@dnd-kit/utilities';
import type { EndpointGroup, Endpoint } from '../types';

interface GroupingItemProps {
  group: EndpointGroup;
  onToggleCollapse: (groupId: string) => void;
  onRename?: (groupId: string, newName: string) => void;
  onDelete?: (groupId: string) => void;
  onAddToGroup?: (groupId: string) => void;
  isDraggable?: boolean;
  childrenCount: number;
  activeEndpointsCount: number;
  endpoints: Endpoint[]; // Add endpoints array to calculate status
}

const GroupingItem: React.FC<GroupingItemProps> = ({
  group,
  onToggleCollapse,
  onRename,
  onDelete,
  onAddToGroup,
  isDraggable = false,
  childrenCount,
  activeEndpointsCount,
  endpoints
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const [isEditing, setIsEditing] = React.useState(false);
  const [editName, setEditName] = React.useState(group.name);

  const handleEditSubmit = () => {
    if (editName.trim() && editName !== group.name && onRename) {
      onRename(group.id, editName.trim());
    }
    setIsEditing(false);
    setEditName(group.name);
  };

  const handleEditCancel = () => {
    setIsEditing(false);
    setEditName(group.name);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEditSubmit();
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  // Calculate group status aggregation
  const groupStatus = React.useMemo(() => {
    if (endpoints.length === 0) {
      return { upCount: 0, downCount: 0, allUp: true };
    }

    const activeEndpoints = endpoints.filter(ep => !ep.paused);
    
    if (activeEndpoints.length === 0) {
      return { upCount: 0, downCount: 0, allUp: true };
    }

    let upCount = 0;
    let downCount = 0;

    activeEndpoints.forEach(endpoint => {
      // Consider an endpoint "UP" if status contains "up" or uptime is > 95%
      const isUp = endpoint.status?.toLowerCase().includes('up') || endpoint.uptime_24h > 95;
      
      if (isUp) {
        upCount++;
      } else {
        downCount++;
      }
    });

    return {
      upCount,
      downCount,
      allUp: downCount === 0 && upCount > 0
    };
  }, [endpoints]);

  return (
    <div ref={setNodeRef} style={style}>
      <Card sx={{ 
        mb: 1, 
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        '&:hover': {
          backgroundColor: 'action.hover'
        }
      }}>
        <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              {isDraggable && (
                <IconButton
                  size="small"
                  sx={{ 
                    mr: 1, 
                    cursor: 'grab',
                    '&:active': { cursor: 'grabbing' },
                    color: 'text.secondary'
                  }}
                  {...attributes}
                  {...listeners}
                  onClick={(e) => e.stopPropagation()}
                >
                  <DragIndicator fontSize="small" />
                </IconButton>
              )}
              
              <IconButton
                size="small"
                onClick={() => onToggleCollapse(group.id)}
                sx={{ mr: 1 }}
              >
                {group.collapsed ? <ChevronRight /> : <ExpandMore />}
              </IconButton>

              {isEditing ? (
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleEditSubmit}
                  onKeyDown={handleKeyPress}
                  autoFocus
                  style={{
                    border: 'none',
                    outline: 'none',
                    backgroundColor: 'transparent',
                    fontSize: 'inherit',
                    fontFamily: 'inherit',
                    fontWeight: 600,
                    width: '200px'
                  }}
                />
              ) : (
                <Typography 
                  variant="body1" 
                  component="div"
                  sx={{ 
                    fontWeight: 600,
                    color: 'text.primary',
                    cursor: onRename ? 'pointer' : 'default'
                  }}
                  onClick={() => onRename && setIsEditing(true)}
                >
                  {group.name}
                </Typography>
              )}

              <Chip
                label={`${childrenCount} items`}
                size="small"
                variant="outlined"
                sx={{ 
                  ml: 1, 
                  fontSize: '0.6rem', 
                  height: '18px',
                  minWidth: 'auto',
                  '& .MuiChip-label': {
                    px: 0.5
                  },
                  color: 'text.secondary',
                  borderColor: 'divider'
                }}
              />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {/* Status indicators */}
              {activeEndpointsCount > 0 && (
                <>
                  {groupStatus.allUp ? (
                    <Chip
                      label="UP"
                      size="small"
                      color="success"
                      sx={{ 
                        fontSize: '0.6rem', 
                        height: '18px',
                        minWidth: 'auto',
                        '& .MuiChip-label': {
                          px: 0.5
                        }
                      }}
                    />
                  ) : (
                    <>
                      {groupStatus.upCount > 0 && (
                        <Chip
                          label={`${groupStatus.upCount} UP`}
                          size="small"
                          color="success"
                          variant="outlined"
                          sx={{ 
                            fontSize: '0.6rem', 
                            height: '18px',
                            minWidth: 'auto',
                            '& .MuiChip-label': {
                              px: 0.5
                            }
                          }}
                        />
                      )}
                      {groupStatus.downCount > 0 && (
                        <Chip
                          label={`${groupStatus.downCount} DOWN`}
                          size="small"
                          color="error"
                          sx={{ 
                            fontSize: '0.6rem', 
                            height: '18px',
                            minWidth: 'auto',
                            '& .MuiChip-label': {
                              px: 0.5
                            }
                          }}
                        />
                      )}
                    </>
                  )}
                </>
              )}

              {onAddToGroup && (
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToGroup(group.id);
                  }}
                  sx={{ color: 'text.secondary' }}
                >
                  <Add fontSize="small" />
                </IconButton>
              )}
              
              {onDelete && (
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(group.id);
                  }}
                  sx={{ color: 'text.secondary' }}
                >
                  <Delete fontSize="small" />
                </IconButton>
              )}
            </Box>
          </Box>
        </CardContent>
      </Card>
    </div>
  );
};

export default GroupingItem;
