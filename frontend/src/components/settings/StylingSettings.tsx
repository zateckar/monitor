import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  FormControlLabel,
  Switch,
  Button,
  Alert,
  Paper,
  TextField,
  Chip,
  Divider,
} from '@mui/material';
import { SketchPicker } from 'react-color';
import type { ColorResult } from 'react-color';

interface ThemeSettings {
  mode: 'light' | 'dark';
  primaryColor: string;
  secondaryColor: string;
  errorColor: string;
  warningColor: string;
  infoColor: string;
  successColor: string;
}

const defaultSettings: ThemeSettings = {
  mode: 'light',
  primaryColor: '#419468',
  secondaryColor: '#78faae',
  errorColor: '#d32f2f',
  warningColor: '#ed6c02',
  infoColor: '#0288d1',
  successColor: '#59bc87',
};

const StylingSettings: React.FC = () => {
  const [settings, setSettings] = useState<ThemeSettings>(defaultSettings);
  const [saved, setSaved] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null);

  useEffect(() => {
    // Load saved theme settings from localStorage
    const savedSettings = localStorage.getItem('app_theme_settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setSettings({ ...defaultSettings, ...parsed });
      } catch (error) {
        console.error('Failed to parse theme settings:', error);
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('app_theme_settings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    
    // Dispatch custom event to notify app of theme change
    window.dispatchEvent(new CustomEvent('themeChanged', { detail: settings }));
  };

  const handleColorChange = (colorKey: keyof ThemeSettings, color: ColorResult) => {
    setSettings(prev => ({
      ...prev,
      [colorKey]: color.hex,
    }));
  };

  const handleModeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSettings(prev => ({
      ...prev,
      mode: event.target.checked ? 'dark' : 'light',
    }));
  };

  const resetToDefaults = () => {
    setSettings(defaultSettings);
  };

  const previewColors = [
    { key: 'primaryColor', label: 'Primary', description: 'Main brand color for buttons and highlights' },
    { key: 'secondaryColor', label: 'Secondary', description: 'Accent color for secondary elements' },
    { key: 'errorColor', label: 'Error', description: 'Color for error states and DOWN status' },
    { key: 'warningColor', label: 'Warning', description: 'Color for warnings and alerts' },
    { key: 'infoColor', label: 'Info', description: 'Color for informational elements' },
    { key: 'successColor', label: 'Success', description: 'Color for success states and UP status' },
  ] as const;

  const ColorPicker: React.FC<{ colorKey: keyof ThemeSettings; label: string; description: string }> = ({ 
    colorKey, 
    label, 
    description 
  }) => (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6">{label}</Typography>
          <Box
            sx={{
              width: 40,
              height: 40,
              bgcolor: settings[colorKey],
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              cursor: 'pointer',
            }}
            onClick={() => setColorPickerOpen(colorPickerOpen === colorKey ? null : colorKey)}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {description}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            size="small"
            value={settings[colorKey]}
            onChange={(e) => setSettings(prev => ({ ...prev, [colorKey]: e.target.value }))}
            placeholder="#000000"
            sx={{ width: 120 }}
          />
          <Chip label={settings[colorKey]} size="small" />
        </Box>
        {colorPickerOpen === colorKey && (
          <Box sx={{ mt: 2, position: 'relative' }}>
            <Box
              sx={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 1000,
              }}
              onClick={() => setColorPickerOpen(null)}
            />
            <Box sx={{ position: 'relative', zIndex: 1001 }}>
              <SketchPicker
                color={settings[colorKey]}
                onChange={(color) => handleColorChange(colorKey, color)}
              />
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );

  return (
    <Box>
      <Typography variant="h5" component="div" sx={{ mb: 3 }}>
        Styling & Theme
      </Typography>

      {saved && (
        <Alert severity="success" sx={{ mb: 3 }}>
          Theme settings saved successfully! Changes will be applied immediately.
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
        <Box sx={{ flex: 1 }}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Theme Mode
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.mode === 'dark'}
                    onChange={handleModeChange}
                  />
                }
                label={`${settings.mode === 'dark' ? 'Dark' : 'Light'} Mode`}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Switch between light and dark theme modes
              </Typography>
            </CardContent>
          </Card>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Theme Preview
              </Typography>
              <Paper 
                sx={{ 
                  p: 2, 
                  bgcolor: settings.mode === 'dark' ? '#121212' : '#ffffff',
                  color: settings.mode === 'dark' ? '#ffffff' : '#000000',
                  border: 1,
                  borderColor: 'divider'
                }}
              >
                <Typography variant="h6" sx={{ mb: 2, color: settings.primaryColor }}>
                  Sample Header
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                  <Chip label="UP" sx={{ bgcolor: settings.successColor, color: 'white' }} />
                  <Chip label="DOWN" sx={{ bgcolor: settings.errorColor, color: 'white' }} />
                  <Chip label="WARNING" sx={{ bgcolor: settings.warningColor, color: 'white' }} />
                  <Chip label="INFO" sx={{ bgcolor: settings.infoColor, color: 'white' }} />
                </Box>
                <Button variant="contained" sx={{ bgcolor: settings.primaryColor, mr: 1 }}>
                  Primary Button
                </Button>
                <Button variant="contained" sx={{ bgcolor: settings.secondaryColor }}>
                  Secondary Button
                </Button>
              </Paper>
            </CardContent>
          </Card>
        </Box>

        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Color Customization
          </Typography>
          {previewColors.map(({ key, label, description }) => (
            <ColorPicker
              key={key}
              colorKey={key}
              label={label}
              description={description}
            />
          ))}
        </Box>
      </Box>

      <Divider sx={{ my: 3 }} />

      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <Button variant="outlined" onClick={resetToDefaults}>
          Reset to Defaults
        </Button>
        <Button variant="contained" onClick={handleSave}>
          Save Theme Settings
        </Button>
      </Box>

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Information
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            • Theme changes are applied immediately and saved in your browser
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            • Colors affect status indicators, buttons, and other UI elements throughout the application
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            • Dark mode reduces eye strain in low-light environments
          </Typography>
          <Typography variant="body2" color="text.secondary">
            • Settings will persist across browser sessions
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default StylingSettings;
