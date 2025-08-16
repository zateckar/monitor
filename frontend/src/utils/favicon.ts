// Utility functions for dynamic favicon management

export function createFaviconWithBadge(hasFailed: boolean): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    return '/vite.svg'; // Fallback to default
  }

  // Set canvas size to high resolution for crisp display
  canvas.width = 128;
  canvas.height = 128;

  // Add background circle to fill the space
  ctx.fillStyle = hasFailed ? '#ff4444' : '#22c55e';
  ctx.beginPath();
  ctx.arc(64, 64, 64, 0, 2 * Math.PI);
  ctx.fill();
  
  if (hasFailed) {
    // Draw a larger, bolder X for the failed state
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(32, 32);
    ctx.lineTo(96, 96);
    ctx.moveTo(96, 32);
    ctx.lineTo(32, 96);
    ctx.stroke();
  } else {
    // Draw a larger, bolder checkmark for the healthy state
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(36, 64);
    ctx.lineTo(58, 86);
    ctx.lineTo(92, 42);
    ctx.stroke();
  }

  // Convert canvas to data URL
  return canvas.toDataURL('image/png');
}

export function updateFavicon(hasFailed: boolean): void {
  try {
    // Remove existing favicon
    const existingLink = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
    if (existingLink) {
      existingLink.remove();
    }

    // Create new favicon link
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = createFaviconWithBadge(hasFailed);
    
    // Add to document head
    document.head.appendChild(link);
  } catch (error) {
    console.error('Failed to update favicon:', error);
  }
}

export function checkMonitorStatus(endpoints: Array<{ status: string; paused: boolean }>): boolean {
  return endpoints.some(endpoint => !endpoint.paused && endpoint.status === 'DOWN');
}
