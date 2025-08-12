// Utility functions for dynamic favicon management

export function createFaviconWithBadge(hasFailed: boolean): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    return '/vite.svg'; // Fallback to default
  }

  // Set canvas size
  canvas.width = 32;
  canvas.height = 32;

  // Create the base icon (a simple monitor/heart icon)
  ctx.fillStyle = hasFailed ? '#ff6b6b' : '#4CAF50'; // Red if failed, green if ok
  
  // Draw a simple monitor/heart shape
  if (hasFailed) {
    // Draw a simple monitor with X for failed state
    ctx.fillStyle = '#333';
    ctx.fillRect(4, 8, 24, 16);
    ctx.fillStyle = '#fff';
    ctx.fillRect(6, 10, 20, 12);
    
    // Draw red X
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(10, 14);
    ctx.lineTo(22, 20);
    ctx.moveTo(22, 14);
    ctx.lineTo(10, 20);
    ctx.stroke();
  } else {
    // Draw a simple monitor with checkmark for healthy state
    ctx.fillStyle = '#333';
    ctx.fillRect(4, 8, 24, 16);
    ctx.fillStyle = '#fff';
    ctx.fillRect(6, 10, 20, 12);
    
    // Draw green checkmark
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(10, 17);
    ctx.lineTo(14, 20);
    ctx.lineTo(22, 12);
    ctx.stroke();
  }

  // Add red badge for failed state
  if (hasFailed) {
    // Draw red circle badge in top-right corner
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(26, 6, 6, 0, 2 * Math.PI);
    ctx.fill();
    
    // Add white exclamation mark
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 8px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('!', 26, 9);
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
