import React from 'react';
import { Chip } from '@mui/material';
import { Public as GlobalIcon } from '@mui/icons-material';

interface MultiLocationStatusProps {
  endpointId: number;
  isExpanded?: boolean;
  showLocationDetails?: boolean;
  size?: 'small' | 'medium' | 'large';
  isSelected?: boolean;
}

const MultiLocationStatus: React.FC<MultiLocationStatusProps> = () => {
  // Simplified: always return single location chip, no realtime updates
  return (
    <Chip
      icon={<GlobalIcon />}
      label="Single Location"
      size="small"
      variant="outlined"
      color="default"
    />
  );
};

export default MultiLocationStatus;