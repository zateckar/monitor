import React, { useState } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  IconButton,
  Dialog,
  DialogContent,
  AppBar,
  Toolbar,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import NotificationsIcon from '@mui/icons-material/Notifications';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import DescriptionIcon from '@mui/icons-material/Description';
import PaletteIcon from '@mui/icons-material/Palette';
import PublicIcon from '@mui/icons-material/Public';
import PeopleIcon from '@mui/icons-material/People';
import SecurityIcon from '@mui/icons-material/Security';

import NotificationSettings from './settings/NotificationSettings';
import TimezoneSettings from './settings/TimezoneSettings';
import LogsSettings from './settings/LogsSettings';
import StylingSettings from './settings/StylingSettings';
import StatusPagesSettings from './settings/StatusPagesSettings';
import UserManagement from './settings/UserManagement';
import OIDCSettings from './settings/OIDCSettings';
import { useAuth } from '../contexts/AuthContext';

interface SettingsProps {
  open: boolean;
  onClose: () => void;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `settings-tab-${index}`,
    'aria-controls': `settings-tabpanel-${index}`,
  };
}

const Settings: React.FC<SettingsProps> = ({ open, onClose }) => {
  const { user } = useAuth();
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: { minHeight: '80vh', maxHeight: '90vh' }
      }}
    >
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Settings
          </Typography>
          <IconButton
            edge="end"
            color="inherit"
            onClick={onClose}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs 
            value={tabValue} 
            onChange={handleTabChange} 
            aria-label="settings tabs"
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab 
              icon={<NotificationsIcon />} 
              label="Notifications" 
              {...a11yProps(0)} 
            />
            <Tab 
              icon={<AccessTimeIcon />} 
              label="Timezone" 
              {...a11yProps(1)} 
            />
            <Tab 
              icon={<DescriptionIcon />} 
              label="Logs" 
              {...a11yProps(2)} 
            />
            <Tab 
              icon={<PaletteIcon />} 
              label="Styling" 
              {...a11yProps(3)} 
            />
            <Tab 
              icon={<PublicIcon />} 
              label="Status Pages" 
              {...a11yProps(4)} 
            />
            {user?.role === 'admin' && (
              <Tab 
                icon={<SecurityIcon />} 
                label="OIDC" 
                {...a11yProps(5)} 
              />
            )}
            {user?.role === 'admin' && (
              <Tab 
                icon={<PeopleIcon />} 
                label="Users" 
                {...a11yProps(6)} 
              />
            )}
          </Tabs>
        </Box>

        <TabPanel value={tabValue} index={0}>
          <NotificationSettings />
        </TabPanel>
        <TabPanel value={tabValue} index={1}>
          <TimezoneSettings />
        </TabPanel>
        <TabPanel value={tabValue} index={2}>
          <LogsSettings />
        </TabPanel>
        <TabPanel value={tabValue} index={3}>
          <StylingSettings />
        </TabPanel>
        <TabPanel value={tabValue} index={4}>
          <StatusPagesSettings />
        </TabPanel>
        {user?.role === 'admin' && (
          <TabPanel value={tabValue} index={5}>
            <OIDCSettings />
          </TabPanel>
        )}
        {user?.role === 'admin' && (
          <TabPanel value={tabValue} index={6}>
            <UserManagement />
          </TabPanel>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default Settings;
