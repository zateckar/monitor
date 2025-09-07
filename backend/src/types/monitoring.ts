import type { Endpoint } from './index';

export interface IMonitoringService {
  startEndpointMonitoring(endpoint: Endpoint): void;
  stopEndpointMonitoring(endpointId: number): void;
  restartEndpointMonitoring(endpointId: number): void;
  startCertificateMonitoring(endpoint: Endpoint): void;
  stopCertificateMonitoring(endpointId: number): void;
  initializeMonitoring(): Promise<void>;
  checkSingleEndpoint(endpoint: Endpoint): Promise<void>;
}