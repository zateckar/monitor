import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Alert,
  Divider,
  List,
  ListItem,
  ListItemText,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Tab,
  Tabs,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SecurityIcon from '@mui/icons-material/Security';
import LanguageIcon from '@mui/icons-material/Language';
import DnsIcon from '@mui/icons-material/Dns';
import StorageIcon from '@mui/icons-material/Storage';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { CertificateChain, CertificateInfo, EnhancedDomainInfo } from '../types';
import { formatDateTime } from '../utils/timezone';

interface CertificateModalProps {
  open: boolean;
  onClose: () => void;
  endpointId: number | string;
  endpointName: string;
}

const CertificateModal: React.FC<CertificateModalProps> = ({
  open,
  onClose,
  endpointId,
  endpointName,
}) => {
  const [loading, setLoading] = useState(false);
  const [domainLoading, setDomainLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [certificateChain, setCertificateChain] = useState<CertificateChain | null>(null);
  const [enhancedDomainInfo, setEnhancedDomainInfo] = useState<EnhancedDomainInfo | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  const fetchCertificateChain = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/endpoints/${endpointId}/certificate-chain`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch certificate chain');
      }
      
      const data = await response.json();
      setCertificateChain(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch certificate chain');
    } finally {
      setLoading(false);
    }
  };

  const fetchEnhancedDomainInfo = async () => {
    setDomainLoading(true);
    setDomainError(null);
    
    try {
      const response = await fetch(`/api/endpoints/${endpointId}/enhanced-domain-info`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch domain information');
      }
      
      const data = await response.json();
      setEnhancedDomainInfo(data);
    } catch (err) {
      setDomainError(err instanceof Error ? err.message : 'Failed to fetch domain information');
    } finally {
      setDomainLoading(false);
    }
  };

  useEffect(() => {
    if (open && endpointId) {
      fetchCertificateChain();
      fetchEnhancedDomainInfo();
    }
  }, [open, endpointId]);

  const handleClose = () => {
    setCertificateChain(null);
    setEnhancedDomainInfo(null);
    setError(null);
    setDomainError(null);
    setActiveTab(0);
    onClose();
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const renderDomainInfo = () => {
    if (domainLoading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
          <CircularProgress />
          <Typography variant="body1" sx={{ ml: 2 }}>
            Loading domain information...
          </Typography>
        </Box>
      );
    }

    if (domainError) {
      return (
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="h6" gutterBottom>
            Failed to load domain information
          </Typography>
          <Typography variant="body2">
            {domainError}
          </Typography>
        </Alert>
      );
    }

    if (!enhancedDomainInfo) {
      return (
        <Typography variant="body2" color="text.secondary">
          No domain information available
        </Typography>
      );
    }

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Domain Registration Info */}
        <Card variant="outlined">
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <LanguageIcon color="primary" />
              <Typography variant="h6">Domain Registration</Typography>
            </Box>
            
            <List dense>
              {enhancedDomainInfo.domain.creationDate && (
                <ListItem>
                  <ListItemText
                    primary="Created"
                    secondary={formatDateTime(enhancedDomainInfo.domain.creationDate)}
                  />
                </ListItem>
              )}
              {enhancedDomainInfo.domain.updatedDate && (
                <ListItem>
                  <ListItemText
                    primary="Updated"
                    secondary={formatDateTime(enhancedDomainInfo.domain.updatedDate)}
                  />
                </ListItem>
              )}
              {enhancedDomainInfo.domain.expiryDate && (
                <ListItem>
                  <ListItemText
                    primary="Expires"
                    secondary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" component="span">
                          {formatDateTime(enhancedDomainInfo.domain.expiryDate)}
                        </Typography>
                        {enhancedDomainInfo.domain.daysRemaining !== null && (
                          <Chip
                            label={`${enhancedDomainInfo.domain.daysRemaining} days`}
                            size="small"
                            color={
                              enhancedDomainInfo.domain.daysRemaining <= 14 ? 'error' :
                              enhancedDomainInfo.domain.daysRemaining <= 45 ? 'warning' : 'success'
                            }
                          />
                        )}
                      </Box>
                    }
                  />
                </ListItem>
              )}
            </List>
          </CardContent>
        </Card>

        {/* DNS Information */}
        {enhancedDomainInfo.dns && (
          <Card variant="outlined">
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                <DnsIcon color="secondary" />
                <Typography variant="h6">DNS Records</Typography>
              </Box>
              
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {enhancedDomainInfo.dns.A.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>A Records</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {enhancedDomainInfo.dns.A.map((ip, idx) => (
                        <Chip key={idx} label={ip} size="small" variant="outlined" />
                      ))}
                    </Box>
                  </Box>
                )}
                
                {enhancedDomainInfo.dns.CNAME && (
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>CNAME</Typography>
                    <Chip label={enhancedDomainInfo.dns.CNAME} size="small" variant="outlined" />
                  </Box>
                )}
                
                {enhancedDomainInfo.dns.MX.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>MX Records</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {enhancedDomainInfo.dns.MX.map((mx, idx) => (
                        <Chip 
                          key={idx} 
                          label={`${mx.priority} ${mx.exchange}`} 
                          size="small" 
                          variant="outlined" 
                        />
                      ))}
                    </Box>
                  </Box>
                )}
                
                {enhancedDomainInfo.dns.NS.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>Name Servers</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {enhancedDomainInfo.dns.NS.map((ns, idx) => (
                        <Chip key={idx} label={ns} size="small" variant="outlined" />
                      ))}
                    </Box>
                  </Box>
                )}
                
                {enhancedDomainInfo.dns.TXT.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>TXT Records</Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {enhancedDomainInfo.dns.TXT.map((txt, idx) => (
                        <Box key={idx} sx={{ 
                          p: 1, 
                          bgcolor: 'action.hover', 
                          borderRadius: 1,
                          fontFamily: 'monospace',
                          fontSize: '0.75rem',
                          wordBreak: 'break-all'
                        }}>
                          {txt}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        )}

        {/* Server Information */}
        {enhancedDomainInfo.server && (
          <Card variant="outlined">
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                <StorageIcon color="info" />
                <Typography variant="h6">Server Information</Typography>
              </Box>
              
              <List dense>
                {enhancedDomainInfo.server.httpStatus && (
                  <ListItem>
                    <ListItemText
                      primary="HTTP Status"
                      secondary={
                        <Chip
                          label={enhancedDomainInfo.server.httpStatus}
                          size="small"
                          color={
                            enhancedDomainInfo.server.httpStatus >= 200 && enhancedDomainInfo.server.httpStatus < 300 
                              ? 'success' 
                              : enhancedDomainInfo.server.httpStatus >= 300 && enhancedDomainInfo.server.httpStatus < 400
                              ? 'warning'
                              : 'error'
                          }
                        />
                      }
                    />
                  </ListItem>
                )}
                {enhancedDomainInfo.server.serverHeader && (
                  <ListItem>
                    <ListItemText
                      primary="Server"
                      secondary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" component="span" sx={{ fontFamily: 'monospace' }}>
                            {enhancedDomainInfo.server.serverHeader}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={() => copyToClipboard(enhancedDomainInfo.server!.serverHeader!)}
                            title="Copy to clipboard"
                          >
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      }
                    />
                  </ListItem>
                )}
              </List>
            </CardContent>
          </Card>
        )}
      </Box>
    );
  };

  const getCertificateStatusIcon = (cert: CertificateInfo, isRoot: boolean) => {
    if (cert.daysRemaining <= 0) {
      return <ErrorIcon color="error" />;
    } else if (cert.daysRemaining <= 30) {
      return <WarningIcon color="warning" />;
    } else {
      return <CheckCircleIcon color="success" />;
    }
  };

  const getCertificateStatusText = (cert: CertificateInfo) => {
    if (cert.daysRemaining <= 0) {
      return 'Expired';
    } else if (cert.daysRemaining <= 30) {
      return 'Expires Soon';
    } else {
      return 'Valid';
    }
  };

  const getCertificateStatusColor = (cert: CertificateInfo): 'error' | 'warning' | 'success' => {
    if (cert.daysRemaining <= 0) {
      return 'error';
    } else if (cert.daysRemaining <= 30) {
      return 'warning';
    } else {
      return 'success';
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const renderCertificateCard = (cert: CertificateInfo, index: number) => {
    const isLeafCert = index === 0;
    const isRootCert = index === ((certificateChain?.certificates?.length || 0) - 1);
    const chainLength = certificateChain?.certificates?.length || 0;
    
    let certType: string;
    if (isLeafCert && chainLength === 1) {
      certType = 'Self-Signed';
    } else if (isLeafCert) {
      certType = 'End Entity';
    } else if (isRootCert) {
      certType = 'Root CA';
    } else {
      certType = 'Intermediate CA';
    }

    return (
      <Accordion key={index} defaultExpanded={index === 0}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
            {getCertificateStatusIcon(cert, isRootCert)}
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h6" component="div">
                {cert.subject}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {certType} • {cert.daysRemaining} days remaining
              </Typography>
            </Box>
            <Chip
              label={getCertificateStatusText(cert)}
              color={getCertificateStatusColor(cert)}
              size="small"
            />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Certificate Status */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Status
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                {getCertificateStatusIcon(cert, isRootCert)}
                <Typography variant="body2">
                  {cert.daysRemaining > 0
                    ? `Valid for ${cert.daysRemaining} more days`
                    : `Expired ${Math.abs(cert.daysRemaining)} days ago`
                  }
                </Typography>
              </Box>
            </Box>

            <Divider />

            {/* Basic Information */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Certificate Information
              </Typography>
              <List dense>
                <ListItem>
                  <ListItemText
                    primary="Subject"
                    secondary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" component="span">
                          {cert.subject}
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={() => copyToClipboard(cert.subject)}
                          title="Copy to clipboard"
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    }
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary="Issuer"
                    secondary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" component="span">
                          {cert.issuer}
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={() => copyToClipboard(cert.issuer)}
                          title="Copy to clipboard"
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    }
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary="Valid From"
                    secondary={formatDateTime(cert.validFrom)}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary="Valid To"
                    secondary={formatDateTime(cert.validTo)}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary="Serial Number"
                    secondary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" component="span" sx={{ fontFamily: 'monospace' }}>
                          {cert.serialNumber}
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={() => copyToClipboard(cert.serialNumber)}
                          title="Copy to clipboard"
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    }
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary="Fingerprint"
                    secondary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" component="span" sx={{ fontFamily: 'monospace' }}>
                          {cert.fingerprint}
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={() => copyToClipboard(cert.fingerprint)}
                          title="Copy to clipboard"
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    }
                  />
                </ListItem>
              </List>
            </Box>

            {/* Subject Alternative Names */}
            {cert.subjectAltNames && cert.subjectAltNames.length > 0 && (
              <>
                <Divider />
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Subject Alternative Names
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {cert.subjectAltNames.map((san, idx) => (
                      <Chip key={idx} label={san} size="small" variant="outlined" />
                    ))}
                  </Box>
                </Box>
              </>
            )}

            {/* Key Usage */}
            {((cert.keyUsage && cert.keyUsage.length > 0) || (cert.extKeyUsage && cert.extKeyUsage.length > 0)) && (
              <>
                <Divider />
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Key Usage
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {cert.keyUsage && cert.keyUsage.length > 0 && (
                      <Box>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Basic Constraints:
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {cert.keyUsage.map((usage, idx) => (
                            <Chip key={idx} label={usage} size="small" variant="outlined" />
                          ))}
                        </Box>
                      </Box>
                    )}
                    {cert.extKeyUsage && cert.extKeyUsage.length > 0 && (
                      <Box>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Extended Key Usage:
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {cert.extKeyUsage.map((usage, idx) => (
                            <Chip key={idx} label={usage} size="small" variant="outlined" />
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Box>
                </Box>
              </>
            )}
          </Box>
        </AccordionDetails>
      </Accordion>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { minHeight: '60vh' }
      }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <SecurityIcon />
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" component="div">
              Certificate & Domain Details
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {endpointName}
            </Typography>
          </Box>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={activeTab} onChange={handleTabChange} aria-label="certificate and domain tabs">
          <Tab 
            label="Certificate" 
            icon={<SecurityIcon />} 
            iconPosition="start"
            sx={{ minHeight: 48 }}
          />
          <Tab 
            label="Domain Info" 
            icon={<LanguageIcon />} 
            iconPosition="start"
            sx={{ minHeight: 48 }}
          />
        </Tabs>
      </Box>

      <DialogContent dividers>
        {activeTab === 0 && (
          <>
            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
                <CircularProgress />
                <Typography variant="body1" sx={{ ml: 2 }}>
                  Loading certificate chain...
                </Typography>
              </Box>
            )}

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                <Typography variant="h6" gutterBottom>
                  Failed to load certificate chain
                </Typography>
                <Typography variant="body2">
                  {error}
                </Typography>
              </Alert>
            )}

            {certificateChain && !loading && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {/* Chain Overview */}
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                      <SecurityIcon color={certificateChain.isValid ? 'success' : 'error'} />
                      <Box>
                        <Typography variant="h6">
                          Certificate Chain {certificateChain.isValid ? 'Valid' : 'Invalid'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {certificateChain.certificates.length} certificate{certificateChain.certificates.length !== 1 ? 's' : ''} in chain
                        </Typography>
                      </Box>
                    </Box>

                    {certificateChain.errors && certificateChain.errors.length > 0 && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>
                          Issues Found:
                        </Typography>
                        {certificateChain.errors.map((error, idx) => (
                          <Alert key={idx} severity="warning" sx={{ mb: 1 }}>
                            {error}
                          </Alert>
                        ))}
                      </Box>
                    )}
                  </CardContent>
                </Card>

                {/* Individual Certificates */}
                <Box>
                  <Typography variant="h6" gutterBottom>
                    Certificate Details
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Certificates are listed from end entity to root CA
                  </Typography>
                  <Box sx={{ mt: 2 }}>
                    {certificateChain.certificates.map((cert, index) => 
                      renderCertificateCard(cert, index)
                    )}
                  </Box>
                </Box>
              </Box>
            )}
          </>
        )}

        {activeTab === 1 && renderDomainInfo()}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CertificateModal;
