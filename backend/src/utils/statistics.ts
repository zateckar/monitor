/**
 * Statistical utility functions for calculating percentiles, standard deviation, and MAD
 */

/**
 * Calculate percentiles from an array of numbers
 * @param values Array of numeric values
 * @param percentiles Array of percentile values (e.g., [50, 90, 95, 99])
 * @returns Object with percentile values
 */
export function calculatePercentiles(values: number[], percentiles: number[]): Record<string, number> {
  if (values.length === 0) {
    const result: Record<string, number> = {};
    percentiles.forEach(p => {
      result[`p${p}`] = 0;
    });
    return result;
  }

  // Sort values in ascending order
  const sorted = [...values].sort((a, b) => a - b);
  const result: Record<string, number> = {};

  percentiles.forEach(percentile => {
    const index = (percentile / 100) * (sorted.length - 1);
    
    if (Number.isInteger(index)) {
      result[`p${percentile}`] = sorted[index] ?? 0;
    } else {
      // Linear interpolation between two nearest values
      const lower = Math.floor(index);
      const upper = Math.ceil(index);
      const weight = index - lower;
      const lowerValue = sorted[lower] ?? 0;
      const upperValue = sorted[upper] ?? 0;
      result[`p${percentile}`] = lowerValue * (1 - weight) + upperValue * weight;
    }
  });

  return result;
}

/**
 * Calculate standard deviation of an array of numbers
 * @param values Array of numeric values
 * @returns Standard deviation
 */
export function calculateStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return 0;

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
  const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / (values.length - 1); // Sample standard deviation
  
  return Math.sqrt(variance);
}

/**
 * Calculate Median Absolute Deviation (MAD)
 * @param values Array of numeric values
 * @returns Median Absolute Deviation
 */
export function calculateMAD(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return 0;

  // Calculate median
  const sorted = [...values].sort((a, b) => a - b);
  const median = calculateMedian(sorted);

  // Calculate absolute deviations from median
  const absoluteDeviations = values.map(value => Math.abs(value - median));
  
  // Return median of absolute deviations
  return calculateMedian(absoluteDeviations.sort((a, b) => a - b));
}

/**
 * Calculate median from a sorted array
 * @param sortedValues Sorted array of numeric values
 * @returns Median value
 */
function calculateMedian(sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0;
  
  const middle = Math.floor(sortedValues.length / 2);
  
  if (sortedValues.length % 2 === 0) {
    // Even number of elements - average of two middle values
    const leftValue = sortedValues[middle - 1] ?? 0;
    const rightValue = sortedValues[middle] ?? 0;
    return (leftValue + rightValue) / 2;
  } else {
    // Odd number of elements - middle value
    return sortedValues[middle] ?? 0;
  }
}

/**
 * Calculate comprehensive response time statistics
 * @param responseTimes Array of response time values
 * @returns Object containing all statistical measures
 */
export function calculateResponseTimeStatistics(responseTimes: number[]) {
  if (responseTimes.length === 0) {
    return {
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      std_dev: 0,
      mad: 0,
      min: 0,
      max: 0,
      count: 0
    };
  }

  const percentiles = calculatePercentiles(responseTimes, [50, 90, 95, 99]);
  const standardDeviation = calculateStandardDeviation(responseTimes);
  const mad = calculateMAD(responseTimes);
  const min = Math.min(...responseTimes);
  const max = Math.max(...responseTimes);

  return {
    p50: Math.round(percentiles.p50 ?? 0),
    p90: Math.round(percentiles.p90 ?? 0),
    p95: Math.round(percentiles.p95 ?? 0),
    p99: Math.round(percentiles.p99 ?? 0),
    std_dev: Math.round(standardDeviation * 100) / 100, // Round to 2 decimal places
    mad: Math.round(mad * 100) / 100, // Round to 2 decimal places
    min,
    max,
    count: responseTimes.length
  };
}
