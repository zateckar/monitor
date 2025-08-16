import { Database } from 'bun:sqlite';

// Gap-aware uptime calculation function
export async function calculateGapAwareUptime(db: Database, endpointId: number, heartbeatInterval: number, period: string) {
  // Get all checks in the time period, ordered by time
  const checks = db.query(
    `SELECT created_at, status, response_time
     FROM response_times 
     WHERE endpoint_id = ? AND created_at >= datetime('now', '-${period}')
     ORDER BY created_at ASC`
  ).all(endpointId) as any[];

  if (checks.length === 0) {
    return { avg_response: 0, uptime: 0, monitoring_coverage: 0 };
  }

  // Convert heartbeat interval to milliseconds and add tolerance
  const expectedIntervalMs = heartbeatInterval * 1000;
  const gapThresholdMs = expectedIntervalMs * 2.5; // Allow 2.5x interval as gap threshold
  
  // Group checks into continuous monitoring sessions
  const monitoringSessions: Array<{start: Date, end: Date, checks: any[]}> = [];
  let currentSession = {
    start: new Date(checks[0].created_at),
    end: new Date(checks[0].created_at),
    checks: [checks[0]]
  };

  for (let i = 1; i < checks.length; i++) {
    const currentCheck = checks[i];
    const previousCheck = checks[i - 1];
    
    const timeDiff = new Date(currentCheck.created_at).getTime() - new Date(previousCheck.created_at).getTime();
    
    if (timeDiff <= gapThresholdMs) {
      // Continue current session
      currentSession.end = new Date(currentCheck.created_at);
      currentSession.checks.push(currentCheck);
    } else {
      // Gap detected - end current session and start new one
      monitoringSessions.push(currentSession);
      currentSession = {
        start: new Date(currentCheck.created_at),
        end: new Date(currentCheck.created_at),
        checks: [currentCheck]
      };
    }
  }
  
  // Add the last session
  monitoringSessions.push(currentSession);

  // Calculate total monitored time and uptime using improved logic
  let totalMonitoredTimeMs = 0;
  let totalUptimeMs = 0;
  let totalResponseTime = 0;
  let totalChecks = 0;

  for (const session of monitoringSessions) {
    // Calculate session duration more accurately
    // If session has only one check, use the heartbeat interval as duration
    // Otherwise, use actual time span plus one interval to account for the last check
    let sessionDurationMs;
    if (session.checks.length === 1) {
      sessionDurationMs = expectedIntervalMs;
    } else {
      const sessionSpan = session.end.getTime() - session.start.getTime();
      sessionDurationMs = sessionSpan + expectedIntervalMs; // Add one interval for the last check
    }
    
    totalMonitoredTimeMs += sessionDurationMs;
    
    // Calculate uptime for this session based on UP/DOWN status of checks
    // Each check represents the status for one heartbeat interval
    let upChecks = 0;
    let totalSessionChecks = 0;
    
    for (const check of session.checks) {
      totalResponseTime += check.response_time || 0;
      totalChecks++;
      totalSessionChecks++;
      
      if (check.status === 'UP') {
        upChecks++;
      }
    }
    
    // Calculate session uptime: (UP checks / total checks) * session duration
    const sessionUptimeRatio = totalSessionChecks > 0 ? upChecks / totalSessionChecks : 0;
    const sessionUptimeMs = sessionDurationMs * sessionUptimeRatio;
    
    totalUptimeMs += sessionUptimeMs;
  }

  // Calculate final metrics
  const uptime = totalMonitoredTimeMs > 0 ? (totalUptimeMs / totalMonitoredTimeMs) * 100 : 0;
  const avgResponse = totalChecks > 0 ? totalResponseTime / totalChecks : 0;
  
  // Calculate monitoring coverage (how much of the period was actually monitored)
  const periodToMs: { [key: string]: number } = {
    '3 hours': 3 * 60 * 60 * 1000,
    '6 hours': 6 * 60 * 60 * 1000,
    '1 day': 24 * 60 * 60 * 1000,
    '7 days': 7 * 24 * 60 * 60 * 1000,
    '30 days': 30 * 24 * 60 * 60 * 1000,
    '365 days': 365 * 24 * 60 * 60 * 1000
  };
  const periodMs = periodToMs[period] || 24 * 60 * 60 * 1000; // Default to 1 day
  const monitoringCoverage = Math.min(100, (totalMonitoredTimeMs / periodMs) * 100);

  return {
    avg_response: avgResponse,
    uptime: Math.max(0, Math.min(100, uptime)), // Clamp between 0-100
    monitoring_coverage: Math.max(0, Math.min(100, monitoringCoverage))
  };
}
