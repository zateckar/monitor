import React, { useState, useEffect } from 'react';
import { TextField, Button, Box, Typography, Collapse, IconButton, Select, MenuItem, InputLabel, FormControl, Checkbox, FormControlLabel, Alert } from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import type { Endpoint, MonitorType } from '../types';
import { 
  validateUrl, 
  validateText, 
  validateHttpHeaders, 
  validateJson,
  validateCertificate,
  validatePrivateKey,
  validateNumber,
  validatePort,
  validateHttpStatuses,
  MAX_LENGTHS,
  sanitizeForDisplay
} from '../utils/validation';

interface EditEndpointFormProps {
  endpoint: Endpoint;
  onUpdate: (endpoint: Endpoint) => void;
  onCancel: () => void;
}

const EditEndpointForm: React.FC<EditEndpointFormProps> = ({ endpoint, onUpdate, onCancel }) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<MonitorType>('http');
  const [url, setUrl] = useState('');
  const [heartbeatInterval, setHeartbeatInterval] = useState(60);
  const [retries, setRetries] = useState(3);
  const [httpMethod, setHttpMethod] = useState('GET');
  const [httpHeaders, setHttpHeaders] = useState('');
  const [httpBody, setHttpBody] = useState('');
  const [okHttpStatuses, setOkHttpStatuses] = useState('');
  const [checkCertExpiry, setCheckCertExpiry] = useState(false);
  const [certExpiryThreshold, setCertExpiryThreshold] = useState(30);
  const [certCheckInterval, setCertCheckInterval] = useState(6); // Default 6 hours
  const [keywordSearch, setKeywordSearch] = useState('');
  const [upsideDownMode, setUpsideDownMode] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tcpPort, setTcpPort] = useState<number | undefined>();
  const [kafkaTopic, setKafkaTopic] = useState<string | undefined>();
  const [kafkaMessage, setKafkaMessage] = useState<string | undefined>();
  const [kafkaConfig, setKafkaConfig] = useState<string | undefined>();
  
  // mTLS state
  const [clientCertEnabled, setClientCertEnabled] = useState(false);
  const [clientCertPublicKey, setClientCertPublicKey] = useState('');
  const [clientCertPrivateKey, setClientCertPrivateKey] = useState('');
  const [clientCertCa, setClientCertCa] = useState('');

  // Validation error states
  const [validationErrors, setValidationErrors] = useState<{ [key: string]: string }>({});
  const [hasValidationErrors, setHasValidationErrors] = useState(false);

  // Real-time validation function
  const validateField = (fieldName: string, value: string | number | boolean, validationType: string) => {
    let validation;
    switch (validationType) {
      case 'url':
        validation = validateUrl(String(value));
        break;
      case 'text':
        validation = validateText(String(value), MAX_LENGTHS.NAME, fieldName);
        break;
      case 'longtext':
        validation = validateText(String(value), MAX_LENGTHS.HTTP_BODY, fieldName);
        break;
      case 'headers':
        validation = validateHttpHeaders(String(value));
        break;
      case 'json':
        validation = validateJson(String(value), fieldName);
        break;
      case 'certificate':
        validation = validateCertificate(String(value), fieldName);
        break;
      case 'privatekey':
        validation = validatePrivateKey(String(value), fieldName);
        break;
      case 'number':
        validation = validateNumber(Number(value), 10, 86400, fieldName);
        break;
      case 'port':
        validation = validatePort(Number(value));
        break;
      case 'statuses':
        validation = validateHttpStatuses(String(value));
        break;
      default:
        validation = { isValid: true };
    }

    const newErrors = { ...validationErrors };
    if (!validation.isValid) {
      newErrors[fieldName] = validation.error!;
    } else {
      delete newErrors[fieldName];
    }

    setValidationErrors(newErrors);
    setHasValidationErrors(Object.keys(newErrors).length > 0);
    return validation;
  };

  useEffect(() => {
    if (endpoint) {
      setName(sanitizeForDisplay(endpoint.name));
      setType(endpoint.type);
      setUrl(endpoint.url);
      setHeartbeatInterval(endpoint.heartbeat_interval);
      setRetries(endpoint.retries);
      setHttpMethod(endpoint.http_method || 'GET');

      // Parse HTTP headers from JSON string if needed
      let parsedHeaders = '';
      if (endpoint.http_headers) {
        if (typeof endpoint.http_headers === 'string') {
          try {
            const parsed = JSON.parse(endpoint.http_headers);
            // Convert object back to formatted JSON string for display
            parsedHeaders = JSON.stringify(parsed, null, 2);
          } catch (e) {
            // If parsing fails, use as-is (might already be a formatted string)
            parsedHeaders = endpoint.http_headers;
          }
        } else if (typeof endpoint.http_headers === 'object') {
          parsedHeaders = JSON.stringify(endpoint.http_headers, null, 2);
        }
      }
      setHttpHeaders(parsedHeaders);

      setHttpBody(endpoint.http_body || '');

      // Parse OK HTTP statuses
      let parsedStatuses = '';
      if (endpoint.ok_http_statuses) {
        if (Array.isArray(endpoint.ok_http_statuses)) {
          parsedStatuses = endpoint.ok_http_statuses.join(',');
        } else if (typeof endpoint.ok_http_statuses === 'string') {
          try {
            const parsed = JSON.parse(endpoint.ok_http_statuses);
            parsedStatuses = Array.isArray(parsed) ? parsed.join(',') : endpoint.ok_http_statuses;
          } catch (e) {
            parsedStatuses = endpoint.ok_http_statuses;
          }
        }
      }
      setOkHttpStatuses(parsedStatuses);

      setCheckCertExpiry(endpoint.check_cert_expiry || false);
      setCertExpiryThreshold(endpoint.cert_expiry_threshold || 30);
      setCertCheckInterval(endpoint.cert_check_interval ? endpoint.cert_check_interval / 3600 : 6); // Convert seconds to hours
      setKeywordSearch(endpoint.keyword_search || '');
      setUpsideDownMode(endpoint.upside_down_mode);
      setTcpPort(endpoint.tcp_port);
      setKafkaTopic(endpoint.kafka_topic);
      setKafkaMessage(endpoint.kafka_message);

      // Parse Kafka config from JSON string if needed
      let parsedKafkaConfig = '';
      if (endpoint.kafka_config) {
        if (typeof endpoint.kafka_config === 'string') {
          try {
            const parsed = JSON.parse(endpoint.kafka_config);
            parsedKafkaConfig = JSON.stringify(parsed, null, 2);
          } catch (e) {
            parsedKafkaConfig = endpoint.kafka_config;
          }
        } else if (typeof endpoint.kafka_config === 'object') {
          parsedKafkaConfig = JSON.stringify(endpoint.kafka_config, null, 2);
        }
      }
      setKafkaConfig(parsedKafkaConfig);

      // mTLS values
      setClientCertEnabled(endpoint.client_cert_enabled || false);
      setClientCertPublicKey(endpoint.client_cert_public_key || '');
      setClientCertPrivateKey(endpoint.client_cert_private_key || '');
      setClientCertCa(endpoint.client_cert_ca || '');
    }
  }, [endpoint]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onUpdate({
      ...endpoint,
      name: name || url,
      type,
      url,
      heartbeat_interval: heartbeatInterval,
      retries,
      http_method: httpMethod,
      http_headers: httpHeaders,
      http_body: httpBody,
      ok_http_statuses: okHttpStatuses.split(',').map(s => s.trim()).filter(s => s),
      check_cert_expiry: checkCertExpiry,
      cert_expiry_threshold: certExpiryThreshold,
      cert_check_interval: certCheckInterval * 3600, // Convert hours to seconds
      keyword_search: keywordSearch || null,
      upside_down_mode: upsideDownMode,
      tcp_port: tcpPort,
      kafka_topic: kafkaTopic,
      kafka_message: kafkaMessage,
      kafka_config: kafkaConfig,
      client_cert_enabled: clientCertEnabled,
      client_cert_public_key: clientCertPublicKey || null,
      client_cert_private_key: clientCertPrivateKey || null,
      client_cert_ca: clientCertCa || null,
    });
  };

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ mb: 4 }}>
      {hasValidationErrors && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Please fix the validation errors below before submitting.
        </Alert>
      )}
      
      <TextField
        label="Friendly Name"
        variant="outlined"
        fullWidth
        value={name}
        onChange={(e) => {
          const value = e.target.value;
          setName(value);
          validateField('name', value, 'text');
        }}
        placeholder="My Awesome API"
        error={!!validationErrors.name}
        helperText={validationErrors.name}
        inputProps={{ maxLength: MAX_LENGTHS.NAME }}
        sx={{ mb: 2 }}
      />
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>Monitor Type</InputLabel>
        <Select
          value={type}
          label="Monitor Type"
          onChange={(e) => setType(e.target.value as MonitorType)}
        >
          <MenuItem value="http">HTTP</MenuItem>
          <MenuItem value="ping">Ping</MenuItem>
          <MenuItem value="tcp">TCP</MenuItem>
          <MenuItem value="kafka_producer">Kafka Producer</MenuItem>
          <MenuItem value="kafka_consumer">Kafka Consumer</MenuItem>
        </Select>
      </FormControl>
      <TextField
        label={type === 'kafka_producer' || type === 'kafka_consumer' ? 'Bootstrap Servers' : 'Endpoint URL'}
        variant="outlined"
        fullWidth
        value={url}
        onChange={(e) => {
          const value = e.target.value;
          setUrl(value);
          const isKafka = type === 'kafka_producer' || type === 'kafka_consumer';
          validateField('url', value, isKafka ? 'text' : 'url');
        }}
        placeholder={type === 'kafka_producer' || type === 'kafka_consumer' ? 'kafka-broker1:9092,kafka-broker2:9092' : 'https://example.com'}
        required
        error={!!validationErrors.url}
        helperText={validationErrors.url}
        inputProps={{ maxLength: MAX_LENGTHS.URL }}
        sx={{ mb: 2 }}
      />
      {type === 'tcp' && (
        <TextField
          label="TCP Port"
          variant="outlined"
          type="number"
          fullWidth
          value={tcpPort || ''}
          onChange={(e) => setTcpPort(parseInt(e.target.value, 10))}
          sx={{ mb: 2 }}
        />
      )}
      {(type === 'kafka_producer' || type === 'kafka_consumer') && (
        <>
          <TextField
            label="Kafka Topic"
            variant="outlined"
            fullWidth
            value={kafkaTopic || ''}
            onChange={(e) => setKafkaTopic(e.target.value)}
            sx={{ mb: 2 }}
          />
          {type === 'kafka_producer' && (
            <TextField
              label="Kafka Message"
              variant="outlined"
              fullWidth
              multiline
              rows={3}
              value={kafkaMessage || ''}
              onChange={(e) => setKafkaMessage(e.target.value)}
              sx={{ mb: 2 }}
            />
          )}
          <TextField
            label="Kafka Config (JSON)"
            variant="outlined"
            fullWidth
            multiline
            rows={3}
            value={kafkaConfig || ''}
            onChange={(e) => setKafkaConfig(e.target.value)}
            placeholder='{ "sasl": { "mechanisms": "PLAIN", "username": "...", "password": "..." } }'
            sx={{ mb: 2 }}
          />
        </>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowAdvanced(!showAdvanced)}>
        <Typography variant="subtitle1">Advanced Options</Typography>
        <IconButton size="small">
          <ExpandMoreIcon
            sx={{
              transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.3s',
            }}
          />
        </IconButton>
      </Box>
      <Collapse in={showAdvanced}>
        <TextField
          label="Heartbeat Interval (seconds)"
          variant="outlined"
          type="number"
          fullWidth
          value={heartbeatInterval}
          onChange={(e) => setHeartbeatInterval(parseInt(e.target.value, 10))}
          sx={{ mt: 2, mb: 2 }}
        />
        <TextField
          label="Retries before failure"
          variant="outlined"
          type="number"
          fullWidth
          value={retries}
          onChange={(e) => setRetries(parseInt(e.target.value, 10))}
          sx={{ mb: 2 }}
        />
        {type === 'http' && (
          <>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>HTTP Method</InputLabel>
              <Select
                value={httpMethod}
                label="HTTP Method"
                onChange={(e) => setHttpMethod(e.target.value)}
              >
                <MenuItem value="GET">GET</MenuItem>
                <MenuItem value="POST">POST</MenuItem>
                <MenuItem value="PUT">PUT</MenuItem>
                <MenuItem value="DELETE">DELETE</MenuItem>
                <MenuItem value="PATCH">PATCH</MenuItem>
                <MenuItem value="HEAD">HEAD</MenuItem>
                <MenuItem value="OPTIONS">OPTIONS</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="HTTP Headers (JSON)"
              variant="outlined"
              fullWidth
              multiline
              rows={3}
              value={httpHeaders}
              onChange={(e) => setHttpHeaders(e.target.value)}
              placeholder='{ "Authorization": "Bearer your-token" }'
              sx={{ mb: 2 }}
            />
            <TextField
              label="HTTP Body"
              variant="outlined"
              fullWidth
              multiline
              rows={3}
              value={httpBody}
              onChange={(e) => setHttpBody(e.target.value)}
              sx={{ mb: 2 }}
            />
            <TextField
              label="OK HTTP Statuses (comma-separated)"
              variant="outlined"
              fullWidth
              value={okHttpStatuses}
              onChange={(e) => setOkHttpStatuses(e.target.value)}
              placeholder="200,201,302"
              sx={{ mb: 2 }}
            />
            <TextField
              label="Keyword Search (case-sensitive)"
              variant="outlined"
              fullWidth
              value={keywordSearch}
              onChange={(e) => setKeywordSearch(e.target.value)}
              placeholder="success"
              helperText="If specified, the response must contain this keyword to be considered successful"
              sx={{ mb: 2 }}
            />
            <FormControlLabel
              control={<Checkbox checked={checkCertExpiry} onChange={(e) => setCheckCertExpiry(e.target.checked)} />}
              label="Check SSL Certificate Expiry"
            />
            <TextField
              label="Certificate Expiry Threshold (days)"
              variant="outlined"
              type="number"
              fullWidth
              value={certExpiryThreshold}
              onChange={(e) => setCertExpiryThreshold(parseInt(e.target.value, 10))}
              sx={{ mt: 2, mb: 2 }}
              disabled={!checkCertExpiry}
            />
            <TextField
              label="Certificate Check Interval (hours)"
              variant="outlined"
              type="number"
              fullWidth
              value={certCheckInterval}
              onChange={(e) => setCertCheckInterval(parseInt(e.target.value, 10))}
              sx={{ mb: 2 }}
              disabled={!checkCertExpiry}
              inputProps={{ min: 1, max: 168 }}
              helperText="How often to check certificate expiration. Default: 6 hours"
            />
          </>
        )}
        {(type === 'http' || type === 'kafka_producer' || type === 'kafka_consumer') && (
          <>
            <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
              mTLS (Client Certificates)
            </Typography>
            <FormControlLabel
              control={<Checkbox checked={clientCertEnabled} onChange={(e) => setClientCertEnabled(e.target.checked)} />}
              label="Enable Client Certificate Authentication"
              sx={{ mb: 2 }}
            />
            {clientCertEnabled && (
              <>
                <TextField
                  label="Client Certificate (PEM format)"
                  variant="outlined"
                  fullWidth
                  multiline
                  rows={4}
                  value={clientCertPublicKey}
                  onChange={(e) => setClientCertPublicKey(e.target.value)}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;MIIBkTCB+wIJAMIcoOY...&#10;-----END CERTIFICATE-----"
                  sx={{ mb: 2 }}
                />
                <TextField
                  label="Private Key (PEM format)"
                  variant="outlined"
                  fullWidth
                  multiline
                  rows={4}
                  value={clientCertPrivateKey}
                  onChange={(e) => setClientCertPrivateKey(e.target.value)}
                  placeholder="-----BEGIN PRIVATE KEY-----&#10;MIIEvgIBADANBgkqhkiG...&#10;-----END PRIVATE KEY-----"
                  sx={{ mb: 2 }}
                />
                <TextField
                  label="CA Certificate (PEM format, optional)"
                  variant="outlined"
                  fullWidth
                  multiline
                  rows={4}
                  value={clientCertCa}
                  onChange={(e) => setClientCertCa(e.target.value)}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;MIIBkTCB+wIJAMIcoOY...&#10;-----END CERTIFICATE-----"
                  helperText="Optional: CA certificate to verify the server certificate"
                  sx={{ mb: 2 }}
                />
              </>
            )}
          </>
        )}
        <FormControlLabel
          control={<Checkbox checked={upsideDownMode} onChange={(e) => setUpsideDownMode(e.target.checked)} />}
          label="Upside Down Mode (Fail on success)"
        />
      </Collapse>
      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={onCancel} sx={{ mr: 2 }}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" color="primary">
          Update Monitor
        </Button>
      </Box>
    </Box>
  );
};

export default EditEndpointForm;
