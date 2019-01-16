const path = require('path');
const _ = require('lodash');
const yaml = require('js-yaml');
const fs = require('fs');

class Plugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.hooks = {
      'before:deploy:createDeploymentArtifacts': this.createDeploymentArtifacts.bind(this),
    };
  }

  createDeploymentArtifacts() {
    if (!this.serverless.service.custom.cdn) {
      this.serverless.service.custom.cdn = {};
    }

    if (!this.serverless.service.custom.dns) {
      this.serverless.service.custom.dns = {};
    }

    const disabled = this.serverless.service.custom.cdn.disabled;
    if (disabled != undefined && disabled) {
      return;
    }

    this.fullDomainName = this.serverless.service.custom.dns.domainName;
    if (!this.fullDomainName) {
      this.serverless.cli.log('The domainName parameter is required');
      return;
    }

    const hostSegments = this.fullDomainName.split('.');

    if(hostSegments.length < 3) {
      this.serverless.cli.log(`The domainName was not valid: ${this.fullDomainName}.`);
      return;
    }

    this.hostName = `${hostSegments[hostSegments.length-2]}.${hostSegments[hostSegments.length-1]}`;
    this.regionalDomainName = this.serverless.service.custom.dns.regionalDomainName;
    if (!this.regionalDomainName) {
      const lastNonHostSegment = hostSegments[hostSegments.length-3];
      hostSegments[hostSegments.length-3] = `${lastNonHostSegment}-${this.options.region}`;
      this.regionalDomainName = hostSegments.join('.');
    }

    const baseResources = this.serverless.service.provider.compiledCloudFormationTemplate;

    const filename = path.resolve(__dirname, 'resources.yml'); // eslint-disable-line
    const content = fs.readFileSync(filename, 'utf-8');
    const resources = yaml.safeLoad(content, {
      filename: filename
    });

    return this.prepareResources(resources).then(() => {
      this.serverless.cli.log(`The multi-regional-plugin completed resources: ${yaml.safeDump(resources)}`);
      _.merge(baseResources, resources);
    });
  }

  prepareResources(resources) {
    const credentials = this.serverless.providers.aws.getCredentials();
    const acmCredentials = Object.assign({}, credentials, { region: this.options.region });
    this.acm = new this.serverless.providers.aws.sdk.ACM(acmCredentials);

    const cloudFrontRegion = this.serverless.service.custom.cdn.region;
    const enabled = this.serverless.service.custom.cdn.enabled;
    if (cloudFrontRegion !== this.options.region || (enabled && !enabled.includes(this.options.stage))) {
      delete resources.Resources.ApiDistribution;
      delete resources.Resources.ApiGlobalEndpointRecord;
      delete resources.Outputs.ApiDistribution;
      delete resources.Outputs.GlobalEndpoint;
    }

    const distributionConfig = resources.Resources.ApiDistribution.Properties.DistributionConfig;
    this.prepareApiRegionalEndpointRecord(resources);
    this.prepareComment(distributionConfig);
    this.prepareOrigins(distributionConfig);
    this.prepareHeaders(distributionConfig);
    this.preparePriceClass(distributionConfig);
    this.prepareAliases(distributionConfig);
    this.prepareLogging(distributionConfig);
    this.prepareWaf(distributionConfig);
    this.prepareApiGlobalEndpointRecord(resources);
    this.prepareApiRegionalBasePathMapping(resources);

    return Promise.all([
      this.prepareApiRegionalDomainName(resources),
      this.prepareCertificate(distributionConfig)
    ]);
  }

  prepareApiRegionalDomainName(resources) {
    const properties = resources.Resources.ApiRegionalDomainName.Properties;

    properties.DomainName = this.regionalDomainName;

    const regionSettings = this.serverless.service.custom.dns[this.options.region];
    if(regionSettings) {
      const acmCertificateArn = regionSettings.acmCertificateArn;
      if(acmCertificateArn) {
        properties.RegionalCertificateArn = acmCertificateArn;
        return Promise.resolve();
      }
    }

    return this.getCertArnFromHostName().then(certArn => {
      if (certArn) {
        properties.RegionalCertificateArn = certArn;
      } else {
        delete properties.RegionalCertificateArn;
      }
    }); 
  }

  prepareApiRegionalBasePathMapping(resources) {
    const properties = resources.Resources.ApiRegionalBasePathMapping.Properties;
    properties.Stage = this.options.stage;
  }

  prepareApiRegionalEndpointRecord(resources) {
    const properties = resources.Resources.ApiRegionalEndpointRecord.Properties;
    
    const hostedZoneId = this.serverless.service.custom.dns.hostedZoneId;
    if (hostedZoneId) {
      delete properties.HostedZoneName;
      properties.HostedZoneId = hostedZoneId;
    } else {
      delete properties.HostedZoneId;
      properties.HostedZoneName = `${this.hostName}.`;
    }

    properties.Region = this.options.region;
    properties.SetIdentifier = this.options.region;

    const regionSettings = this.serverless.service.custom.dns[this.options.region];
    if(regionSettings) {
      const healthCheckId = regionSettings.healthCheckId;
      if (healthCheckId) {
        properties.HealthCheckId = healthCheckId;
        delete resources.Resources.ApiRegionalHealthCheck;
      }
    }

    const elements = resources.Outputs.RegionalEndpoint.Value['Fn::Join'][1];
    if (elements[2]) {
      elements[2] = `/${this.options.stage}`;
    }
  }

  prepareComment(distributionConfig) {
    const name = this.serverless.getProvider('aws').naming.getApiGatewayName();
    distributionConfig.Comment = `API: ${name} (${this.options.region})`;
  }

  prepareOrigins(distributionConfig) {
    distributionConfig.Origins[0].DomainName = this.regionalDomainName;
    distributionConfig.Origins[0].OriginPath = `/${this.options.stage}`;
  }

  prepareHeaders(distributionConfig) {
    const headers = this.serverless.service.custom.cdn.headers;

    if (headers) {
      distributionConfig.DefaultCacheBehavior.ForwardedValues.Headers = headers;
    } else {
      distributionConfig.DefaultCacheBehavior.ForwardedValues.Headers = ['Accept', 'Authorization'];
    }
  }

  preparePriceClass(distributionConfig) {
    const priceClass = this.serverless.service.custom.cdn.priceClass;

    if (priceClass) {
      distributionConfig.PriceClass = priceClass;
    } else {
      distributionConfig.PriceClass = 'PriceClass_100';
    }
  }

  prepareAliases(distributionConfig) {
    const aliases = this.serverless.service.custom.cdn.aliases;

    if (aliases) {
      distributionConfig.Aliases = aliases;
    } else {
      delete distributionConfig.Aliases;
    }
  }

  prepareCertificate(distributionConfig) {
    const acmCertificateArn = this.serverless.service.custom.cdn.acmCertificateArn;

    if(acmCertificateArn) {
      distributionConfig.ViewerCertificate.AcmCertificateArn = acmCertificateArn;
      return Promise.resolve();
    } else {
      return this.getCertArnFromHostName().then(certArn => {
        if (certArn) {
          distributionConfig.ViewerCertificate.AcmCertificateArn = certArn;
        } else {
          delete distributionConfig.ViewerCertificate;
        }
      });
    }
  }

  prepareLogging(distributionConfig) {
    const logging = this.serverless.service.custom.cdn.logging;

    if (logging) {
      distributionConfig.Logging.Bucket = `${logging.bucketName}.s3.amazonaws.com`;
      distributionConfig.Logging.Prefix = logging.prefix || `aws-cloudfront/api/${this.options.stage}/${this.serverless.getProvider('aws').naming.getStackName()}`;

    } else {
      delete distributionConfig.Logging;
    }
  }

  prepareWaf(distributionConfig) {
    const webACLId = this.serverless.service.custom.cdn.webACLId;

    if (webACLId) {
      distributionConfig.WebACLId = webACLId;
    } else {
      delete distributionConfig.WebACLId;
    }
  }

  prepareApiGlobalEndpointRecord(resources) {
    const properties = resources.Resources.ApiGlobalEndpointRecord.Properties;

    const hostedZoneId = this.serverless.service.custom.dns.hostedZoneId;
    if (hostedZoneId) {
      delete properties.HostedZoneName;
      properties.HostedZoneId = hostedZoneId;
    } else {
      delete properties.HostedZoneId;
      properties.HostedZoneName = `${this.hostName}.`;
    }

    properties.Name = `${this.fullDomainName}.`;

    const elements = resources.Outputs.GlobalEndpoint.Value['Fn::Join'][1];
    if (elements[1]) {
      elements[1] = this.fullDomainName;
    }
  }

  /*
  * Obtains the certification arn
  */
  getCertArnFromHostName() {
    const certRequest = this.acm.listCertificates({ CertificateStatuses: ['PENDING_VALIDATION', 'ISSUED', 'INACTIVE'] }).promise();

    return certRequest.then((data) => {
      // The more specific name will be the longest
      let nameLength = 0;
      let certArn;
      const certificates = data.CertificateSummaryList;

      // Derive certificate from domain name
      certificates.forEach((certificate) => {
        let certificateListName = certificate.DomainName;

        // Looks for wild card and takes it out when checking
        if (certificateListName[0] === '*') {
          certificateListName = certificateListName.substr(2);
        }

        // Looks to see if the name in the list is within the given domain
        // Also checks if the name is more specific than previous ones
        if (this.hostName.includes(certificateListName)
          && certificateListName.length > nameLength) {
          nameLength = certificateListName.length;
          certArn = certificate.CertificateArn;
        }
      });
      if(certArn) {
        this.serverless.cli.log(`The host name ${this.hostName} resolved to the following certificateArn: ${certArn}`);
      }
      return certArn;
    }).catch((err) => {
      throw Error(`Error: Could not list certificates in Certificate Manager.\n${err}`);
    });
  }
}

module.exports = Plugin;
