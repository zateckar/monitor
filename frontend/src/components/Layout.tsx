import React from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  IconButton,
  Menu,
  MenuItem,
  Avatar,
  Chip,
  Tabs,
  Tab
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import DashboardIcon from '@mui/icons-material/Dashboard';
import { useAuth } from '../contexts/AuthContext';

interface LayoutProps {
  master?: React.ReactNode;
  detail?: React.ReactNode;
  fullContent?: React.ReactNode;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  currentView: 'endpoints' | 'health';
  onViewChange: (view: 'endpoints' | 'health') => void;
}

const Layout: React.FC<LayoutProps> = ({
  master,
  detail,
  fullContent,
  showSettings,
  setShowSettings,
  currentView,
  onViewChange
}) => {
  const { user, logout } = useAuth();
  const [userMenuAnchor, setUserMenuAnchor] = React.useState<null | HTMLElement>(null);

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setUserMenuAnchor(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setUserMenuAnchor(null);
  };

  const handleLogout = async () => {
    await logout();
    handleUserMenuClose();
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%' }}>
      <AppBar position="static">
        <Toolbar sx={{ px: { xs: 2, sm: 3, md: 4 } }}>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Endpoint Monitor
          </Typography>
          
          {/* Navigation Tabs */}
          {user && (
            <Box sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center' }}>
              <Tabs
                value={currentView}
                onChange={(_, newValue) => onViewChange(newValue)}
                textColor="inherit"
                indicatorColor="secondary"
                sx={{
                  '& .MuiTab-root': {
                    color: 'rgba(255, 255, 255, 0.7)',
                    '&.Mui-selected': { color: 'white' }
                  }
                }}
              >
                <Tab
                  value="endpoints"
                  label="Endpoints"
                  icon={<MonitorHeartIcon />}
                  iconPosition="start"
                />
                {user.role === 'admin' && (
                  <Tab
                    value="health"
                    label="Instance Health"
                    icon={<DashboardIcon />}
                    iconPosition="start"
                  />
                )}
              </Tabs>
            </Box>
          )}
          
          {user && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Chip
                label={user.role?.toUpperCase() || 'USER'}
                size="small"
                color={user.role === 'admin' ? 'secondary' : 'default'}
                sx={{
                  backgroundColor: user.role === 'admin' ? 'secondary.main' : 'grey.600',
                  color: 'white',
                  fontWeight: 'bold'
                }}
              />
              
              <IconButton
                size="large"
                edge="end"
                aria-label="account of current user"
                aria-controls="user-menu"
                aria-haspopup="true"
                onClick={handleUserMenuOpen}
                color="inherit"
              >
                <Avatar sx={{ width: 32, height: 32, bgcolor: 'secondary.main' }}>
                  {user.username?.charAt(0).toUpperCase() || 'U'}
                </Avatar>
              </IconButton>
            </Box>
          )}

          <IconButton
            color="inherit"
            onClick={() => setShowSettings(!showSettings)}
            aria-label="settings"
            sx={{ ml: 1 }}
          >
            <SettingsIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Menu
        id="user-menu"
        anchorEl={userMenuAnchor}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        open={Boolean(userMenuAnchor)}
        onClose={handleUserMenuClose}
      >
        <MenuItem disabled>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <Typography variant="subtitle2">{user?.username}</Typography>
            <Typography variant="caption" color="text.secondary">
              {user?.email || 'No email'}
            </Typography>
          </Box>
        </MenuItem>
        <MenuItem onClick={handleLogout}>
          <LogoutIcon sx={{ mr: 1 }} />
          Logout
        </MenuItem>
      </Menu>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          px: { xs: 2, sm: 3, md: 4 },
          py: { xs: 2, sm: 3, md: 4 },
          width: '100%',
          maxWidth: '100%'
        }}
      >
        {fullContent ? (
          // Full-width content (like Instance Health Dashboard)
          <Box sx={{ height: 'calc(100vh - 120px)', width: '100%' }}>
            {fullContent}
          </Box>
        ) : (
          // Master-detail layout (for Endpoints view)
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: '1fr',
                md: '350px 1fr',
                lg: '400px 1fr',
                xl: '450px 1fr'
              },
              gap: { xs: 2, sm: 3, md: 4 },
              height: 'calc(100vh - 120px)',
              width: '100%'
            }}
          >
            <Box sx={{
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {master}
            </Box>
            <Box sx={{
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {detail}
            </Box>
          </Box>
        )}
      </Box>
      <Box
        component="footer"
        sx={{
          py: 2,
          px: { xs: 2, sm: 3, md: 4 },
          mt: 'auto',
          backgroundColor: (theme) =>
            theme.palette.mode === 'light'
              ? theme.palette.grey[200]
              : theme.palette.grey[800],
        }}
      >
        <Typography variant="body2" color="text.secondary" align="center">
          {'© '}
          {new Date().getFullYear()} Endpoint Monitor. All rights reserved.
        </Typography>
      </Box>
    </Box>
  );
};

export default Layout;
