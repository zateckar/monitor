import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Alert,
  Chip,
} from '@mui/material';

interface TimezoneSettings {
  timezone: string;
}

const TimezoneSettings: React.FC = () => {
  const [timezone, setTimezone] = useState<string>(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Load saved timezone from localStorage
    const savedTimezone = localStorage.getItem('app_timezone');
    if (savedTimezone) {
      setTimezone(savedTimezone);
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('app_timezone', timezone);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    
    // Dispatch custom event to notify other components
    window.dispatchEvent(new CustomEvent('timezoneChanged', { detail: { timezone } }));
  };

  const resetToSystem = () => {
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimezone(systemTimezone);
  };

  // Common timezones grouped by region
  const timezoneGroups = [
    {
      label: 'System Default',
      timezones: [Intl.DateTimeFormat().resolvedOptions().timeZone],
    },
    {
      label: 'North America',
      timezones: [
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'America/Phoenix',
        'America/Anchorage',
        'Pacific/Honolulu',
        'America/Toronto',
        'America/Vancouver',
      ],
    },
    {
      label: 'Europe',
      timezones: [
        'Europe/London',
        'Europe/Paris',
        'Europe/Berlin',
        'Europe/Rome',
        'Europe/Madrid',
        'Europe/Amsterdam',
        'Europe/Brussels',
        'Europe/Zurich',
        'Europe/Vienna',
        'Europe/Prague',
        'Europe/Warsaw',
        'Europe/Stockholm',
        'Europe/Helsinki',
        'Europe/Moscow',
      ],
    },
    {
      label: 'Asia Pacific',
      timezones: [
        'Asia/Tokyo',
        'Asia/Shanghai',
        'Asia/Hong_Kong',
        'Asia/Singapore',
        'Asia/Seoul',
        'Asia/Bangkok',
        'Asia/Jakarta',
        'Asia/Manila',
        'Asia/Kolkata',
        'Asia/Dubai',
        'Australia/Sydney',
        'Australia/Melbourne',
        'Pacific/Auckland',
      ],
    },
    {
      label: 'Other',
      timezones: [
        'UTC',
        'Africa/Cairo',
        'Africa/Johannesburg',
        'America/Sao_Paulo',
        'America/Buenos_Aires',
      ],
    },
  ];

  const formatTimezone = (tz: string) => {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en', {
        timeZone: tz,
        timeZoneName: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      const formatted = formatter.format(now);
      const city = tz.split('/').pop()?.replace('_', ' ') || tz;
      return `${city} (${formatted})`;
    } catch {
      return tz;
    }
  };

  const getCurrentTime = () => {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    });
    return formatter.format(now);
  };

  return (
    <Box>
      <Typography variant="h5" component="div" sx={{ mb: 3 }}>
        Timezone Settings
      </Typography>

      {saved && (
        <Alert severity="success" sx={{ mb: 3 }}>
          Timezone settings saved successfully!
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Current Time Display
          </Typography>
          <Box sx={{ p: 2, bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
              {getCurrentTime()}
            </Typography>
          </Box>
          <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Selected timezone:
            </Typography>
            <Chip label={timezone} size="small" />
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Select Timezone
          </Typography>
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Timezone</InputLabel>
            <Select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              label="Timezone"
            >
              {timezoneGroups.map((group) => [
                <MenuItem key={`${group.label}-header`} disabled sx={{ fontWeight: 'bold' }}>
                  {group.label}
                </MenuItem>,
                ...group.timezones.map((tz) => (
                  <MenuItem key={tz} value={tz} sx={{ pl: 3 }}>
                    {formatTimezone(tz)}
                  </MenuItem>
                )),
              ])}
            </Select>
          </FormControl>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button variant="contained" onClick={handleSave}>
              Save Timezone
            </Button>
            <Button variant="outlined" onClick={resetToSystem}>
              Reset to System Default
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Information
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            • Changing the timezone will affect how all dates and times are displayed throughout the application
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            • This includes monitor timestamps, outage histories, and log entries
          </Typography>
          <Typography variant="body2" color="text.secondary">
            • The setting is saved in your browser and will persist across sessions
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default TimezoneSettings;
