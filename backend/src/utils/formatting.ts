export function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    const remainingMinutes = minutes % 60;
    if (days === 1 && remainingHours === 0 && remainingMinutes === 0) {
      return '1 day';
    } else if (remainingHours === 0 && remainingMinutes === 0) {
      return `${days} days`;
    } else if (remainingHours > 0 && remainingMinutes === 0) {
      return `${days}d ${remainingHours}h`;
    } else if (remainingHours === 0) {
      return `${days}d ${remainingMinutes}m`;
    } else {
      return `${days}d ${remainingHours}h ${remainingMinutes}m`;
    }
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) {
      return `${hours}h`;
    } else {
      return `${hours}h ${remainingMinutes}m`;
    }
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) {
      return `${minutes}m`;
    } else {
      return `${minutes}m ${remainingSeconds}s`;
    }
  } else {
    return `${seconds}s`;
  }
}
