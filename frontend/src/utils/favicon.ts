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
  ctx.fillStyle = hasFailed ? '#ff4444' : '#22c55ec9';
  ctx.beginPath();
  ctx.arc(64, 64, 64, 0, 2 * Math.PI);
  ctx.fill();
  
  // Draw a thick white arrow pointing up.
  ctx.fillStyle = '#ffffffff';
  ctx.beginPath();
  ctx.moveTo(44, 100); // Start at bottom-left of the arrow base
  ctx.lineTo(84, 100); // Draw base
  ctx.lineTo(84, 55); // Right side of arrow shaft
  ctx.lineTo(104, 55); // Right side of arrow head base
  ctx.lineTo(64, 20);  // Tip of the arrow
  ctx.lineTo(24, 55);  // Left side of arrow head base
  ctx.lineTo(44, 55);  // Left side of arrow shaft
  ctx.closePath();    // Close path to form a solid shape
  ctx.fill();

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
